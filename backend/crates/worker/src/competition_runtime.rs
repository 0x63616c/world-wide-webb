//! Atomic authenticated event ingestion. Observation identity and scores are server owned.
use crate::{
    auth_runtime::{
        COMMUNITY_GUARD, Configuration, Failure, blob, decode, now, number, response,
        session_guard, statement, text, uuid,
    },
    ingestion::{StoredObservation, plan_batch_with_deletions},
    protected_request::{self, VerifiedRequest},
};
use folding_domain::{
    competition::Enrollment,
    wire::{Disposition, Event, EventBatch, Generation, Id},
};
use serde::Deserialize;
use worker::*;

#[derive(Deserialize)]
struct Epoch {
    epoch_id: String,
    device_id: String,
    generation_revision: u64,
    generation_id: String,
    issued_at_ms: u64,
}
#[derive(Deserialize)]
struct Observation {
    event_json: String,
    disposition: Disposition,
}
#[derive(Deserialize)]
pub(crate) struct Receipt {
    pub route: String,
    pub normalized_hash: Vec<u8>,
    pub response_json: String,
}
pub(crate) async fn receipt(
    db: &D1Database,
    participant: &str,
    operation: &Id,
) -> std::result::Result<Option<Receipt>, Failure> {
    statement(db,"SELECT route,normalized_hash,response_json FROM competition_operations WHERE participant_id=?1 AND operation_id=?2",&[text(participant),text(operation.as_str())])?.first::<Receipt>(None).await.map_err(|_|Failure::unavailable())
}
pub(crate) fn guards(
    db: &D1Database,
    config: &Configuration,
    verified: &VerifiedRequest,
    id: &str,
    time: i64,
) -> std::result::Result<Vec<D1PreparedStatement>, Failure> {
    Ok(vec![
        session_guard(db, id, &verified.session, config, time)?,
        statement(
            db,
            COMMUNITY_GUARD,
            &[
                text(&format!("{id}-community")),
                text(&verified.session.participant_id),
                number(verified.session.revision),
            ],
        )?,
        verified.guard(db, config, &format!("{id}-assertion"), time)?,
    ])
}
pub(crate) fn cleanup(
    db: &D1Database,
    id: &str,
) -> std::result::Result<D1PreparedStatement, Failure> {
    statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1 OR guard_id=?2 OR guard_id=?3 OR guard_id=?4",
        &[
            text(id),
            text(&format!("{id}-community")),
            text(&format!("{id}-assertion")),
            text(&format!("{id}-business")),
        ],
    )
}
pub(crate) async fn events(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let batch: EventBatch = decode(body)?;
    batch.validate().map_err(|_| Failure::malformed())?;
    let verified =
        protected_request::verify(request, env, db, config, body, "submit_events").await?;
    let session = &verified.session;
    let epoch=statement(db,"SELECT e.epoch_id,e.device_id,e.generation_revision,e.generation_id,e.issued_at_ms FROM epochs e JOIN participants p ON p.epoch_id=e.epoch_id WHERE p.participant_id=?1 AND p.membership='joined' AND p.active_device_id=?2 AND e.participant_id=p.participant_id AND e.closed_at_ms IS NULL AND p.generation_revision=e.generation_revision AND p.generation_id=e.generation_id",&[text(&session.participant_id),text(&session.device_id)])?.first::<Epoch>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::conflict)?;
    if batch.epoch_id.as_str() != epoch.epoch_id {
        return Err(Failure {
            status: 409,
            code: "epoch_stale",
            retryable: false,
        });
    }
    let hash = crate::ingestion::normalized_batch_hash(&batch).map_err(|_| Failure::malformed())?;
    let guard = uuid()?;
    let time = now();
    let mut writes = guards(db, config, &verified, &guard, time)?;
    writes.push(statement(
        db,
        ACTIVE_EPOCH_GUARD,
        &[
            text(&format!("{guard}-business")),
            text(&session.participant_id),
            text(&epoch.epoch_id),
            text(&epoch.device_id),
            number(epoch.generation_revision as i64),
            text(&epoch.generation_id),
        ],
    )?);
    writes.extend(verified.consume(db)?);
    if let Some(old) = receipt(db, &session.participant_id, &batch.operation_id).await? {
        if old.route != "/v1/event-batches" || old.normalized_hash != hash {
            return Err(Failure::conflict());
        }
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        return response(&value);
    }
    crate::rate_limit::enforce(
        db,
        config,
        "event-batches",
        &session.participant_id,
        60000,
        60,
    )
    .await?;
    let rows = statement(
        db,
        "SELECT event_json,disposition FROM observations WHERE participant_id=?1",
        &[text(&session.participant_id)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Observation>()
    .map_err(|_| Failure::unavailable())?;
    let previous: Vec<StoredObservation> = rows
        .into_iter()
        .map(|row| {
            let event: Event =
                serde_json::from_str(&row.event_json).map_err(|_| Failure::unavailable())?;
            Ok(StoredObservation {
                event,
                disposition: row.disposition,
            })
        })
        .collect::<std::result::Result<_, Failure>>()?;
    let device = Id::parse(&epoch.device_id).map_err(|_| Failure::unavailable())?;
    let epoch_id = Id::parse(&epoch.epoch_id).map_err(|_| Failure::unavailable())?;
    let generation = Generation {
        revision: epoch.generation_revision,
        reset_id: Id::parse(&epoch.generation_id).map_err(|_| Failure::unavailable())?,
    };
    let enrollment = Enrollment {
        device_id: &device,
        epoch_id: &epoch_id,
        generation: &generation,
        issued_at_ms: epoch.issued_at_ms,
    };
    let deleted = crate::entry_deletion_runtime::deleted_ids(db, &session.participant_id).await?;
    let plan = plan_batch_with_deletions(
        &batch,
        &previous,
        &enrollment,
        time as u64,
        request_id.clone(),
        &deleted,
    )
    .map_err(|_| Failure {
        status: 409,
        code: "identity_conflict",
        retryable: false,
    })?;
    writes.push(statement(
        db,
        "UPDATE decision_clock SET version=version+1 WHERE singleton=1",
        &[],
    )?);
    for new in &plan.new_observations {
        let disposition = match new.disposition {
            Disposition::Accepted => "accepted",
            Disposition::Quarantined => "quarantined",
            Disposition::Rejected => "rejected",
            Disposition::Duplicate => return Err(Failure::unavailable()),
        };
        writes.push(statement(
            db,
            "INSERT INTO observations(participant_id,event_id,device_id,sequence,event_json,disposition,reason_code,received_at_ms,decision_version,submission_id) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,(SELECT version FROM decision_clock WHERE singleton=1),?9)",
            &[
                text(&session.participant_id),
                text(new.event.event_id.as_str()),
                text(new.event.device_id.as_str()),
                number(new.event.sequence as i64),
                text(&serde_json::to_string(&new.event).map_err(|_| Failure::unavailable())?),
                text(disposition),
                new.reason_code
                    .as_deref()
                    .map(text)
                    .unwrap_or(wasm_bindgen::JsValue::NULL),
                number(time),
                text(batch.operation_id.as_str()),
            ],
        )?);
    }
    let json = serde_json::to_string(&plan.receipt).map_err(|_| Failure::unavailable())?;
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,'/v1/event-batches',?3,?4)",
        &[
            text(&session.participant_id),
            text(batch.operation_id.as_str()),
            blob(&hash),
            text(&json),
        ],
    )?);
    writes.push(statement(db,"INSERT INTO live_scores VALUES (?1,?2,?3,'all',?4,?5) ON CONFLICT(participant_id,period_id) DO UPDATE SET generation_revision=excluded.generation_revision,generation_id=excluded.generation_id,folds=excluded.folds,revision=excluded.revision",&[text(&session.participant_id),number(generation.revision as i64),text(generation.reset_id.as_str()),number(plan.all_time_folds as i64),number(session.revision+1)])?);
    let mut windows = std::collections::BTreeMap::new();
    // Accepted timestamps may be up to five minutes ahead, including a calendar boundary.
    for timestamp in [time as u64, time as u64 + 300000] {
        for period in crate::periods::current(timestamp).ok_or_else(Failure::unavailable)? {
            windows.insert(period.id.clone(), period);
        }
    }
    for period in windows.values() {
        writes.push(statement(db,"INSERT INTO periods(period_id,kind,start_ms,end_ms,cutoff_ms,state) VALUES (?1,?2,?3,?4,?5,'open') ON CONFLICT(period_id) DO NOTHING",&[text(&period.id),text(period.kind),number(period.start_ms as i64),number(period.end_ms as i64),number((period.end_ms+86400000) as i64)])?);
        let folds = plan
            .counted_timestamps
            .iter()
            .filter(|&&timestamp| timestamp >= period.start_ms && timestamp < period.end_ms)
            .count();
        writes.push(statement(db,"INSERT INTO live_scores VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(participant_id,period_id) DO UPDATE SET generation_revision=excluded.generation_revision,generation_id=excluded.generation_id,folds=excluded.folds,revision=excluded.revision",&[text(&session.participant_id),number(generation.revision as i64),text(generation.reset_id.as_str()),text(&period.id),number(folds as i64),number(session.revision+1)])?);
    }
    writes.push(statement(db,"INSERT INTO score_jobs VALUES (?1,?2,'pending') ON CONFLICT(participant_id) DO UPDATE SET revision=excluded.revision,state='pending'",&[text(&session.participant_id),number(session.revision+1)])?);
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(&session.participant_id)],
    )?);
    writes.push(cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&plan.receipt)
}
pub(crate) const ACTIVE_EPOCH_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id
 WHERE p.participant_id=?2 AND p.membership='joined' AND p.epoch_id=?3 AND p.active_device_id=?4
 AND p.generation_revision=?5 AND p.generation_id=?6 AND e.closed_at_ms IS NULL
 AND e.participant_id=?2 AND e.device_id=?4 AND e.generation_revision=?5 AND e.generation_id=?6
) THEN 1 ELSE 0 END)
"#;
