//! Authenticated owner reads. No leaderboard or history is disclosed before joined authorization.
use crate::auth_runtime::{
    Configuration, Failure, authenticated_session, response, statement, text,
};
use serde::{Deserialize, Serialize};
use worker::*;
#[derive(Deserialize, Serialize)]
struct Profile {
    participant_id: String,
    nickname: String,
    avatar_id: Option<String>,
    membership: String,
    restriction: String,
    nickname_status: String,
    avatar_status: String,
    pending_avatar_id: Option<String>,
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
pub(crate) async fn read(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &folding_domain::wire::Id,
) -> std::result::Result<Response, Failure> {
    let session = authenticated_session(request, db, config, false).await?;
    if request.path() == "/v1/me" {
        let profile=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.membership,p.restriction,f.nickname_status,f.avatar_status,(SELECT a.avatar_id FROM avatar_objects a WHERE a.participant_id=p.participant_id AND a.state IN ('uploading','pending') ORDER BY a.created_at_ms DESC,a.avatar_id DESC LIMIT 1) AS pending_avatar_id FROM participants p JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(&session.participant_id)])?.first::<Profile>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
        let epoch=statement(db,"SELECT e.epoch_id,e.device_id,e.generation_revision,e.generation_id,e.joined_at_ms,e.issued_at_ms FROM epochs e JOIN participants p ON p.epoch_id=e.epoch_id WHERE p.participant_id=?1 AND p.membership='joined' AND e.closed_at_ms IS NULL",&[text(&session.participant_id)])?.first::<Epoch>(None).await.map_err(|_|Failure::unavailable())?;
        let enrollment=epoch.map(|e|serde_json::json!({"epoch_id":e.epoch_id,"device_id":e.device_id,"generation":{"revision":e.generation_revision,"reset_id":e.generation_id},"joined_at_ms":e.joined_at_ms,"issued_at_ms":e.issued_at_ms,"history_import_before_ms":e.joined_at_ms}));
        let preferences =
            crate::notification_runtime::preferences(db, &session.participant_id).await?;
        return response(
            &serde_json::json!({"profile":profile,"enrollment":enrollment,"preferences":preferences,"pending_operations":[],"is_admin":is_admin(db,config,&session.participant_id).await?,"request_id":request_id}),
        );
    }
    let path = request.path();
    let operation = path
        .strip_prefix("/v1/event-batches/")
        .ok_or_else(Failure::malformed)?;
    let id = folding_domain::wire::Id::parse(operation).map_err(|_| Failure::malformed())?;
    let receipt = crate::competition_runtime::receipt(db, &session.participant_id, &id)
        .await?
        .filter(|r| r.route == "/v1/event-batches")
        .ok_or(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        })?;
    let value: serde_json::Value =
        serde_json::from_str(&receipt.response_json).map_err(|_| Failure::unavailable())?;
    response(&value)
}

async fn is_admin(
    db: &D1Database,
    config: &Configuration,
    participant: &str,
) -> std::result::Result<bool, Failure> {
    if config
        .admin_participant_ids
        .iter()
        .any(|id| id.eq_ignore_ascii_case(participant))
    {
        return Ok(true);
    }
    #[derive(Deserialize)]
    struct Role {
        present: i64,
    }
    Ok(statement(
        db,
        "SELECT EXISTS(SELECT 1 FROM participant_roles WHERE participant_id=?1 AND role='admin') AS present",
        &[text(participant)],
    )?
    .first::<Role>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .is_some_and(|r| r.present == 1))
}

pub(crate) async fn admin_participant(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &folding_domain::wire::Id,
) -> std::result::Result<Response, Failure> {
    let session = authenticated_session(request, db, config, false).await?;
    if !is_admin(db, config, &session.participant_id).await? {
        return Err(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        });
    }
    let path = request.path();
    let raw = path
        .strip_prefix("/v1/admin/participants/")
        .ok_or_else(Failure::malformed)?;
    let participant = folding_domain::wire::Id::parse(raw).map_err(|_| Failure::malformed())?;
    let details=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.membership,p.restriction,p.account_state,p.generation_revision,p.generation_id,p.epoch_id,e.joined_at_ms,e.device_id,r.revision,b.persona_id,b.persona_version,b.joined_at_ms AS bot_joined_at_ms,b.retired_at_ms,b.paused_at_ms,b.avatar_style FROM participants p JOIN profiles f ON f.participant_id=p.participant_id LEFT JOIN epochs e ON e.epoch_id=p.epoch_id LEFT JOIN participant_revisions r ON r.participant_id=p.participant_id LEFT JOIN bot_profiles b ON b.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(participant.as_str())])?.first::<serde_json::Value>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    let mut value = details;
    let is_bot = value.get("persona_id").is_some_and(|v| !v.is_null());
    if let Some(object) = value.as_object_mut() {
        object.insert("is_bot".into(), serde_json::Value::Bool(is_bot));
    }
    response(&serde_json::json!({"participant":value,"request_id":request_id}))
}
