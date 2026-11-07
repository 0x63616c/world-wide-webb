//! Access JWT plus explicit allowlist, canonical origin and token-bound CSRF on every admin request.
use crate::auth_runtime::{Configuration, Failure, now};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use worker::*;
pub(crate) struct Administrator {
    pub actor: String,
    pub csrf: String,
    session_hash: String,
    expires: u64,
    origin: String,
}
fn reject(stage: &'static str) -> Failure {
    console_error!("admin_request_rejected:{stage}");
    Failure::unauthorized()
}
pub(crate) async fn authorize(
    request: &Request,
    env: &Env,
    config: &Configuration,
) -> std::result::Result<Administrator, Failure> {
    let origin = env
        .var("ADMIN_ORIGIN")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let team = env
        .var("ACCESS_TEAM_DOMAIN")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let issuer = Url::parse(&team).map_err(|_| Failure::unavailable())?;
    if issuer.scheme() != "https"
        || issuer
            .host_str()
            .is_none_or(|h| !h.ends_with(".cloudflareaccess.com") || h == "cloudflareaccess.com")
        || issuer.port().is_some()
        || !issuer.username().is_empty()
        || issuer.password().is_some()
        || issuer.path() != "/"
        || issuer.query().is_some()
        || issuer.fragment().is_some()
        || team.ends_with('/')
    {
        return Err(Failure::unavailable());
    }
    let canonical = Url::parse(&origin).map_err(|_| Failure::unavailable())?;
    if canonical.scheme() != "https"
        || canonical.origin().ascii_serialization() != origin
        || request
            .url()
            .map_err(|_| Failure::malformed())?
            .origin()
            .ascii_serialization()
            != origin
    {
        return Err(reject("canonical_origin"));
    }
    let aud = env
        .var("ACCESS_AUDIENCE")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let allowlist: Vec<String> = serde_json::from_str(
        &env.var("ADMIN_EMAIL_ALLOWLIST")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
    )
    .map_err(|_| Failure::unavailable())?;
    if aud.is_empty() || aud.len() > 255 || allowlist.is_empty() || allowlist.len() > 32 {
        return Err(Failure::unavailable());
    }
    let token = request
        .headers()
        .get("Cf-Access-Jwt-Assertion")
        .map_err(|_| reject("access_header"))?
        .ok_or_else(|| reject("missing_access_assertion"))?;
    if token.len() > 16384 {
        return Err(reject("access_assertion_length"));
    }
    let mut init = RequestInit::new();
    init.with_redirect(RequestRedirect::Manual);
    let key_request = Request::new_with_init(&format!("{team}/cdn-cgi/access/certs"), &init)
        .map_err(|_| Failure::unavailable())?;
    let signal = AbortSignal::from(web_sys::AbortSignal::timeout_with_u32(10000));
    let mut result = Fetch::Request(key_request)
        .send_with_signal(&signal)
        .await
        .map_err(|_| Failure::unavailable())?;
    if result.status_code() != 200 {
        return Err(Failure::unavailable());
    }
    let mut stream = result.stream().map_err(|_| Failure::unavailable())?;
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| Failure::unavailable())?;
        if bytes.len() + chunk.len() > 65536 {
            return Err(Failure::unavailable());
        }
        bytes.extend(chunk);
    }
    let time = (now() / 1000) as u64;
    let identity = crate::access_identity::verify(&token, &bytes, &team, &aud, &allowlist, time)
        .map_err(|_| reject("access_assertion_invalid"))?;
    let session_hash = crate::assertion::hex(&Sha256::digest(token.as_bytes()));
    let expires = identity.exp.min(time + 1800);
    let message = format!("{session_hash}:{expires}:{origin}");
    let mac = URL_SAFE_NO_PAD.encode(crate::secrets::keyed_digest(
        &config.network_key,
        "admin-csrf",
        &message,
    ));
    Ok(Administrator {
        actor: identity.sub,
        csrf: format!("{expires}.{mac}"),
        session_hash,
        expires: identity.exp,
        origin,
    })
}
impl Administrator {
    pub(crate) fn check_csrf(
        &self,
        request: &Request,
        token: &str,
        config: &Configuration,
    ) -> std::result::Result<(), Failure> {
        if request.method() != Method::Post
            || request
                .headers()
                .get("Origin")
                .map_err(|_| reject("csrf_origin_header"))?
                .as_deref()
                != Some(&self.origin)
        {
            return Err(reject("csrf_origin_mismatch"));
        }
        let (expiry, signature) = token.split_once('.').ok_or_else(|| reject("csrf_format"))?;
        let expiry = expiry.parse::<u64>().map_err(|_| reject("csrf_expiry_format"))?;
        if expiry <= (now() / 1000) as u64 || expiry > self.expires {
            return Err(reject("csrf_expired"));
        }
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| reject("csrf_signature_format"))?;
        if !crate::secrets::verify_keyed_digest(
            &config.network_key,
            "admin-csrf",
            &format!("{}:{expiry}:{}", self.session_hash, self.origin),
            &signature,
        ) {
            return Err(reject("csrf_signature_mismatch"));
        }
        Ok(())
    }
}
