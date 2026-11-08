//! Explicit membership and device ownership transitions, each fenced against concurrent mutation.
use crate::{
    auth_runtime::{
        Configuration, Failure, blob, decode, now, number, response, statement, text, uuid,
    },
    competition_runtime::{cleanup, guards, receipt},
    protected_request,
};
use folding_domain::wire::{Generation, Id};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Join {
    operation_id: Id,
    device_id: Id,
    generation: Generation,
    nickname: String,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Transfer {
    operation_id: Id,
    from_epoch_id: Id,
    device_id: Id,
    generation: Generation,
}
#[derive(Deserialize)]
struct State {
    membership: String,
    epoch_id: Option<String>,
    active_device_id: Option<String>,
    generation_revision: u64,
    generation_id: String,
}
#[derive(Deserialize, Serialize)]
struct Enrollment {
    epoch_id: String,
    device_id: String,
    generation: Generation,
    joined_at_ms: u64,
    issued_at_ms: u64,
}
#[derive(Deserialize)]
struct Epoch {
    epoch_id: String,
    device_id: String,
    generation_revision: u64,
    generation_id: String,
    joined_at_ms: u64,
    issued_at_ms: u64,
}
#[derive(Deserialize, Serialize)]
struct Profile {
    participant_id: String,
    nickname: String,
    avatar_id: Option<String>,
    membership: String,
    restriction: String,
    nickname_status: String,
    avatar_status: String,
}
async fn current(db: &D1Database, id: &str) -> std::result::Result<Enrollment, Failure> {
    let e=statement(db,"SELECT epoch_id,device_id,generation_revision,generation_id,joined_at_ms,issued_at_ms FROM epochs WHERE epoch_id=?1 AND closed_at_ms IS NULL",&[text(id)])?.first::<Epoch>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::conflict)?;
    Ok(Enrollment {
        epoch_id: e.epoch_id,
        device_id: e.device_id,
        generation: Generation {
            revision: e.generation_revision,
            reset_id: Id::parse(&e.generation_id).map_err(|_| Failure::unavailable())?,
        },
        joined_at_ms: e.joined_at_ms,
        issued_at_ms: e.issued_at_ms,
    })
}
pub(crate) async fn mutate(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
    transfer: bool,
) -> std::result::Result<Response, Failure> {
    let (operation, device, generation, nickname, prior, normalized) = if transfer {
        let v: Transfer = decode(body)?;
        let hash = Sha256::digest(serde_json::to_vec(&v).map_err(|_| Failure::unavailable())?);
        (
            v.operation_id,
            v.device_id,
            v.generation,
            None,
            Some(v.from_epoch_id),
            hash,
        )
    } else {
        let mut v: Join = decode(body)?;
        v.nickname = crate::name_policy::validate(&v.nickname)
            .map_err(|_| Failure::malformed())?
            .display;
        let hash = Sha256::digest(serde_json::to_vec(&v).map_err(|_| Failure::unavailable())?);
        (
            v.operation_id,
            v.device_id,
            v.generation,
            Some(v.nickname),
            None,
            hash,
        )
    };
    generation.validate().map_err(|_| Failure::malformed())?;
    let purpose = if transfer { "transfer" } else { "join" };
    let verified = protected_request::verify(request, env, db, config, body, purpose).await?;
    let session = &verified.session;
    if session.device_id != device.as_str() {
        return Err(Failure::unauthorized());
    }
    let time = now();
    let guard = uuid()?;
    let mut writes = guards(db, config, &verified, &guard, time)?;
    writes.extend(verified.consume(db)?);
    if let Some(old) = receipt(db, &session.participant_id, &operation).await? {
        if old.route != request.path() || old.normalized_hash != normalized.as_slice() {
            return Err(Failure::conflict());
        }
        // Do not resurrect a departed/transferred enrollment by replaying its historical receipt.
        let value: serde_json::Value =
            serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
        let epoch = value
            .get("enrollment")
            .and_then(|v| v.get("epoch_id"))
            .and_then(|v| v.as_str())
            .ok_or_else(Failure::unavailable)?;
        writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM participants WHERE participant_id=?2 AND membership='joined' AND epoch_id=?3 AND active_device_id=?4 AND generation_revision=?5 AND generation_id=?6) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(&session.participant_id),text(epoch),text(device.as_str()),number(generation.revision as i64),text(generation.reset_id.as_str())])?);
        writes.push(cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        return response(&value);
    }
    let state=statement(db,"SELECT membership,epoch_id,active_device_id,generation_revision,generation_id FROM participants WHERE participant_id=?1",&[text(&session.participant_id)])?.first::<State>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    let enrollment = if state.membership == "joined" && !transfer {
        if state.active_device_id.as_deref() != Some(device.as_str()) {
            return Err(Failure::conflict());
        }
        let e = current(db, state.epoch_id.as_deref().ok_or_else(Failure::conflict)?).await?;
        if e.generation != generation {
            return Err(Failure {
                status: 409,
                code: "generation_stale",
                retryable: false,
            });
        }
        e
    } else {
        if transfer {
            if state.generation_revision != generation.revision
                || state.generation_id != generation.reset_id.as_str()
            {
                return Err(Failure {
                    status: 409,
                    code: "generation_stale",
                    retryable: false,
                });
            }
            if state.membership != "joined"
                || state.epoch_id.as_deref() != prior.as_ref().map(Id::as_str)
                || state.active_device_id.as_deref() == Some(device.as_str())
            {
                return Err(Failure {
                    status: 409,
                    code: "epoch_stale",
                    retryable: false,
                });
            }
        }
        let joined = if transfer {
            current(db, state.epoch_id.as_deref().ok_or_else(Failure::conflict)?)
                .await?
                .joined_at_ms
        } else {
            time as u64
        };
        if let Some(old) = state.epoch_id.as_deref() {
            writes.push(statement(
                db,
                "UPDATE epochs SET closed_at_ms=?1 WHERE epoch_id=?2 AND closed_at_ms IS NULL",
                &[number(time), text(old)],
            )?);
        }
        if !transfer {
            // Rejoin begins new public totals; a leave cleanup need not finish before these owned rows purge.
            for table in ["observations", "live_scores", "score_jobs"] {
                writes.push(statement(
                    db,
                    &format!("DELETE FROM {table} WHERE participant_id=?1"),
                    &[text(&session.participant_id)],
                )?);
            }
        }
        let epoch = uuid()?;
        writes.push(statement(
            db,
            "INSERT INTO epochs VALUES (?1,?2,?3,?4,?5,?6,?7,NULL)",
            &[
                text(&epoch),
                text(&session.participant_id),
                text(device.as_str()),
                number(generation.revision as i64),
                text(generation.reset_id.as_str()),
                number(joined as i64),
                number(time),
            ],
        )?);
        writes.push(statement(db,"UPDATE participants SET membership='joined',epoch_id=?1,active_device_id=?2,generation_revision=?3,generation_id=?4 WHERE participant_id=?5",&[text(&epoch),text(device.as_str()),number(generation.revision as i64),text(generation.reset_id.as_str()),text(&session.participant_id)])?);
        Enrollment {
            epoch_id: epoch,
            device_id: device.as_str().into(),
            generation,
            joined_at_ms: joined,
            issued_at_ms: time as u64,
        }
    };
    let value = if transfer {
        serde_json::json!({"operation_id":operation,"enrollment":enrollment,"request_id":request_id})
    } else {
        let mut profile=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.membership,p.restriction,f.nickname_status,f.avatar_status FROM participants p JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(&session.participant_id)])?.first::<Profile>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
        profile.membership = "joined".into();
        if let Some(name) = nickname.filter(|n| n != &profile.nickname) {
            crate::rate_limit::enforce(
                db,
                config,
                "profile-edits",
                &session.participant_id,
                3600000,
                5,
            )
            .await?;
            writes.push(statement(
                db,
                "DELETE FROM nickname_requests WHERE participant_id=?1",
                &[text(&session.participant_id)],
            )?);
            writes.push(statement(
                db,
                "UPDATE profiles SET nickname=?1,nickname_status='approved' WHERE participant_id=?2",
                &[text(&name),text(&session.participant_id)],
            )?);
            profile.nickname = name;
            profile.nickname_status = "approved".into();
        }
        serde_json::json!({"operation_id":operation,"profile":profile,"enrollment":enrollment,"request_id":request_id})
    };
    writes.push(statement(
        db,
        "INSERT INTO competition_operations VALUES (?1,?2,?3,?4,?5)",
        &[
            text(&session.participant_id),
            text(operation.as_str()),
            text(&request.path()),
            blob(&normalized),
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
