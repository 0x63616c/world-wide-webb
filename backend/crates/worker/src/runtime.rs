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
async fn fetch(mut request: Request, env: Env, _context: Context) -> Result<Response> {
    let id = request_id()?;
    if !request.url().is_ok_and(|url| url.scheme() == "https") {
        return error(400, "malformed_request", id, false);
    }
    let path = request.path();
    // Auth handlers have their own complete trust boundary. Unimplemented community/admin routes
    // remain unavailable; an arbitrary bearer header never authorizes a request.
    if !path.starts_with("/v1/") {
        return error(404, "not_found", id, false);
    }
    let mut body = Vec::new();
    if request.method() != Method::Get && request.method() != Method::Head {
        if let Some(length) = request.headers().get("Content-Length")? {
            let Ok(length) = length.parse::<usize>() else {
                return error(400, "malformed_request", id, false);
            };
            if length > MAX_JSON_BYTES {
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
            if length > MAX_JSON_BYTES {
                return error(413, "body_too_large", id, false);
            }
            body.extend(chunk);
        }
        if length == 0 {
            return error(400, "malformed_request", id, false);
        }
    }
    match crate::auth_runtime::dispatch(&request, &env, &body, &id).await {
        Ok(Some(response)) => Ok(response),
        Ok(None) => error(503, "temporarily_unavailable", id, true),
        Err(failure) => error(failure.status, failure.code, id, failure.retryable),
    }
}
