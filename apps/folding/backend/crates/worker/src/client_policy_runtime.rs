use crate::{auth_runtime::Failure, client_policy::parse_build};
use folding_domain::wire::Id;
use worker::*;

// Shared durable policy with a short isolate cache to avoid a database read on every request.
// Never cache failures or keep an expired policy during a database outage.
use std::cell::{Cell, RefCell};
thread_local! {
    static MINIMUM: RefCell<Option<(f64, u32)>> = const { RefCell::new(None) };
    static REVISION: Cell<u64> = const { Cell::new(0) };
}
pub(crate) fn invalidate() {
    MINIMUM.with(|cache| *cache.borrow_mut() = None);
    REVISION.with(|revision| revision.set(revision.get().wrapping_add(1)));
}
async fn minimum(env: &Env) -> std::result::Result<u32, Failure> {
    let now = js_sys::Date::now();
    if let Some(floor) = MINIMUM.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .filter(|(time, _)| now >= *time && now - time < 60_000.0)
            .map(|(_, floor)| *floor)
    }) {
        return Ok(floor);
    }
    let revision = REVISION.with(Cell::get);
    #[derive(serde::Deserialize)]
    struct Policy {
        minimum_ios_build: u32,
    }
    let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
    let policy = crate::auth_runtime::statement(
        &db,
        "SELECT minimum_ios_build FROM administrative_configuration WHERE singleton=1",
        &[],
    )?
    .first::<Policy>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .ok_or_else(Failure::unavailable)?;
    if policy.minimum_ios_build > i32::MAX as u32 {
        return Err(Failure::unavailable());
    }
    // An in-flight read must not repopulate the local cache after an admin change.
    if REVISION.with(Cell::get) == revision {
        MINIMUM.with(|cache| *cache.borrow_mut() = Some((now, policy.minimum_ios_build)));
    }
    Ok(policy.minimum_ios_build)
}

pub(crate) async fn policy(env: &Env, id: &Id) -> std::result::Result<Response, Failure> {
    let mut response = Response::from_json(&serde_json::json!({
        "minimum_ios_build": minimum(env).await?, "request_id": id,
    }))
    .map_err(|_| Failure::unavailable())?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    Ok(response)
}

pub(crate) async fn rejection(
    request: &Request,
    env: &Env,
    id: &Id,
) -> std::result::Result<Option<Response>, Failure> {
    if crate::client_policy::retirement_exempt(request.method().as_ref(), &request.path()) {
        return Ok(None);
    }
    let floor = minimum(env).await?;
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
