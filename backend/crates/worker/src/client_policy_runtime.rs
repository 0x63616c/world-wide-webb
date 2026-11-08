use crate::{auth_runtime::Failure, client_policy::parse_build};
use folding_domain::wire::Id;
use worker::*;

fn minimum(env: &Env) -> std::result::Result<u32, Failure> {
    let value = env
        .var("MINIMUM_IOS_BUILD")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "0".into());
    parse_build(&value).ok_or_else(Failure::unavailable)
}

pub(crate) fn policy(env: &Env, id: &Id) -> std::result::Result<Response, Failure> {
    let mut response = Response::from_json(&serde_json::json!({
        "minimum_ios_build": minimum(env)?, "request_id": id,
    }))
    .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(response)
}

pub(crate) fn rejection(
    request: &Request,
    env: &Env,
    id: &Id,
) -> std::result::Result<Option<Response>, Failure> {
    if crate::client_policy::retirement_exempt(request.method().as_ref(), &request.path()) {
        return Ok(None);
    }
    let floor = minimum(env)?;
    if floor == 0 {
        return Ok(None);
    }
    let supplied = request
        .headers()
        .get("X-Folding-Build")
        .map_err(|_| Failure::unavailable())?
        .and_then(|v| parse_build(&v));
    if supplied.is_some_and(|build| build >= floor) {
        return Ok(None);
    }
    let mut response = Response::from_json(&serde_json::json!({
        // Older uploaders treat nonretryable errors as terminal. Keep their outbox
        // recoverable across an update or policy rollback, with a long retry delay.
        "code":"app_update_required", "request_id":id, "retryable":true,
        "retry_after_seconds":3600,
        "minimum_ios_build":floor,
    }))
    .map_err(|_| Failure::unavailable())?
    .with_status(426);
    response
        .headers_mut()
        .set("Retry-After", "3600")
        .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("X-Folding-Minimum-Build", &floor.to_string())
        .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(Some(response))
}
