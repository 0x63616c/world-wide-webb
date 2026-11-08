//! Retrospective photo removal behind Access authorization.
use crate::{
    admin_auth::Administrator,
    admin_runtime::Command,
    auth_runtime::{Failure, blob, now, number, statement, text, uuid},
};
use serde::{Deserialize, Serialize};
use worker::*;
#[derive(Deserialize, Serialize)]
struct Asset {
    participant_id: String,
    state: String,
    original_key: String,
    derivative_key: String,
    revision: i64,
    participant_revision: i64,
    account_state: String,
}
pub(crate) async fn image(env: &Env, db: &D1Database, id: &str) -> Result<Response, Failure> {
    folding_domain::wire::Id::parse(id).map_err(|_| Failure::malformed())?;
    #[derive(Deserialize)]
    struct Key {
        derivative_key: String,
    }
    let key=statement(db,"SELECT derivative_key FROM avatar_objects WHERE avatar_id=?1 AND state IN ('pending','approved')",&[text(id)])?.first::<Key>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    let object = env
        .bucket("AVATARS")
        .map_err(|_| Failure::unavailable())?
        .get(&key.derivative_key)
        .execute()
        .await
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
    if object.size() == 0 || object.size() > 1048576 {
        return Err(Failure::unavailable());
    }
    let bytes = object
        .body()
        .ok_or_else(Failure::unavailable)?
        .bytes()
        .await
        .map_err(|_| Failure::unavailable())?;
    let mut result = Response::from_bytes(bytes).map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("Content-Type", "image/jpeg")
        .map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    result
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")
        .map_err(|_| Failure::unavailable())?;
    Ok(result)
}
pub(crate) async fn remove(
    db: &D1Database,
    admin: &Administrator,
    input: &Command,
    id: &str,
    hash: &[u8],
) -> Result<Response, Failure> {
    let asset=statement(db,"SELECT a.participant_id,a.state,a.original_key,a.derivative_key,a.revision,r.revision AS participant_revision,p.account_state FROM avatar_objects a JOIN participants p ON p.participant_id=a.participant_id JOIN participant_revisions r ON r.participant_id=p.participant_id WHERE a.avatar_id=?1",&[text(id)])?.first::<Asset>(None).await.map_err(|_|Failure::unavailable())?.ok_or(Failure{status:404,code:"not_found",retryable:false})?;
    if asset.participant_id != input.participant_id.as_str()
        || asset.revision != input.expected_revision
        || asset.account_state != "active"
    {
        return Err(Failure::conflict());
    }
    let guard = uuid()?;
    let time = now();
    let participant = &asset.participant_id;
    let mut writes = vec![statement(
        db,
        "INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM avatar_objects a JOIN participant_revisions r ON r.participant_id=a.participant_id JOIN participants p ON p.participant_id=a.participant_id WHERE a.avatar_id=?2 AND a.participant_id=?3 AND a.revision=?4 AND r.revision=?5 AND p.account_state='active') THEN 1 ELSE 0 END)",
        &[
            text(&guard),
            text(id),
            text(participant),
            number(asset.revision),
            number(asset.participant_revision),
        ],
    )?];
    let state = "removed";
    writes.push(statement(db,"INSERT INTO avatar_purge_jobs(object_key,participant_id) VALUES (?1,?2) ON CONFLICT(object_key) DO NOTHING",&[text(&asset.derivative_key),text(participant)])?);
    writes.push(statement(db,"UPDATE profiles SET avatar_id=CASE WHEN avatar_id=?1 THEN NULL ELSE avatar_id END,avatar_status=CASE WHEN avatar_id IS NOT NULL AND avatar_id<>?1 THEN 'approved' ELSE 'none' END WHERE participant_id=?2",&[text(id),text(participant)])?);
    writes.push(statement(db,"INSERT INTO avatar_purge_jobs(object_key,participant_id) VALUES (?1,?2) ON CONFLICT(object_key) DO NOTHING",&[text(&asset.original_key),text(participant)])?);
    writes.push(statement(
        db,
        "UPDATE avatar_objects SET state=?1,reason_code=?2,revision=revision+1 WHERE avatar_id=?3",
        &[text(state), text("moderator_removed"), text(id)],
    )?);
    writes.push(statement(
        db,
        "INSERT INTO moderation_actions VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        &[
            text(&admin.actor),
            text(input.operation_id.as_str()),
            text(participant),
            text(&format!("avatar_{}", input.action)),
            text(&input.reason),
            text(
                &serde_json::json!({"avatar_id":id,"state":asset.state,"revision":asset.revision})
                    .to_string(),
            ),
            text(&serde_json::json!({"avatar_id":id,"state":state}).to_string()),
            blob(hash),
            number(time),
            number(time + 7776000000),
        ],
    )?);
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(participant)],
    )?);
    writes.push(statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1",
        &[text(&guard)],
    )?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    let mut response = Response::empty()
        .map_err(|_| Failure::unavailable())?
        .with_status(303);
    response
        .headers_mut()
        .set("Location", "/admin/queue?kind=avatars")
        .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(response)
}
