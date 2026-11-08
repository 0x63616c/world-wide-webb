//! Authenticated, contribution-only user deletion. No client score is accepted.
use crate::auth_runtime::{
    Configuration, Failure, authenticated_session, decode, now, number, response, session_guard,
    statement, text, uuid,
};
use folding_domain::{
    reducer,
    wire::{Event, Id},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use worker::*;
#[derive(Deserialize)]
struct Deleted {
    event_id: Id,
}
pub(crate) async fn deleted_ids(
    db: &D1Database,
    participant: &str,
) -> Result<BTreeSet<Id>, Failure> {
    Ok(statement(
        db,
        "SELECT event_id FROM deleted_observations WHERE participant_id=?1",
        &[text(participant)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Deleted>()
    .map_err(|_| Failure::unavailable())?
    .into_iter()
    .map(|row| row.event_id)
    .collect())
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Delete {
    operation_id: Id,
    event_ids: Vec<Id>,
    epoch_ids: Vec<Id>,
}
#[derive(Deserialize)]
struct Observation {
    event_json: String,
}
#[derive(Deserialize)]
struct State {
    generation_revision: u64,
    generation_id: Id,
}
pub(crate) async fn delete(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> Result<Response, Failure> {
    let mut input: Delete = decode(body)?;
    if input.event_ids.is_empty() || input.event_ids.len() > 2 {
        return Err(Failure::malformed());
    }
    input.event_ids.sort();
    input.epoch_ids.sort();
    if input.epoch_ids.is_empty()
        || input.epoch_ids.len() > 2
        || input.epoch_ids.windows(2).any(|pair| pair[0] == pair[1])
    {
        return Err(Failure::malformed());
    }
    if input.event_ids.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(Failure::malformed());
    }
    // Removing one's own data must remain possible without App Attest or joined eligibility.
    let session = authenticated_session(request, db, config, false).await?;
    crate::rate_limit::enforce(
        db,
        config,
        "entry_deletion_auth",
        &session.participant_id,
        60000,
        120,
    )
    .await?;
    #[derive(Deserialize)]
    struct Ownership {
        owned: i64,
    }
    for epoch in &input.epoch_ids {
        let owned = statement(
            db,
            "SELECT count(*) AS owned FROM epochs WHERE epoch_id=?1 AND participant_id=?2",
            &[text(epoch.as_str()), text(&session.participant_id)],
        )?
        .first::<Ownership>(None)
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
        if owned.owned != 1 {
            return Err(Failure {
                status: 403,
                code: "wrong_account",
                retryable: false,
            });
        }
    }
    let hash = Sha256::digest(serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?);
    let route = "/v1/entry-deletions";
    if let Some(old) =
        crate::competition_runtime::receipt(db, &session.participant_id, &input.operation_id)
            .await?
    {
        if old.route != route || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        return response(
            &serde_json::from_str::<serde_json::Value>(&old.response_json)
                .map_err(|_| Failure::unavailable())?,
        );
    }
    crate::rate_limit::enforce(
        db,
        config,
        "entry_deletion",
        &session.participant_id,
        60000,
        30,
    )
    .await?;
    let current = statement(
        db,
        "SELECT generation_revision,generation_id FROM participants WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?
    .first::<State>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unauthorized)?;
    let generation = folding_domain::wire::Generation {
        revision: current.generation_revision,
        reset_id: current.generation_id,
    };
    let events = statement(
        db,
        "SELECT event_json FROM observations WHERE participant_id=?1 AND disposition='accepted'",
        &[text(&session.participant_id)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Observation>()
    .map_err(|_| Failure::unavailable())?
    .into_iter()
    .map(|row| serde_json::from_str::<Event>(&row.event_json).map_err(|_| Failure::unavailable()))
    .collect::<Result<Vec<_>, _>>()?;
    let mut deleted = deleted_ids(db, &session.participant_id).await?;
    deleted.extend(input.event_ids.iter().cloned());
    let summary = reducer::reduce_with_deletions(&events, &[], &generation, &deleted)
        .map_err(|_| Failure::unavailable())?;
    let times: BTreeMap<_, _> = events
        .iter()
        .map(|e| (&e.event_id, e.observed_at_ms))
        .collect();
    let guard = uuid()?;
    let mut writes = vec![
        session_guard(db, &guard, &session, config, now())?,
        statement(
            db,
            "INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM participant_revisions WHERE participant_id=?2 AND revision=?3) THEN 1 ELSE 0 END)",
            &[
                text(&format!("{guard}-revision")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
        statement(
            db,
            "UPDATE decision_clock SET version=version+1 WHERE singleton=1",
            &[],
        )?,
    ];
    for id in &input.event_ids {
        writes.push(statement(db, "INSERT INTO deleted_observations VALUES (?1,?2,?3) ON CONFLICT(participant_id,event_id) DO NOTHING", &[text(&session.participant_id), text(id.as_str()), number(now())])?);
    }
    writes.push(crate::moderation_scores::score(
        db,
        &session.participant_id,
        &generation,
        "all",
        summary.folds(),
        session.revision + 1,
    )?);
    let time = now() as u64;
    let mut periods = BTreeMap::new();
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
        writes.push(crate::moderation_scores::score(
            db,
            &session.participant_id,
            &generation,
            &period.id,
            folds,
            session.revision + 1,
        )?);
    }
    // A deletion before publication invalidates any in-progress staged contribution.
    writes.push(statement(db, "DELETE FROM staged_results WHERE participant_id=?1 AND EXISTS(SELECT 1 FROM periods p WHERE p.period_id=staged_results.period_id AND p.state='finalizing' AND p.target_version=staged_results.version)", &[text(&session.participant_id)])?);
    writes.push(statement(db, "UPDATE period_roster SET state='pending' WHERE participant_id=?1 AND state='completed' AND EXISTS(SELECT 1 FROM periods p WHERE p.period_id=period_roster.period_id AND p.state='finalizing' AND p.target_version=period_roster.version)", &[text(&session.participant_id)])?);
    writes.push(statement(db, "UPDATE period_corrections SET state='expired' WHERE state IN ('building','ready') AND EXISTS(SELECT 1 FROM period_roster r WHERE r.period_id=period_corrections.period_id AND r.version=period_corrections.version AND r.participant_id=?1)", &[text(&session.participant_id)])?);
    let out = serde_json::json!({"operation_id": input.operation_id, "state": "completed", "error_code": null, "request_id": request_id});
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,?3,?4,?5)",
        &[
            text(&session.participant_id),
            text(input.operation_id.as_str()),
            text(route),
            crate::auth_runtime::blob(&hash),
            text(&out.to_string()),
        ],
    )?);
    writes.push(statement(
        db,
        "UPDATE participant_revisions SET revision=revision+1 WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?);
    writes.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1 OR guard_id=?2",
        &[text(&guard), text(&format!("{guard}-revision"))],
    )?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&out)
}
