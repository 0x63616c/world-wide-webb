//! Public history reset and leave. Local/private CloudKit erasure remains the native app's command.
use crate::{
    auth_runtime::{
        Configuration, Failure, authenticated_session, blob, decode, now, number, response,
        session_guard, statement, text, uuid,
    },
    competition_runtime::{cleanup, guards, receipt},
    protected_request,
};
use folding_domain::wire::{Generation, Id, ResetRequest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize)]
struct State {
    epoch_id: Option<String>,
    membership: String,
    generation_revision: u64,
    generation_id: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Leave {
    operation_id: Id,
}
pub(crate) async fn reset(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: ResetRequest = decode(body)?;
    input.validate().map_err(|_| Failure::malformed())?;
    let verified = protected_request::verify(request, env, db, config, body, "reset").await?;
    let session = &verified.session;
    let guard = uuid()?;
    let time = now();
    let hash = Sha256::digest(serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?);
    let mut writes = guards(db, config, &verified, &guard, time)?;
    writes.extend(verified.consume(db)?);
    let current=statement(db,"SELECT epoch_id,membership,generation_revision,generation_id FROM participants WHERE participant_id=?1",&[text(&session.participant_id)])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    if current.membership != "joined"
        || current.epoch_id.as_deref() != Some(input.epoch_id.as_str())
    {
        return Err(Failure {
            status: 409,
            code: "epoch_stale",
            retryable: false,
        });
    }
    if let Some(old) = receipt(db, &session.participant_id, &input.operation_id).await? {
        if old.route != "/v1/resets" || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        return response(&value);
    }
    let old = Generation {
        revision: current.generation_revision,
        reset_id: Id::parse(&current.generation_id).map_err(|_| Failure::unavailable())?,
    };
    let winning = input.generation > old;
    let winner = if winning { &input.generation } else { &old };
    if winning {
        writes.extend(erase_results(db, &session.participant_id)?);
        writes.push(statement(db,"UPDATE participants SET generation_revision=?1,generation_id=?2 WHERE participant_id=?3",&[number(winner.revision as i64),text(winner.reset_id.as_str()),text(&session.participant_id)])?);
        writes.push(statement(db,"UPDATE epochs SET generation_revision=?1,generation_id=?2 WHERE epoch_id=?3 AND participant_id=?4 AND closed_at_ms IS NULL",&[number(winner.revision as i64),text(winner.reset_id.as_str()),text(input.epoch_id.as_str()),text(&session.participant_id)])?);
        for table in ["live_scores", "score_jobs"] {
            writes.push(statement(
                db,
                &format!("DELETE FROM {table} WHERE participant_id=?1"),
                &[text(&session.participant_id)],
            )?);
        }
    }
    let value = serde_json::json!({"operation_id":input.operation_id,"generation":winner,"state":if input.generation>=old{"acknowledged"}else{"superseded"},"request_id":request_id});
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,'/v1/resets',?3,?4)",
        &[
            text(&session.participant_id),
            text(input.operation_id.as_str()),
            blob(&hash),
            text(&value.to_string()),
        ],
    )?);
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(&session.participant_id)],
    )?);
    writes.push(cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&value)
}
pub(crate) const PRIVACY_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id
 WHERE p.participant_id=?2 AND p.account_state='active' AND r.revision=?3
) THEN 1 ELSE 0 END)
"#;
pub(crate) async fn leave(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: Leave = decode(body)?;
    let session = authenticated_session(request, db, config, false).await?;
    let guard = uuid()?;
    let time = now();
    let hash = Sha256::digest(serde_json::to_vec(&input).map_err(|_| Failure::unavailable())?);
    let mut writes = vec![
        session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            PRIVACY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
    ];
    if let Some(old) = receipt(db, &session.participant_id, &input.operation_id).await? {
        if old.route != "/v1/enrollment/leave" || old.normalized_hash != hash.as_slice() {
            return Err(Failure::conflict());
        }
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        return Ok(response(&value)?.with_status(202));
    }
    writes.extend(erase_results(db, &session.participant_id)?);
    writes.extend(crate::avatar_runtime::purge_owned(
        db,
        &session.participant_id,
    )?);
    writes.push(statement(
        db,
        "UPDATE epochs SET closed_at_ms=?1 WHERE participant_id=?2 AND closed_at_ms IS NULL",
        &[number(time), text(&session.participant_id)],
    )?);
    writes.push(statement(db,"UPDATE participants SET membership='left',epoch_id=NULL,active_device_id=NULL WHERE participant_id=?1",&[text(&session.participant_id)])?);
    for table in [
        "observations",
        "live_scores",
        "score_jobs",
        "push_installations",
    ] {
        writes.push(statement(
            db,
            &format!("DELETE FROM {table} WHERE participant_id=?1"),
            &[text(&session.participant_id)],
        )?);
    }
    let value = serde_json::json!({"operation_id":input.operation_id,"state":"pending","error_code":null,"request_id":request_id});
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,'/v1/enrollment/leave',?3,?4)",
        &[
            text(&session.participant_id),
            text(input.operation_id.as_str()),
            blob(&hash),
            text(&value.to_string()),
        ],
    )?);
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(&session.participant_id)],
    )?);
    writes.push(cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    Ok(response(&value)?.with_status(202))
}

pub(crate) fn erase_results(
    db: &D1Database,
    participant: &str,
) -> std::result::Result<Vec<D1PreparedStatement>, Failure> {
    Ok(vec![
        statement(
            db,
            "DELETE FROM results WHERE participant_id=?1",
            &[text(participant)],
        )?,
        statement(
            db,
            "DELETE FROM period_roster WHERE participant_id=?1",
            &[text(participant)],
        )?,
        statement(
            db,
            "UPDATE award_jobs SET state='suppressed' WHERE participant_id=?1 AND state<>'sent'",
            &[text(participant)],
        )?,
    ])
}
