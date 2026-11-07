//! Bounded HTTPS-only Apple transport. Endpoints cannot be selected by mobile requests.
use crate::apple_identity::{AppleKeys, VerifiedIdentity, verify_identity_token};
use futures_util::StreamExt;
use serde::Deserialize;
use std::{cell::RefCell, rc::Rc};
use wasm_bindgen::JsValue;
use worker::*;

#[derive(Debug)]
pub enum AppleTransportError {
    Unavailable,
    Rejected,
    InvalidResponse,
}
struct CachedKeys {
    fetched_ms: f64,
    keys: Rc<AppleKeys>,
}
thread_local! {static KEYS:RefCell<Option<CachedKeys>>=const {RefCell::new(None)};}
async fn bounded_request(
    request: Request,
    limit: usize,
) -> std::result::Result<Vec<u8>, AppleTransportError> {
    let signal = AbortSignal::from(web_sys::AbortSignal::timeout_with_u32(10000));
    let mut response = Fetch::Request(request)
        .send_with_signal(&signal)
        .await
        .map_err(|_| AppleTransportError::Unavailable)?;
    if response.status_code() != 200 {
        return Err(if response.status_code() == 400 {
            AppleTransportError::Rejected
        } else {
            AppleTransportError::Unavailable
        });
    }
    if let Some(size) = response
        .headers()
        .get("Content-Length")
        .map_err(|_| AppleTransportError::InvalidResponse)?
        && size
            .parse::<usize>()
            .map_err(|_| AppleTransportError::InvalidResponse)?
            > limit
    {
        return Err(AppleTransportError::InvalidResponse);
    }
    let mut stream = response
        .stream()
        .map_err(|_| AppleTransportError::InvalidResponse)?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| AppleTransportError::Unavailable)?;
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppleTransportError::InvalidResponse);
        }
        bytes.extend(chunk);
    }
    Ok(bytes)
}
pub async fn apple_keys() -> std::result::Result<Rc<AppleKeys>, AppleTransportError> {
    let now = js_sys::Date::now();
    if let Some(keys) = KEYS.with(|cache| {
        cache
            .borrow()
            .as_ref()
            .filter(|c| now >= c.fetched_ms && now - c.fetched_ms < 60000.0)
            .map(|c| c.keys.clone())
    }) {
        return Ok(keys);
    }
    let mut init = RequestInit::new();
    init.with_redirect(RequestRedirect::Manual);
    let request = Request::new_with_init(crate::apple_identity::JWKS_URL, &init)
        .map_err(|_| AppleTransportError::Unavailable)?;
    let bytes = bounded_request(request, 65536).await?;
    let keys = Rc::new(
        AppleKeys::from_apple_response(&bytes).map_err(|_| AppleTransportError::InvalidResponse)?,
    );
    KEYS.with(|cache| {
        *cache.borrow_mut() = Some(CachedKeys {
            fetched_ms: now,
            keys: keys.clone(),
        })
    });
    Ok(keys)
}
#[derive(Deserialize)]
struct TokenResponse {
    id_token: String,
    refresh_token: String,
    token_type: String,
    access_token: String,
    expires_in: u64,
}
pub struct VerifiedAuthorization {
    pub identity: VerifiedIdentity,
    pub revocation_refresh_token: String,
}
/// Verify the native JWT first, exchange the one-use code, then verify the returned JWT and
/// require exactly the same subject/nonce/audience. Retain only the verified revocation token.
pub async fn exchange_native_authorization(
    identity_token: &str,
    code: &str,
    client_id: &str,
    client_secret: &str,
    nonce: &str,
) -> std::result::Result<VerifiedAuthorization, AppleTransportError> {
    if code.is_empty() || code.len() > 16384 {
        return Err(AppleTransportError::Rejected);
    }
    let keys = apple_keys().await?;
    let now = (js_sys::Date::now() / 1000.0) as u64;
    let original = verify_identity_token(identity_token, &keys, client_id, nonce, now)
        .map_err(|_| AppleTransportError::Rejected)?;
    let mut form = Url::parse("https://appleid.apple.com/auth/token")
        .map_err(|_| AppleTransportError::Unavailable)?;
    form.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("client_secret", client_secret)
        .append_pair("code", code)
        .append_pair("grant_type", "authorization_code");
    let headers = Headers::new();
    headers
        .set("Content-Type", "application/x-www-form-urlencoded")
        .map_err(|_| AppleTransportError::Unavailable)?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_redirect(RequestRedirect::Manual)
        .with_body(Some(JsValue::from_str(
            form.query().ok_or(AppleTransportError::Unavailable)?,
        )));
    let request = Request::new_with_init("https://appleid.apple.com/auth/token", &init)
        .map_err(|_| AppleTransportError::Unavailable)?;
    let bytes = bounded_request(request, 65536).await?;
    let token: TokenResponse =
        serde_json::from_slice(&bytes).map_err(|_| AppleTransportError::InvalidResponse)?;
    if token.token_type != "Bearer"
        || token.refresh_token.is_empty()
        || token.refresh_token.len() > 16384
        || token.access_token.is_empty()
        || token.access_token.len() > 16384
        || token.expires_in == 0
    {
        return Err(AppleTransportError::InvalidResponse);
    }
    let exchanged = verify_identity_token(
        &token.id_token,
        &keys,
        client_id,
        nonce,
        (js_sys::Date::now() / 1000.0) as u64,
    )
    .map_err(|_| AppleTransportError::Rejected)?;
    if exchanged.subject != original.subject {
        return Err(AppleTransportError::Rejected);
    }
    Ok(VerifiedAuthorization {
        identity: exchanged,
        revocation_refresh_token: token.refresh_token,
    })
}

/// Apple documents 200 with no response body for both first and repeated revocation.
pub async fn revoke_refresh_token(
    client_id: &str,
    client_secret: &str,
    token: &str,
) -> std::result::Result<(), AppleTransportError> {
    if token.is_empty() || token.len() > 16384 {
        return Err(AppleTransportError::InvalidResponse);
    }
    let mut form = Url::parse("https://appleid.apple.com/auth/revoke")
        .map_err(|_| AppleTransportError::Unavailable)?;
    form.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("client_secret", client_secret)
        .append_pair("token", token)
        .append_pair("token_type_hint", "refresh_token");
    let headers = Headers::new();
    headers
        .set("Content-Type", "application/x-www-form-urlencoded")
        .map_err(|_| AppleTransportError::Unavailable)?;
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_headers(headers)
        .with_redirect(RequestRedirect::Manual)
        .with_body(Some(JsValue::from_str(
            form.query().ok_or(AppleTransportError::Unavailable)?,
        )));
    let request = Request::new_with_init("https://appleid.apple.com/auth/revoke", &init)
        .map_err(|_| AppleTransportError::Unavailable)?;
    let signal = AbortSignal::from(web_sys::AbortSignal::timeout_with_u32(10000));
    let response = Fetch::Request(request)
        .send_with_signal(&signal)
        .await
        .map_err(|_| AppleTransportError::Unavailable)?;
    if response.status_code() != 200 {
        return Err(AppleTransportError::Unavailable);
    }
    Ok(())
}
