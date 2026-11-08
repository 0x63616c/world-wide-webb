use folding_domain::wire::{Id, MAX_JSON_BYTES, WireError};
use futures_util::StreamExt;
use wasm_bindgen::JsCast;
use worker::*;

fn request_id() -> Result<Id> {
    let scope = js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>();
    let crypto = scope
        .crypto()
        .map_err(|_| Error::RustError("crypto_unavailable".into()))?;
    Id::parse(&crypto.random_uuid()).map_err(|_| Error::RustError("request_id_unavailable".into()))
}
fn error(status: u16, code: &str, id: Id, retryable: bool) -> Result<Response> {
    let mut response = Response::from_json(&WireError {
        code: code.into(),
        request_id: id,
        retryable,
        retry_after_seconds: if status == 429 { Some(60) } else { None },
    })?
    .with_status(status);
    if status == 429 {
        response.headers_mut().set("Retry-After", "60")?;
    }
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    Ok(response)
}

#[event(fetch)]
async fn fetch(request: Request, env: Env, context: Context) -> Result<Response> {
    let id = request_id()?;
    let route = crate::monitoring_runtime::route(&request.path());
    // Log only a bounded numeric build, never arbitrary client-supplied header text.
    let client_build = request
        .headers()
        .get("X-Folding-Build")
        .ok()
        .flatten()
        .and_then(|value| crate::client_policy::parse_build(&value));
    let started = js_sys::Date::now();
    let version = env
        .var("WORKER_VERSION")
        .map(|v| v.to_string())
        .unwrap_or_else(|_| "unconfigured".into());
    let burst = if request.path().starts_with("/v1/")
        && request.url().is_ok_and(|url| url.scheme() == "https")
    {
        crate::burst_limit::enforce(&request, &env).await
    } else {
        Ok(())
    };
    let admitted = burst.is_ok();
    let result = match burst {
        Ok(()) => handle(request, &env, id.clone()).await,
        Err(failure) => error(failure.status, failure.code, id.clone(), failure.retryable),
    };
    let status = result.as_ref().map(|r| r.status_code()).unwrap_or(500);
    // Object-valued console entries are indexed as fields by Workers Logs.
    let event = serde_json::json!({"event":"request","request_id":id,"worker_version":version,"client_build":client_build,"route":route,"outcome":format!("http_{status}"),"status":status,"duration_ms":(js_sys::Date::now()-started).max(0.0) as u64});
    if let Ok(event) = js_sys::JSON::parse(&event.to_string()) {
        web_sys::console::log_1(&event);
    }
    // Rejections must not turn an unauthenticated flood into one D1 write per request.
    if admitted && route == "events.submit" && ((200..300).contains(&status) || status >= 500) {
        context.wait_until(async move {
            if let Ok(db) = env.d1("DB")
                && crate::monitoring_runtime::record(&db, status)
                    .await
                    .is_err()
            {
                console_error!("ingestion_metrics_unavailable");
            }
        });
    }
    result
}
async fn handle(mut request: Request, env: &Env, id: Id) -> Result<Response> {
    if !request.url().is_ok_and(|url| url.scheme() == "https") {
        return error(400, "malformed_request", id, false);
    }
    let path = request.path();
    if request.method() == Method::Get && path == "/v1/client-policy" {
        return match crate::client_policy_runtime::policy(env, &id).await {
            Ok(response) => Ok(response),
            Err(failure) => error(failure.status, failure.code, id, failure.retryable),
        };
    }
    if path.starts_with("/v1/") {
        match crate::client_policy_runtime::rejection(&request, env, &id).await {
            Ok(Some(response)) => return Ok(response),
            Ok(None) => (),
            Err(failure) => return error(failure.status, failure.code, id, failure.retryable),
        }
    }
    if path == "/"
        && matches!(request.method(), Method::Get | Method::Head)
        && env.var("ADMIN_ORIGIN").is_ok_and(|origin| {
            request
                .url()
                .is_ok_and(|url| url.origin().ascii_serialization() == origin.to_string())
        })
    {
        let mut redirect = Response::empty()?.with_status(303);
        redirect.headers_mut().set("Location", "/admin")?;
        redirect.headers_mut().set("Cache-Control", "no-store")?;
        return Ok(redirect);
    }
    if request.method() == Method::Get && path == "/v1/health" {
        return crate::monitoring_runtime::health(env).await;
    }
    // Auth handlers have their own complete trust boundary. Unimplemented community/admin routes
    // remain unavailable; an arbitrary bearer header never authorizes a request.
    if !path.starts_with("/v1/") && path != "/admin" && !path.starts_with("/admin/") {
        return error(404, "not_found", id, false);
    }
    let mut body = Vec::new();
    let avatar_delete = request.method() == Method::Delete && path.starts_with("/v1/avatars/");
    let max_body = if request.method() == Method::Put && path.starts_with("/v1/avatars/") {
        crate::avatar::MAX_INPUT_BYTES
    } else {
        MAX_JSON_BYTES
    };
    if request.method() != Method::Get && request.method() != Method::Head && !avatar_delete {
        if let Some(length) = request.headers().get("Content-Length")? {
            let Ok(length) = length.parse::<usize>() else {
                return error(400, "malformed_request", id, false);
            };
            if length > max_body {
                return error(413, "body_too_large", id, false);
            }
        }
        let Ok(mut stream) = request.stream() else {
            return error(400, "malformed_request", id, false);
        };
        let mut length = 0usize;
        while let Some(chunk) = stream.next().await {
            let Ok(chunk) = chunk else {
                return error(400, "malformed_request", id, false);
            };
            length = length.saturating_add(chunk.len());
            if length > max_body {
                return error(413, "body_too_large", id, false);
            }
            body.extend(chunk);
        }
        if length == 0 {
            return error(400, "malformed_request", id, false);
        }
    }
    if path == "/admin" || path.starts_with("/admin/") {
        return match crate::admin_runtime::dispatch(&request, env, &body).await {
            Ok(response) => Ok(response),
            Err(failure) => {
                let message = if failure.status == 409 {
                    "Changed since loading. Reload and try again."
                } else if failure.status == 401 {
                    "Sign in to continue."
                } else {
                    "Unable to complete this request."
                };
                let mut response=Response::from_html(format!("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Folding</title><p>{message}</p><a href=\"/admin/participants\">Reload</a></html>"))?.with_status(failure.status);
                response.headers_mut().set("Cache-Control", "no-store")?;
                response.headers_mut().set(
                    "Content-Security-Policy",
                    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
                )?;
                Ok(response)
            }
        };
    }
    match crate::auth_runtime::dispatch(&request, env, &body, &id).await {
        Ok(Some(response)) => Ok(response),
        Ok(None) => error(503, "temporarily_unavailable", id, true),
        Err(failure) => error(failure.status, failure.code, id, failure.retryable),
    }
}
