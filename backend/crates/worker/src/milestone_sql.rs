//! Shared SQL for the derived reward projection. Kept host-testable as well as
//! used by the real D1 runtime; every caller commits under participant revision.
pub const ADD_EVENTS: &str = r#"
INSERT INTO milestone_counted_events(participant_id,event_id,observed_at_ms)
SELECT ?1,json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?2)
"#;
pub const REMOVE_EVENTS: &str = "DELETE FROM milestone_counted_events WHERE participant_id=?1 AND event_id IN(SELECT value FROM json_each(?2))";
pub const DAY_DELTAS: &str = r#"
INSERT INTO milestone_days(participant_id,utc_day,folds)
SELECT ?1,CAST(key AS INTEGER),COALESCE((SELECT folds FROM milestone_days d
 WHERE d.participant_id=?1 AND d.utc_day=CAST(j.key AS INTEGER)),0)+j.value
FROM json_each(?2) j WHERE true
ON CONFLICT(participant_id,utc_day) DO UPDATE SET folds=excluded.folds
"#;
pub const INITIALIZE: &str = r#"
INSERT INTO milestone_state(participant_id,generation_revision,generation_id,source_revision,state)
VALUES(?1,?2,?3,?4,?5)
ON CONFLICT(participant_id) DO UPDATE SET generation_revision=excluded.generation_revision,
generation_id=excluded.generation_id,source_revision=excluded.source_revision,state=excluded.state,
folds=0,days_used=0,cursor_device_id=NULL,cursor_sequence=NULL,cursor_transition=NULL
"#;
pub const SOURCE_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id
 WHERE p.participant_id=?2 AND p.account_state='active' AND p.membership='joined'
 AND p.restriction='none' AND r.revision=?3
 AND p.generation_revision=?4 AND p.generation_id=?5
) THEN 1 ELSE 0 END)
"#;
pub const BACKFILL_ROWS: &str = r#"
SELECT o.event_json,CASE WHEN d.event_id IS NULL THEN 0 ELSE 1 END AS deleted
FROM observations o LEFT JOIN deleted_observations d
ON d.participant_id=o.participant_id AND d.event_id=o.event_id
WHERE o.participant_id=?1 AND o.disposition='accepted'
AND json_extract(o.event_json,'$.is_test')=0
AND (o.device_id>?2 OR (o.device_id=?2 AND o.sequence>?3))
AND json_extract(o.event_json,'$.generation.revision')=?4
AND json_extract(o.event_json,'$.generation.reset_id')=?5
ORDER BY o.device_id,o.sequence LIMIT 256
"#;
pub const UPDATE_STATE: &str = r#"
UPDATE milestone_state SET folds=folds+?2,days_used=days_used+?3,source_revision=?4
WHERE participant_id=?1 AND state='ready'
"#;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bulk_day_deltas_preserve_unaffected_days_and_reject_underflow() {
        let db = rusqlite::Connection::open_in_memory().unwrap();
        db.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE observations(participant_id TEXT, device_id TEXT, sequence INTEGER, disposition TEXT, event_json TEXT); CREATE TABLE participants(participant_id TEXT PRIMARY KEY); INSERT INTO participants VALUES('p');").unwrap();
        db.execute_batch(include_str!(
            "../../../migrations/0021_profile_milestones.sql"
        ))
        .unwrap();
        db.execute(DAY_DELTAS, ("p", r#"{"0":2,"1":1}"#)).unwrap();
        db.execute(DAY_DELTAS, ("p", r#"{"0":-1,"4":3}"#)).unwrap();
        assert_eq!(
            db.query_row("SELECT sum(folds) FROM milestone_days", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            5
        );
        assert!(db.execute(DAY_DELTAS, ("p", r#"{"0":-2}"#)).is_err());
        db.execute(ADD_EVENTS, ("p", r#"[["event-1",1000],["event-2",1000]]"#))
            .unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM milestone_counted_events", [], |r| r
                .get::<_, i64>(
                0
            ))
            .unwrap(),
            2
        );
        db.execute(REMOVE_EVENTS, ("p", r#"["event-1"]"#)).unwrap();
        assert_eq!(
            db.query_row("SELECT event_id FROM milestone_counted_events", [], |r| {
                r.get::<_, String>(0)
            })
            .unwrap(),
            "event-2"
        );
    }
}
