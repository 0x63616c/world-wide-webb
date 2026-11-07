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
        let profile=statement(db,"SELECT p.participant_id,f.nickname,f.avatar_id,p.membership,p.restriction,f.nickname_status,f.avatar_status FROM participants p JOIN profiles f ON f.participant_id=p.participant_id WHERE p.participant_id=?1",&[text(&session.participant_id)])?.first::<Profile>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
        let epoch=statement(db,"SELECT e.epoch_id,e.device_id,e.generation_revision,e.generation_id,e.joined_at_ms,e.issued_at_ms FROM epochs e JOIN participants p ON p.epoch_id=e.epoch_id WHERE p.participant_id=?1 AND p.membership='joined' AND e.closed_at_ms IS NULL",&[text(&session.participant_id)])?.first::<Epoch>(None).await.map_err(|_|Failure::unavailable())?;
        let enrollment=epoch.map(|e|serde_json::json!({"epoch_id":e.epoch_id,"device_id":e.device_id,"generation":{"revision":e.generation_revision,"reset_id":e.generation_id},"joined_at_ms":e.joined_at_ms,"issued_at_ms":e.issued_at_ms}));
        return response(
            &serde_json::json!({"profile":profile,"enrollment":enrollment,"preferences":{"weekly":"off","monthly":"off","home_timezone":"UTC","locale":"en"},"pending_operations":[],"request_id":request_id}),
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
