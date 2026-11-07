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
        retry_after_seconds: None,
    })?
    .with_status(status);
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    Ok(response)
}

#[event(fetch)]
async fn fetch(mut request: Request, _env: Env, _context: Context) -> Result<Response> {
    let id = request_id()?;
    let path = request.path();
    // No production success route until authenticators, account operations and transactional
    // storage are integrated. In particular, an arbitrary bearer header never authorizes a request.
    if !path.starts_with("/v1/") {
        return error(404, "not_found", id, false);
    }
    if request.method() != Method::Get && request.method() != Method::Head {
        if let Some(length) = request.headers().get("Content-Length")? {
            let Ok(length) = length.parse::<usize>() else {
                return error(400, "malformed_request", id, false);
            };
            if length > MAX_JSON_BYTES {
                return error(413, "body_too_large", id, false);
            }
        }
        let mut stream = request.stream()?;
        let mut length = 0usize;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            length = length.saturating_add(chunk.len());
            if length > MAX_JSON_BYTES {
                return error(413, "body_too_large", id, false);
            }
        }
    }
    error(503, "temporarily_unavailable", id, true)
}
