//! Frozen-input period state machine. No published result is reduced from mutable live scores.
use crate::auth_runtime::{Failure, now, number, statement, text, uuid};
use folding_domain::{
    reducer,
    wire::{Event, Generation, Id},
};
use serde::Deserialize;
use worker::*;
#[derive(Deserialize)]
struct Period {
    period_id: String,
    start_ms: u64,
    end_ms: u64,
    cutoff_ms: u64,
    target_version: i64,
}
#[derive(Deserialize)]
struct Roster {
    participant_id: String,
    generation_revision: u64,
    generation_id: String,
    joined_at_ms: i64,
}
#[derive(Deserialize)]
struct Input {
    event_json: String,
}
#[derive(Deserialize)]
struct First {
    first_ms: Option<i64>,
}
pub(crate) async fn dispatch(db: &D1Database) -> std::result::Result<(), Failure> {
    let time = now();
    let first = statement(db, "SELECT min(joined_at_ms) AS first_ms FROM epochs", &[])?
        .first::<First>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .and_then(|r| r.first_ms);
    if let Some(first) = first {
        for kind in ["week", "month"] {
            let latest = statement(
                db,
                "SELECT max(start_ms) AS first_ms FROM periods WHERE kind=?1",
                &[text(kind)],
            )?
            .first::<First>(None)
            .await
            .map_err(|_| Failure::unavailable())?
            .and_then(|r| r.first_ms)
            .unwrap_or(first);
            let mut timestamp = latest as u64;
            for _ in 0..48 {
                let window = crate::periods::current(timestamp)
                    .ok_or_else(Failure::unavailable)?
                    .into_iter()
                    .find(|w| w.kind == kind)
                    .ok_or_else(Failure::unavailable)?;
                statement(db,"INSERT INTO periods(period_id,kind,start_ms,end_ms,cutoff_ms,state) VALUES (?1,?2,?3,?4,?5,'open') ON CONFLICT(period_id) DO NOTHING",&[text(&window.id),text(kind),number(window.start_ms as i64),number(window.end_ms as i64),number((window.end_ms+86400000) as i64)])?.run().await.map_err(|_|Failure::unavailable())?;
                if window.end_ms > time as u64 {
                    break;
                }
                timestamp = window.end_ms;
            }
        }
    }
    statement(
        db,
        "UPDATE periods SET state='grace' WHERE state='open' AND end_ms<=?1",
        &[number(time)],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    let due=statement(db,"SELECT period_id,kind,start_ms,end_ms,cutoff_ms,target_version FROM periods WHERE (state='grace' AND cutoff_ms<=?1) OR state='finalizing' ORDER BY start_ms LIMIT 4",&[number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Period>().map_err(|_|Failure::unavailable())?;
    for period in due {
        freeze(db, &period, time).await?;
        stage(db, &period).await?;
        publish(db, &period).await?;
    }
    Ok(())
}
async fn freeze(db: &D1Database, period: &Period, time: i64) -> std::result::Result<(), Failure> {
    let guard = uuid()?;
    // Claim, roster and complete accepted baseline materialization share exactly one D1 transaction.
    let result=db.batch(vec![
 statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM periods WHERE period_id=?2 AND target_version=?3 AND state='grace' AND cutoff_ms<=?4) THEN 1 ELSE 0 END)",&[text(&guard),text(&period.period_id),number(period.target_version),number(time)])?,
 statement(db,"UPDATE periods SET state='finalizing',freeze_ms=?1,decision_watermark=(SELECT version FROM decision_clock WHERE singleton=1) WHERE period_id=?2",&[number(time),text(&period.period_id)])?,
 statement(db,"INSERT INTO period_roster SELECT ?1,?2,p.participant_id,p.generation_revision,p.generation_id,e.joined_at_ms,'pending' FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id WHERE p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND e.closed_at_ms IS NULL AND e.joined_at_ms<?3",&[text(&period.period_id),number(period.target_version),number(period.end_ms as i64)])?,
 statement(db,"INSERT INTO finalization_inputs SELECT r.period_id,r.version,r.participant_id,o.event_id,o.event_json,o.decision_version,o.received_at_ms FROM period_roster r JOIN observations o ON o.participant_id=r.participant_id JOIN periods p ON p.period_id=r.period_id WHERE r.period_id=?1 AND r.version=?2 AND o.disposition='accepted' AND o.received_at_ms<?3 AND o.decision_version<=p.decision_watermark AND json_extract(o.event_json,'$.generation.revision')=r.generation_revision AND json_extract(o.event_json,'$.generation.reset_id')=r.generation_id",&[text(&period.period_id),number(period.target_version),number(period.cutoff_ms as i64)])?,
 statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?,
 ]).await;
    if result.is_err() {
        #[derive(Deserialize)]
        struct State {
            state: String,
        }
        let current = statement(
            db,
            "SELECT state FROM periods WHERE period_id=?1",
            &[text(&period.period_id)],
        )?
        .first::<State>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
        if current.state != "finalizing" && current.state != "finalized" {
            return Err(Failure::unavailable());
        }
    }
    Ok(())
}
async fn stage(db: &D1Database, period: &Period) -> std::result::Result<(), Failure> {
    let rows=statement(db,"SELECT participant_id,generation_revision,generation_id,joined_at_ms FROM period_roster WHERE period_id=?1 AND version=?2 AND state='pending' ORDER BY participant_id LIMIT 25",&[text(&period.period_id),number(period.target_version)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Roster>().map_err(|_|Failure::unavailable())?;
    for row in rows {
        let input=statement(db,"SELECT event_json FROM finalization_inputs WHERE period_id=?1 AND version=?2 AND participant_id=?3",&[text(&period.period_id),number(period.target_version),text(&row.participant_id)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Input>().map_err(|_|Failure::unavailable())?;
        let events: Vec<Event> = input
            .into_iter()
            .map(|i| serde_json::from_str(&i.event_json).map_err(|_| Failure::unavailable()))
            .collect::<std::result::Result<_, _>>()?;
        let generation = Generation {
            revision: row.generation_revision,
            reset_id: Id::parse(&row.generation_id).map_err(|_| Failure::unavailable())?,
        };
        let summary =
            reducer::reduce(&events, &[], &generation).map_err(|_| Failure::unavailable())?;
        let times: std::collections::BTreeMap<_, _> = events
            .iter()
            .map(|e| (&e.event_id, e.observed_at_ms))
            .collect();
        let folds = summary
            .counted_events
            .iter()
            .filter(|id| times[id] >= period.start_ms && times[id] < period.end_ms)
            .count() as i64;
        let guard = uuid()?;
        let result=db.batch(vec![statement(db,STAGE_GUARD,&[text(&guard),text(&period.period_id),number(period.target_version),text(&row.participant_id),number(row.generation_revision as i64),text(&row.generation_id),number(row.joined_at_ms),number(folds)])?,statement(db,"INSERT INTO staged_results VALUES (?1,?2,?3,?4) ON CONFLICT(period_id,version,participant_id) DO UPDATE SET folds=excluded.folds",&[text(&period.period_id),number(period.target_version),text(&row.participant_id),number(folds)])?,statement(db,"UPDATE period_roster SET state='completed' WHERE period_id=?1 AND version=?2 AND participant_id=?3",&[text(&period.period_id),number(period.target_version),text(&row.participant_id)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await;
        if result.is_err() {
            // Privacy may have won the race. The shared suppression pass handles that without recreating data.
            suppress(db, &period.period_id, period.target_version).await?;
            #[derive(Deserialize)]
            struct Completion {
                state: String,
                folds: Option<i64>,
            }
            let completion=statement(db,"SELECT r.state,s.folds FROM period_roster r LEFT JOIN staged_results s ON s.period_id=r.period_id AND s.version=r.version AND s.participant_id=r.participant_id WHERE r.period_id=?1 AND r.version=?2 AND r.participant_id=?3",&[text(&period.period_id),number(period.target_version),text(&row.participant_id)])?.first::<Completion>(None).await.map_err(|_|Failure::unavailable())?;
            if completion.is_some_and(|c| {
                c.state != "removed" && (c.state != "completed" || c.folds != Some(folds))
            }) {
                return Err(Failure::unavailable());
            }
        }
    }
    Ok(())
}
const STAGE_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM period_roster r JOIN periods d ON d.period_id=r.period_id
 JOIN participants p ON p.participant_id=r.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id
 WHERE r.period_id=?2 AND r.version=?3 AND r.participant_id=?4 AND r.state<>'removed'
 AND d.state='finalizing' AND d.target_version=?3 AND p.account_state='active'
 AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=?5 AND p.generation_id=?6
 AND e.joined_at_ms=?7 AND e.closed_at_ms IS NULL
 AND NOT EXISTS(SELECT 1 FROM staged_results s WHERE s.period_id=?2 AND s.version=?3 AND s.participant_id=?4 AND s.folds<>?8)
) THEN 1 ELSE 0 END)
"#;
async fn suppress(db: &D1Database, period: &str, version: i64) -> std::result::Result<(), Failure> {
    db.batch(vec![
 statement(db,"UPDATE period_roster SET state='removed' WHERE period_id=?1 AND version=?2 AND NOT EXISTS(SELECT 1 FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id WHERE p.participant_id=period_roster.participant_id AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=period_roster.generation_revision AND p.generation_id=period_roster.generation_id AND e.joined_at_ms=period_roster.joined_at_ms AND e.closed_at_ms IS NULL)",&[text(period),number(version)])?,
 statement(db,"DELETE FROM finalization_inputs WHERE period_id=?1 AND version=?2 AND participant_id IN(SELECT participant_id FROM period_roster WHERE period_id=?1 AND version=?2 AND state='removed')",&[text(period),number(version)])?,
 statement(db,"DELETE FROM staged_results WHERE period_id=?1 AND version=?2 AND participant_id IN(SELECT participant_id FROM period_roster WHERE period_id=?1 AND version=?2 AND state='removed')",&[text(period),number(version)])?,
 ]).await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
async fn publish(db: &D1Database, period: &Period) -> std::result::Result<(), Failure> {
    suppress(db, &period.period_id, period.target_version).await?;
    let guard = uuid()?;
    let time = now();
    let result=db.batch(vec![
 statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM periods WHERE period_id=?2 AND target_version=?3 AND state='finalizing') AND NOT EXISTS(SELECT 1 FROM period_roster WHERE period_id=?2 AND version=?3 AND state='pending') AND NOT EXISTS(SELECT 1 FROM period_roster r WHERE r.period_id=?2 AND r.version=?3 AND r.state='completed' AND NOT EXISTS(SELECT 1 FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id WHERE p.participant_id=r.participant_id AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=r.generation_revision AND p.generation_id=r.generation_id AND e.joined_at_ms=r.joined_at_ms AND e.closed_at_ms IS NULL)) THEN 1 ELSE 0 END)",&[text(&guard),text(&period.period_id),number(period.target_version)])?,
 statement(db,PUBLISH_RESULTS,&[text(&period.period_id),number(period.target_version)])?,
 statement(db,"INSERT INTO award_jobs(participant_id,period_id,result_version,generation_revision,generation_id,joined_at_ms,state) SELECT participant_id,period_id,version,generation_revision,generation_id,joined_at_ms,'pending' FROM results WHERE period_id=?1 AND version=?2 ON CONFLICT(participant_id,period_id,kind) DO NOTHING",&[text(&period.period_id),number(period.target_version)])?,
 statement(db,"UPDATE periods SET published_version=?1,state='finalized',finalized_at_ms=?2,population=(SELECT count(*) FROM results WHERE period_id=?3 AND version=?1) WHERE period_id=?3",&[number(period.target_version),number(time),text(&period.period_id)])?,
 statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?,
 ]).await;
    // Pending roster work or a concurrent privacy fence deliberately leaves this period unpublished.
    if result.is_err() {
        #[derive(Deserialize)]
        struct Pending {
            state: String,
            pending: i64,
        }
        let row=statement(db,"SELECT p.state,(SELECT count(*) FROM period_roster r WHERE r.period_id=p.period_id AND r.version=p.target_version AND r.state='pending') AS pending FROM periods p WHERE p.period_id=?1",&[text(&period.period_id)])?.first::<Pending>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
        if row.state != "finalized" && row.pending == 0 {
            return Err(Failure::unavailable());
        }
    }
    Ok(())
}
const PUBLISH_RESULTS: &str = r#"
INSERT INTO results
WITH ranked AS (
 SELECT s.*,r.generation_revision,r.generation_id,r.joined_at_ms,
 rank() OVER(ORDER BY s.folds DESC) AS place,count(*) OVER() AS population,
 count(*) OVER(PARTITION BY s.folds) AS tied
 FROM staged_results s JOIN period_roster r ON r.period_id=s.period_id AND r.version=s.version AND r.participant_id=s.participant_id
 WHERE s.period_id=?1 AND s.version=?2 AND r.state='completed' AND s.folds>0
)
SELECT period_id,version,participant_id,generation_revision,generation_id,joined_at_ms,folds,place,population,
 CASE WHEN population<20 THEN NULL ELSE (200*(population-place-tied+1)+(population-1))/(2*(population-1)) END,
 CASE place WHEN 1 THEN 'gold' WHEN 2 THEN 'silver' WHEN 3 THEN 'bronze' ELSE NULL END
FROM ranked
"#;
