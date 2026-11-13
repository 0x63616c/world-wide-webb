//! Supported API operations. Device/provider acceptance is tracked separately.
use crate::auth_runtime::{Failure, response};
use folding_domain::wire::Id;
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
    response(
        &serde_json::json!({"contract_version":1,"worker_version":version,"capabilities":IMPLEMENTED,"request_id":request_id}),
    )
}
