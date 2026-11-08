//! Only identity collisions and adjacent accepted transitions can affect insertion scores.
//! Index-backed lookups keep each batch independent of the participant's history length.
pub const NEIGHBORS_SQL: &str = r#"
WITH incoming AS (
 SELECT json_extract(value,'$.event_id') AS id,
 json_extract(value,'$.device_id') AS device,
 json_extract(value,'$.sequence') AS sequence,
 json_extract(value,'$.generation.revision') AS revision,
 json_extract(value,'$.generation.reset_id') AS generation
 FROM json_each(?2,'$.events')
), wanted AS (
 SELECT id FROM incoming
 UNION SELECT o.event_id FROM incoming i JOIN observations o
 ON o.participant_id=?1 AND o.device_id=i.device AND o.sequence=i.sequence
 UNION SELECT (SELECT o.event_id FROM observations o
 WHERE o.participant_id=?1 AND o.device_id=i.device
 AND json_extract(o.event_json,'$.generation.revision')=i.revision
 AND json_extract(o.event_json,'$.generation.reset_id')=i.generation
 AND o.disposition='accepted' AND json_extract(o.event_json,'$.is_test')=0
 AND o.sequence<i.sequence ORDER BY o.sequence DESC LIMIT 1) FROM incoming i
 UNION SELECT (SELECT o.event_id FROM observations o
 WHERE o.participant_id=?1 AND o.device_id=i.device
 AND json_extract(o.event_json,'$.generation.revision')=i.revision
 AND json_extract(o.event_json,'$.generation.reset_id')=i.generation
 AND o.disposition='accepted' AND json_extract(o.event_json,'$.is_test')=0
 AND o.sequence>i.sequence ORDER BY o.sequence LIMIT 1) FROM incoming i
)
SELECT event_json,disposition FROM observations
WHERE participant_id=?1 AND event_id IN(SELECT id FROM wanted)
"#;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ingestion::{StoredObservation, plan_batch_with_deletions};
    use folding_domain::{
        competition::Enrollment,
        reducer,
        wire::{Disposition, Event, EventBatch, Generation, Id, Transition},
    };
    use rusqlite::{Connection, params};
    fn id(n: u64) -> Id {
        Id::parse(&format!("00000000-0000-0000-0000-{n:012}")).unwrap()
    }
    #[test]
    fn indexed_neighbors_match_full_replay_for_late_duplicate_and_quarantined_batches() {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE observations(participant_id TEXT,event_id TEXT,device_id TEXT,sequence INTEGER,event_json TEXT,disposition TEXT,PRIMARY KEY(participant_id,event_id),UNIQUE(participant_id,device_id,sequence));").unwrap();
        let migration = include_str!("../../../migrations/0019_resource_protection.sql");
        db.execute_batch(
            migration
                .split("CREATE INDEX jobs_category_state")
                .next()
                .unwrap(),
        )
        .unwrap();
        let generation = Generation::initial();
        let device = id(10000);
        let epoch = id(20000);
        let enrollment = Enrollment {
            device_id: &device,
            epoch_id: &epoch,
            generation: &generation,
            issued_at_ms: 0,
        };
        let deleted: std::collections::BTreeSet<Id> = (1_u64..1700)
            .filter(|n| n.is_multiple_of(11))
            .map(id)
            .collect();
        let mut previous: Vec<StoredObservation> = vec![];
        let mut seed = 71u64;
        // Shuffled arrivals, repeated states, duplicate requests, tests and clock reversals.
        for step in 0..300 {
            let mut events = vec![];
            for _ in 0..7 {
                seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
                let n = seed % 1600 + 1;
                events.push(Event {
                    schema_version: 1,
                    event_id: id(n),
                    device_id: device.clone(),
                    sequence: n,
                    generation: generation.clone(),
                    observed_at_ms: if n.is_multiple_of(19) { 1 } else { n * 100 },
                    timezone_id: "UTC".into(),
                    transition: if n.is_multiple_of(3) {
                        Transition::Open
                    } else {
                        Transition::Close
                    },
                    is_test: n.is_multiple_of(29),
                    competition_epoch_id: Some(epoch.clone()),
                });
            }
            let batch = EventBatch {
                schema_version: 1,
                operation_id: id(30000 + step),
                epoch_id: epoch.clone(),
                events,
            };
            let json = serde_json::to_string(&batch).unwrap();
            let subset = db
                .prepare(NEIGHBORS_SQL)
                .unwrap()
                .query_map(params!["p", json], |r| {
                    let payload: String = r.get(0)?;
                    let disposition: String = r.get(1)?;
                    Ok(StoredObservation {
                        event: serde_json::from_str(&payload).unwrap(),
                        disposition: serde_json::from_str(&format!("\"{disposition}\"")).unwrap(),
                    })
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap();
            assert!(subset.len() <= batch.events.len() * 4);
            let full = plan_batch_with_deletions(
                &batch,
                &previous,
                &enrollment,
                200000,
                id(40000),
                &deleted,
            )
            .unwrap();
            let partial = plan_batch_with_deletions(
                &batch,
                &subset,
                &enrollment,
                200000,
                id(40000),
                &deleted,
            )
            .unwrap();
            assert_eq!(
                serde_json::to_value(&full.receipt).unwrap(),
                serde_json::to_value(&partial.receipt).unwrap()
            );
            let accepted = |items: &[StoredObservation]| {
                items
                    .iter()
                    .filter(|o| o.disposition == Disposition::Accepted)
                    .map(|o| o.event.clone())
                    .collect::<Vec<_>>()
            };
            let old_full =
                reducer::reduce_with_deletions(&accepted(&previous), &[], &generation, &deleted)
                    .unwrap();
            let old_part =
                reducer::reduce_with_deletions(&accepted(&subset), &[], &generation, &deleted)
                    .unwrap();
            assert_eq!(
                full.all_time_folds as i64 - old_full.folds() as i64,
                partial.all_time_folds as i64 - old_part.folds() as i64,
                "batch {step}"
            );
            let times = |items: &[StoredObservation], ids: &[Id]| {
                items
                    .iter()
                    .filter(|o| ids.contains(&o.event.event_id))
                    .map(|o| o.event.observed_at_ms)
                    .collect::<Vec<_>>()
            };
            let full_times = times(&previous, &old_full.counted_events);
            let part_times = times(&subset, &old_part.counted_events);
            for bucket in 0..17 {
                let count = |ts: &[u64]| ts.iter().filter(|&&t| t / 10000 == bucket).count() as i64;
                assert_eq!(
                    count(&full.counted_timestamps) - count(&full_times),
                    count(&partial.counted_timestamps) - count(&part_times),
                    "period bucket {bucket} batch {step}"
                );
            }
            for new in full.new_observations {
                let disposition = serde_json::to_value(new.disposition)
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_owned();
                db.execute(
                    "INSERT INTO observations VALUES ('p',?1,?2,?3,?4,?5)",
                    params![
                        new.event.event_id.as_str(),
                        device.as_str(),
                        new.event.sequence as i64,
                        serde_json::to_string(&new.event).unwrap(),
                        disposition
                    ],
                )
                .unwrap();
                previous.push(StoredObservation {
                    event: new.event,
                    disposition: new.disposition,
                });
            }
        }
        let explain = db
            .prepare(&format!("EXPLAIN QUERY PLAN {NEIGHBORS_SQL}"))
            .unwrap()
            .query_map(params!["p", "{\"events\":[]}"], |r| r.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        assert!(
            explain.contains("observation_scoring_neighbors"),
            "{explain}"
        );
    }
}
