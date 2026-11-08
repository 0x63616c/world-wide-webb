//! Public release handshake. The deployment owner enables only capabilities with acceptance evidence.
use crate::auth_runtime::{Failure, response};
use folding_domain::wire::Id;
use std::collections::BTreeSet;
use worker::*;
const IMPLEMENTED: &[&str] = &[
    "auth.apple",
    "auth.refresh",
    "auth.reauthenticate",
    "attest.enroll",
    "enrollment.join",
    "enrollment.transfer",
    "events.submit",
    "events.history_import",
    "notifications.badges",
    "events.receipt",
    "account.delete",
    "account.deletion_status",
    "account.deletion_recovery",
    "history.reset",
    "leaderboard.live",
    "results.finalized",
    "results.share",
    "avatars.upload",
    "avatars.moderation",
    "notifications.results",
    "profiles.edit",
    "profiles.milestones",
    "moderation.reports",
    "moderation.blocks",
];
pub(crate) fn get(env: &Env, request_id: &Id) -> std::result::Result<Response, Failure> {
    let version = env
        .var("WORKER_VERSION")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    if version.is_empty() || version.len() > 128 || version.chars().any(char::is_control) {
        return Err(Failure::unavailable());
    }
    let configured = env
        .var("VERIFIED_CAPABILITIES")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "[]".into());
    let mut enabled: Vec<String> =
        serde_json::from_str(&configured).map_err(|_| Failure::unavailable())?;
    if enabled.len() > IMPLEMENTED.len()
        || enabled.iter().any(|c| !IMPLEMENTED.contains(&c.as_str()))
    {
        return Err(Failure::unavailable());
    }
    if !env
        .var("AVATAR_UPLOADS_ENABLED")
        .is_ok_and(|v| v.to_string() == "true")
    {
        enabled.retain(|name| name != "avatars.upload");
    }
    if !env
        .var("APNS_ENABLED")
        .is_ok_and(|v| v.to_string() == "true")
    {
        enabled.retain(|name| name != "notifications.results" && name != "notifications.badges");
    }
    let capabilities: BTreeSet<_> = enabled.into_iter().collect();
    response(
        &serde_json::json!({"contract_version":1,"worker_version":version,"capabilities":capabilities,"request_id":request_id}),
    )
}
