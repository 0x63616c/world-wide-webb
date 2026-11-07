use crate::moderation_eligibility::{Epoch, approval_eligible};
// Provisional moderation replay; administrator's participant-revision guard commits this atomically.
use crate::auth_runtime::{Failure, now, number, statement, text};
use folding_domain::{
    reducer,
    wire::{Event, Generation, Id},
};
use serde::Deserialize;
use worker::*;
#[derive(Deserialize)]
struct Observation {
    event_json: String,
    disposition: String,
    reason_code: Option<String>,
    received_at_ms: u64,
    submission_id: Option<String>,
}
#[derive(Deserialize)]
struct State {
    generation_revision: u64,
    generation_id: String,
    membership: String,
    restriction: String,
    account_state: String,
}
pub(crate) async fn change(
    db: &D1Database,
    participant: &str,
    event_id: &Id,
    reinstate: bool,
    revision: i64,
) -> Result<(Vec<D1PreparedStatement>, String), Failure> {
    let state=statement(db,"SELECT generation_revision,generation_id,membership,restriction,account_state FROM participants WHERE participant_id=?1",&[text(participant)])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    if state.account_state != "active"
        || state.membership != "joined"
        || state.restriction != "none"
    {
        return Err(Failure::conflict());
    }
    let generation = Generation {
        revision: state.generation_revision,
        reset_id: Id::parse(&state.generation_id).map_err(|_| Failure::unavailable())?,
    };
    let rows=statement(db,"SELECT event_json,disposition,reason_code,submission_id,received_at_ms FROM observations WHERE participant_id=?1",&[text(participant)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Observation>().map_err(|_|Failure::unavailable())?;
    let rows: Vec<_> = rows
        .into_iter()
        .map(|row| {
            let event: Event =
                serde_json::from_str(&row.event_json).map_err(|_| Failure::unavailable())?;
            Ok((row, event))
        })
        .collect::<Result<_, Failure>>()?;
    let submission = rows
        .iter()
        .find(|(_, event)| &event.event_id == event_id)
        .and_then(|(row, _)| row.submission_id.as_ref())
        .ok_or_else(Failure::conflict)?
        .clone();
    // Approvals operate on the submitted group, never on arbitrary rejected events.
    // Recheck immutable enrollment and time eligibility; an admin is not an auth bypass.
    if reinstate {
        let mut candidates = 0;
        for (row, event) in &rows {
            if row.submission_id.as_deref() != Some(&submission) || row.disposition != "quarantined"
            {
                continue;
            }
            if !matches!(
                row.reason_code.as_deref(),
                Some("moderator_quarantine" | "future_timestamp" | "clock_reversal")
            ) || event.generation != generation
                || event.is_test
                || event.validate().is_err()
                || event.observed_at_ms > now() as u64
            {
                return Err(Failure::conflict());
            }
            let epoch_id = event
                .competition_epoch_id
                .as_ref()
                .ok_or_else(Failure::conflict)?;
            let epoch = statement(db,
                "SELECT device_id,issued_at_ms,closed_at_ms FROM epochs WHERE participant_id=?1 AND epoch_id=?2",
                &[text(participant),text(epoch_id.as_str())])?
                .first::<Epoch>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::conflict)?;
            if !approval_eligible(event, &generation, row.received_at_ms, &epoch, now() as u64) {
                return Err(Failure::conflict());
            }
            candidates += 1;
        }
        if candidates == 0 {
            return Err(Failure::conflict());
        }
    }
    let accepted: Vec<_> = rows
        .iter()
        .filter(|(row, event)| {
            if event.generation != generation {
                return false;
            }
            let target = row.submission_id.as_deref() == Some(&submission);
            if reinstate {
                row.disposition == "accepted"
                    || (target
                        && row.disposition == "quarantined"
                        && matches!(
                            row.reason_code.as_deref(),
                            Some("moderator_quarantine" | "future_timestamp" | "clock_reversal")
                        ))
            } else {
                row.disposition == "accepted" && !target
            }
        })
        .map(|(_, event)| event.clone())
        .collect();
    let mut sorted: Vec<_> = accepted.iter().collect();
    sorted.sort_by_key(|event| (&event.device_id, event.sequence));
    if sorted.windows(2).any(|pair| {
        pair[0].device_id == pair[1].device_id && pair[0].observed_at_ms > pair[1].observed_at_ms
    }) {
        return Err(Failure::conflict());
    }
    let summary = reducer::reduce(&accepted, &[], &generation).map_err(|_| Failure::conflict())?;
    let times: std::collections::BTreeMap<_, _> = accepted
        .iter()
        .map(|e| (&e.event_id, e.observed_at_ms))
        .collect();
    let mut writes = vec![statement(
        db,
        "UPDATE decision_clock SET version=version+1 WHERE singleton=1",
        &[],
    )?];
    if reinstate {
        writes.push(statement(db,"UPDATE observations SET disposition='accepted',reason_code=NULL,decision_version=(SELECT version FROM decision_clock WHERE singleton=1) WHERE participant_id=?1 AND submission_id=?2 AND disposition='quarantined' AND reason_code IN ('moderator_quarantine','future_timestamp','clock_reversal') AND json_extract(event_json,'$.generation.revision')=?3 AND json_extract(event_json,'$.generation.reset_id')=?4",&[text(participant),text(&submission),number(generation.revision as i64),text(generation.reset_id.as_str())])?);
    } else {
        writes.push(statement(db,"UPDATE observations SET disposition='quarantined',reason_code='moderator_quarantine',decision_version=(SELECT version FROM decision_clock WHERE singleton=1) WHERE participant_id=?1 AND submission_id=?2 AND disposition='accepted'",&[text(participant),text(&submission)])?);
    }
    writes.push(score(
        db,
        participant,
        &generation,
        "all",
        summary.folds(),
        revision + 1,
    )?);
    let mut periods = std::collections::BTreeMap::new();
    let time = now() as u64;
    for at in [time, time + 300000] {
        for period in crate::periods::current(at).ok_or_else(Failure::unavailable)? {
            periods.insert(period.id.clone(), period);
        }
    }
    for period in periods.values() {
        let folds = summary
            .counted_events
            .iter()
            .filter(|id| times[id] >= period.start_ms && times[id] < period.end_ms)
            .count() as u64;
        writes.push(score(
            db,
            participant,
            &generation,
            &period.id,
            folds,
            revision + 1,
        )?);
    }
    Ok((writes, submission))
}
fn score(
    db: &D1Database,
    participant: &str,
    generation: &Generation,
    period: &str,
    folds: u64,
    revision: i64,
) -> Result<D1PreparedStatement, Failure> {
    statement(
        db,
        "INSERT INTO live_scores VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(participant_id,period_id) DO UPDATE SET generation_revision=excluded.generation_revision,generation_id=excluded.generation_id,folds=excluded.folds,revision=excluded.revision",
        &[
            text(participant),
            number(generation.revision as i64),
            text(generation.reset_id.as_str()),
            text(period),
            number(folds as i64),
            number(revision),
        ],
    )
}
