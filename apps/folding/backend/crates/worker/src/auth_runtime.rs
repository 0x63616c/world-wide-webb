//! Actual Worker session handlers. All errors are mapped to the public safe error catalog.
use crate::{
    auth_wire::{AuthChallengeRequest, AuthPurpose, LogoutRequest, RefreshRequest},
    secrets::{KeyRing, keyed_digest},
    session::{self, RefreshDecision, RefreshState},
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use wasm_bindgen::{JsCast, JsValue};
use worker::*;

pub struct Failure {
    pub status: u16,
    pub code: &'static str,
    pub retryable: bool,
}
impl Failure {
    pub(crate) fn unavailable() -> Self {
        Self {
            status: 503,
            code: "temporarily_unavailable",
            retryable: true,
        }
    }
    pub(crate) fn unauthorized() -> Self {
        Self {
            status: 401,
            code: "authentication_required",
            retryable: false,
        }
    }
    pub(crate) fn malformed() -> Self {
        Self {
            status: 422,
            code: "invalid_input",
            retryable: false,
        }
    }
    pub(crate) fn conflict() -> Self {
        Self {
            status: 409,
            code: "conflict",
            retryable: true,
        }
    }
}
pub(crate) fn decode<T: serde::de::DeserializeOwned>(
    body: &[u8],
) -> std::result::Result<T, Failure> {
    serde_json::from_slice(body).map_err(|error| {
        if error.is_syntax() || error.is_eof() {
            Failure {
                status: 400,
                code: "malformed_request",
                retryable: false,
            }
        } else {
            Failure::malformed()
        }
    })
}
pub(crate) fn blob(bytes: &[u8]) -> JsValue {
    js_sys::Uint8Array::from(bytes).into()
}
pub(crate) fn text(value: &str) -> JsValue {
    JsValue::from_str(value)
}
pub(crate) fn number(value: i64) -> JsValue {
    JsValue::from_f64(value as f64)
}
pub(crate) fn now() -> i64 {
    js_sys::Date::now() as i64
}
pub(crate) fn random<const N: usize>() -> std::result::Result<[u8; N], Failure> {
    let scope = js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>();
    let mut bytes = [0; N];
    scope
        .crypto()
        .map_err(|_| Failure::unavailable())?
        .get_random_values_with_u8_array(&mut bytes)
        .map_err(|_| Failure::unavailable())?;
    Ok(bytes)
}
pub(crate) fn uuid() -> std::result::Result<String, Failure> {
    let scope = js_sys::global().unchecked_into::<web_sys::WorkerGlobalScope>();
    Ok(scope
        .crypto()
        .map_err(|_| Failure::unavailable())?
        .random_uuid())
}
pub(crate) fn statement(
    db: &D1Database,
    sql: &str,
    args: &[JsValue],
) -> std::result::Result<D1PreparedStatement, Failure> {
    db.prepare(sql)
        .bind(args)
        .map_err(|_| Failure::unavailable())
}
pub(crate) fn response(value: &impl Serialize) -> std::result::Result<Response, Failure> {
    let mut out = Response::from_json(value).map_err(|_| Failure::unavailable())?;
    out.headers_mut()
        .set("Cache-Control", "no-store")
        .map_err(|_| Failure::unavailable())?;
    out.headers_mut()
        .set("X-Content-Type-Options", "nosniff")
        .map_err(|_| Failure::unavailable())?;
    Ok(out)
}
pub(crate) struct Configuration {
    pub(crate) deployment: String,
    pub(crate) keys: KeyRing,
    pub(crate) network_key: [u8; 32],
}
impl Configuration {
    pub(crate) fn load(env: &Env) -> std::result::Result<Self, Failure> {
        let deployment = env
            .var("DEPLOYMENT")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        if !["staging", "production"].contains(&deployment.as_str()) {
            return Err(Failure::unavailable());
        }
        let version = env
            .var("AUTH_ENCRYPTION_KEY_VERSION")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let encoded = env
            .secret("AUTH_ENCRYPTION_KEYS")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let keys =
            KeyRing::from_secret_json(&version, &encoded).map_err(|_| Failure::unavailable())?;
        let network_key = URL_SAFE_NO_PAD
            .decode(
                env.secret("AUTH_NETWORK_HMAC_KEY")
                    .map_err(|_| Failure::unavailable())?
                    .to_string(),
            )
            .map_err(|_| Failure::unavailable())?
            .try_into()
            .map_err(|_| Failure::unavailable())?;
        Ok(Self {
            deployment,
            keys,
            network_key,
        })
    }
}
pub async fn dispatch(
    request: &Request,
    env: &Env,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Option<Response>, Failure> {
    if request.path().starts_with("/v1/avatars/") {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return match request.method() {
            Method::Put => Ok(Some(
                crate::avatar_runtime::upload(request, env, &db, &config, body, request_id).await?,
            )),
            Method::Get => Ok(Some(
                crate::avatar_runtime::read(request, env, &db, &config, request_id).await?,
            )),
            Method::Delete => Ok(Some(
                crate::avatar_runtime::remove(request, &db, &config, request_id).await?,
            )),
            _ => Err(Failure::malformed()),
        };
    }
    if (request.path() == "/v1/preferences" && request.method() == Method::Put)
        || (request.path().starts_with("/v1/push-installations/")
            && [Method::Put, Method::Delete].contains(&request.method()))
    {
        let content = request
            .headers()
            .get("Content-Type")
            .map_err(|_| Failure::malformed())?
            .unwrap_or_default();
        if content.split(';').next().map(str::trim) != Some("application/json") {
            return Err(Failure::malformed());
        }
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::notification_runtime::mutate(request, env, &db, &config, body, request_id)
                .await?,
        ));
    }
    if request.method() == Method::Get
        && (request.path() == "/v1/milestones" || request.path().starts_with("/v1/participants/"))
    {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::milestone_profiles::read(request, env, &db, &config, request_id).await?,
        ));
    }
    if (request.method() == Method::Patch && request.path() == "/v1/profile/badge")
        || (request.method() == Method::Post && request.path() == "/v1/milestones/acknowledgments")
    {
        let content = request
            .headers()
            .get("Content-Type")
            .map_err(|_| Failure::malformed())?
            .unwrap_or_default();
        if content.split(';').next().map(str::trim) != Some("application/json") {
            return Err(Failure::malformed());
        }
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::milestone_profiles::mutate(request, env, &db, &config, body, request_id).await?,
        ));
    }
    if request.method() == Method::Get && request.path() == "/v1/blocks" {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::profile_runtime::blocks(request, &db, &config, request_id).await?,
        ));
    }
    if request.method() == Method::Get && request.path() == "/v1/capabilities" {
        return Ok(Some(crate::capabilities_runtime::get(env, request_id)?));
    }
    if request.method() == Method::Get
        && (request.path() == "/v1/results" || request.path().starts_with("/v1/results/"))
    {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::results_runtime::history(request, &db, &config, request_id).await?,
        ));
    }
    if request.method() == Method::Get && request.path().starts_with("/v1/operations/") {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::deletion_runtime::poll(request, &db, &config, request_id).await?,
        ));
    }
    if request.method() == Method::Get && request.path() == "/v1/leaderboards" {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::leaderboard_runtime::board(request, &db, &config, request_id).await?,
        ));
    }
    if request.method() == Method::Get
        && (request.path() == "/v1/me" || request.path().starts_with("/v1/event-batches/"))
    {
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::community_reads::read(request, &db, &config, request_id).await?,
        ));
    }
    if (request.path() == "/v1/profile" && request.method() == Method::Patch)
        || (request.path() == "/v1/reports" && request.method() == Method::Post)
        || (request.path().starts_with("/v1/blocks/")
            && [Method::Put, Method::Delete].contains(&request.method()))
    {
        let content_type = request
            .headers()
            .get("Content-Type")
            .map_err(|_| Failure::malformed())?
            .unwrap_or_default();
        if content_type.split(';').next().map(str::trim) != Some("application/json") {
            return Err(Failure::malformed());
        }
        let config = Configuration::load(env)?;
        let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
        return Ok(Some(
            crate::profile_runtime::mutate(request, &db, &config, body, request_id).await?,
        ));
    }
    if request.method() != Method::Post
        || ![
            "/v1/auth/challenges",
            "/v1/auth/refresh",
            "/v1/auth/logout",
            "/v1/auth/apple",
            "/v1/attestation/challenges",
            "/v1/attestation/keys",
            "/v1/event-batches",
            "/v1/history-batches",
            "/v1/enrollment/join",
            "/v1/enrollment/transfer",
            "/v1/resets",
            "/v1/entry-deletions",
            "/v1/account/delete",
        ]
        .contains(&request.path().as_str())
    {
        return Ok(None);
    }
    let content_type = request
        .headers()
        .get("Content-Type")
        .map_err(|_| Failure::malformed())?
        .unwrap_or_default();
    let mut content_type = content_type.split(';').map(str::trim);
    if !content_type
        .next()
        .is_some_and(|value| value.eq_ignore_ascii_case("application/json"))
        || content_type.any(|value| !value.eq_ignore_ascii_case("charset=utf-8"))
    {
        return Err(Failure {
            status: 400,
            code: "malformed_request",
            retryable: false,
        });
    }
    // No test/simulator bypass: tests populate real rows and use cryptographic opaque tokens.
    let config = Configuration::load(env)?;
    let db = env.d1("DB").map_err(|_| Failure::unavailable())?;
    let out = match request.path().as_str() {
        "/v1/auth/challenges" => challenge(request, &db, &config, body, request_id).await?,
        "/v1/auth/refresh" => refresh(&db, &config, body, request_id).await?,
        "/v1/auth/apple" => {
            let input: crate::auth_wire::AppleExchangeRequest = decode(body)?;
            if input.purpose == crate::auth_wire::AuthPurpose::SignIn {
                crate::auth_signin::sign_in(env, &db, &config, body, request_id).await?
            } else {
                crate::reauth_runtime::exchange(request, env, &db, &config, body, request_id)
                    .await?
            }
        }
        "/v1/attestation/challenges" => {
            crate::attestation_runtime::challenge(request, env, &db, &config, body, request_id)
                .await?
        }
        "/v1/attestation/keys" => {
            crate::attestation_runtime::enroll(request, env, &db, &config, body, request_id).await?
        }
        "/v1/event-batches" | "/v1/history-batches" => {
            crate::operational_runtime::require(&db, "ingestion").await?;
            crate::competition_runtime::events(request, env, &db, &config, body, request_id).await?
        }
        "/v1/enrollment/join" => {
            crate::enrollment_runtime::mutate(request, env, &db, &config, body, request_id, false)
                .await?
        }
        "/v1/enrollment/transfer" => {
            crate::enrollment_runtime::mutate(request, env, &db, &config, body, request_id, true)
                .await?
        }
        "/v1/entry-deletions" => {
            crate::entry_deletion_runtime::delete(request, &db, &config, body, request_id).await?
        }
        "/v1/resets" => {
            crate::lifecycle_runtime::reset(request, env, &db, &config, body, request_id).await?
        }
        "/v1/account/delete" => {
            crate::deletion_runtime::delete(request, &db, &config, body, request_id).await?
        }
        "/v1/auth/logout" => logout(request, &db, &config, body, request_id).await?,
        _ => return Ok(None),
    };
    Ok(Some(out))
}
async fn challenge(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: AuthChallengeRequest = decode(body)?;
    let network = request
        .headers()
        .get("CF-Connecting-IP")
        .map_err(|_| Failure::unavailable())?
        .ok_or_else(Failure::unavailable)?;
    let address: std::net::IpAddr = network.parse().map_err(|_| Failure::unavailable())?;
    let network_hash = keyed_digest(
        &config.network_key,
        "auth-challenge-network",
        &address.to_string(),
    );
    let timestamp = now();
    let window = timestamp / 60000 * 60000;
    let rate=statement(db,"INSERT INTO auth_rate_windows(key_hash,window_ms,count) VALUES (?1,?2,1) ON CONFLICT(key_hash,window_ms) DO UPDATE SET count=count+1 RETURNING count",&[blob(&network_hash),number(window)])?.first::<RateRow>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    if rate.count > 20 {
        return Err(Failure {
            status: 429,
            code: "rate_limited",
            retryable: true,
        });
    }
    let nonce = URL_SAFE_NO_PAD.encode(random::<32>()?);
    let nonce_hash = Sha256::digest(nonce.as_bytes());
    let challenge_id = uuid()?;
    let expires = timestamp + 300000;
    let purpose = match input.purpose {
        AuthPurpose::SignIn => "sign_in",
        AuthPurpose::Reauthenticate => "reauthenticate",
        AuthPurpose::RecoverDeletion => "recover_deletion",
    };
    db.batch(vec![statement(db,"INSERT INTO challenges(challenge_id,deployment,purpose,nonce_hash,expires_at_ms,used) VALUES (?1,?2,?3,?4,?5,0)",&[text(&challenge_id),text(&config.deployment),text(purpose),blob(&nonce_hash),number(expires)])?,statement(db,"DELETE FROM auth_rate_windows WHERE window_ms<?1",&[number(window-120000)])?]).await.map_err(|_|Failure::unavailable())?;
    response(
        &serde_json::json!({"challenge_id":challenge_id,"nonce":nonce,"expires_at_ms":expires,"request_id":request_id}),
    )
}
#[derive(Deserialize)]
struct RateRow {
    count: u32,
}
#[derive(Deserialize)]
struct RefreshRow {
    session_id: String,
    absolute_expires_at_ms: i64,
    idle_expires_at_ms: i64,
    revoked: u8,
    rotated_operation_id: Option<String>,
    rotated_at_ms: Option<i64>,
    receipt_operation_id: Option<String>,
    receipt_expires_at_ms: Option<i64>,
    ciphertext: Option<Vec<u8>>,
    key_version: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct TokenPair {
    access_token: String,
    refresh_token: String,
    expires_at_ms: i64,
    request_id: Id,
}
async fn refresh(
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: RefreshRequest = decode(body)?;
    let old_hash = session::token_hash(&input.refresh_token).ok_or_else(Failure::unauthorized)?;
    statement(
        db,
        "DELETE FROM refresh_receipts WHERE expires_at_ms<=?1",
        &[number(now())],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    for _ in 0..3 {
        let timestamp = now();
        let row=statement(db,"SELECT s.session_id,s.absolute_expires_at_ms,s.idle_expires_at_ms,s.revoked,t.rotated_operation_id,t.rotated_at_ms,r.operation_id AS receipt_operation_id,r.expires_at_ms AS receipt_expires_at_ms,r.ciphertext,r.key_version FROM refresh_tokens t JOIN sessions s ON s.session_id=t.session_id LEFT JOIN refresh_receipts r ON r.session_id=s.session_id AND r.operation_id=?1 AND r.original_token_hash=t.token_hash WHERE t.token_hash=?2 AND s.deployment=?3",&[text(input.operation_id.as_str()),blob(&old_hash),text(&config.deployment)])?.first::<RefreshRow>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
        let state = RefreshState {
            revoked: row.revoked != 0,
            deployment: &config.deployment,
            absolute_expires_at_ms: row.absolute_expires_at_ms,
            idle_expires_at_ms: row.idle_expires_at_ms,
            rotated_operation_id: row.rotated_operation_id.as_deref(),
            rotated_at_ms: row.rotated_at_ms,
            receipt_operation_id: row.receipt_operation_id.as_deref(),
            receipt_expires_at_ms: row.receipt_expires_at_ms,
        };
        let context = format!(
            "Folding-v1/{}/refresh/{}/{}",
            config.deployment,
            row.session_id,
            input.operation_id.as_str()
        );
        match session::decide_refresh(
            &state,
            &config.deployment,
            input.operation_id.as_str(),
            timestamp,
        ) {
            RefreshDecision::AuthenticationRequired => return Err(Failure::unauthorized()),
            RefreshDecision::RevokeFamily => {
                db.batch(vec![
                    statement(db, session::REVOKE_FAMILY_SQL, &[text(&row.session_id)])?,
                    statement(
                        db,
                        "DELETE FROM push_installations WHERE session_id=?1",
                        &[text(&row.session_id)],
                    )?,
                ])
                .await
                .map_err(|_| Failure::unavailable())?;
                return Err(Failure::unauthorized());
            }
            RefreshDecision::ReturnEncryptedReceipt => {
                let plain = config
                    .keys
                    .open(
                        row.key_version
                            .as_deref()
                            .ok_or_else(Failure::unavailable)?,
                        &context,
                        row.ciphertext.as_deref().ok_or_else(Failure::unavailable)?,
                    )
                    .map_err(|_| Failure::unavailable())?;
                let pair: TokenPair =
                    serde_json::from_slice(&plain).map_err(|_| Failure::unavailable())?;
                let current_hash =
                    session::token_hash(&pair.refresh_token).ok_or_else(Failure::unavailable)?;
                let guard = uuid()?;
                db.batch(vec![
                    statement(
                        db,
                        RECEIPT_GUARD,
                        &[
                            text(&guard),
                            text(&row.session_id),
                            text(&config.deployment),
                            number(timestamp),
                            blob(&old_hash),
                            text(input.operation_id.as_str()),
                            blob(&current_hash),
                        ],
                    )?,
                    statement(
                        db,
                        "DELETE FROM mutation_guards WHERE guard_id=?1",
                        &[text(&guard)],
                    )?,
                ])
                .await
                .map_err(|_| Failure::unauthorized())?;
                return response(&pair);
            }
            RefreshDecision::Rotate => {
                let access = random::<32>()?;
                let refresh = random::<32>()?;
                let expires =
                    (timestamp + session::ACCESS_LIFETIME_MS).min(row.absolute_expires_at_ms);
                let pair = TokenPair {
                    access_token: URL_SAFE_NO_PAD.encode(access),
                    refresh_token: URL_SAFE_NO_PAD.encode(refresh),
                    expires_at_ms: expires,
                    request_id: request_id.clone(),
                };
                let ciphertext = config
                    .keys
                    .seal(
                        random::<12>()?,
                        &context,
                        &serde_json::to_vec(&pair).map_err(|_| Failure::unavailable())?,
                    )
                    .map_err(|_| Failure::unavailable())?;
                let guard = uuid()?;
                let result=db.batch(vec![
                    statement(db,session::REFRESH_GUARD_SQL,&[text(&guard),text(&row.session_id),text(&config.deployment),number(timestamp),blob(&old_hash),text(input.operation_id.as_str())])?,
                    statement(db,"INSERT INTO auth_operation_claims VALUES ((SELECT participant_id FROM sessions WHERE session_id=?1),'refresh',?2,?1,?3)",&[text(&row.session_id),text(input.operation_id.as_str()),number(timestamp)])?,
                    statement(db,"UPDATE refresh_tokens SET rotated_operation_id=?1,rotated_at_ms=?2 WHERE token_hash=?3",&[text(input.operation_id.as_str()),number(timestamp),blob(&old_hash)])?,
                    statement(db,"INSERT INTO access_tokens VALUES (?1,?2,?3)",&[blob(&Sha256::digest(access)),text(&row.session_id),number(expires)])?,
                    statement(db,"INSERT INTO refresh_tokens VALUES (?1,?2,?3,NULL,NULL)",&[blob(&Sha256::digest(refresh)),text(&row.session_id),number(timestamp)])?,
                    statement(db,"INSERT INTO refresh_receipts VALUES ((SELECT participant_id FROM sessions WHERE session_id=?1),?1,?2,?3,?4,?5,?6)",&[text(&row.session_id),text(input.operation_id.as_str()),blob(&old_hash),blob(&ciphertext),text(config.keys.version()),number(timestamp+session::RETRY_LIFETIME_MS)])?,
                    statement(db,"UPDATE sessions SET idle_expires_at_ms=?1 WHERE session_id=?2",&[number((timestamp+session::IDLE_LIFETIME_MS).min(row.absolute_expires_at_ms)),text(&row.session_id)])?,
                    statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?,
                ]).await;
                if result.is_ok() {
                    return response(&pair);
                }
            }
        }
    }
    Err(Failure::conflict())
}
const RECEIPT_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (
 SELECT 1 FROM sessions s JOIN refresh_tokens t ON t.session_id=s.session_id
 JOIN refresh_receipts r ON r.session_id=s.session_id AND r.original_token_hash=t.token_hash
 JOIN refresh_tokens current ON current.session_id=s.session_id
 WHERE s.session_id=?2 AND s.deployment=?3 AND s.revoked=0 AND s.idle_expires_at_ms>?4
 AND s.absolute_expires_at_ms>?4 AND t.token_hash=?5 AND t.rotated_operation_id=?6
 AND r.operation_id=?6 AND r.expires_at_ms>?4 AND t.rotated_at_ms+60000>?4
 AND current.token_hash=?7 AND current.rotated_operation_id IS NULL
) THEN 1 ELSE 0 END)
"#;
#[derive(Deserialize)]
struct AccessRow {
    session_id: String,
    participant_id: String,
    device_id: String,
}
async fn logout(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: LogoutRequest = decode(body)?;
    let authorization = request
        .headers()
        .get("Authorization")
        .map_err(|_| Failure::unauthorized())?
        .ok_or_else(Failure::unauthorized)?;
    let hash = authorization
        .strip_prefix("Bearer ")
        .and_then(session::token_hash)
        .ok_or_else(Failure::unauthorized)?;
    let row=statement(db,"SELECT s.session_id,s.participant_id,s.device_id FROM sessions s JOIN access_tokens a ON a.session_id=s.session_id WHERE a.token_hash=?1 AND s.deployment=?2",&[blob(&hash),text(&config.deployment)])?.first::<AccessRow>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    let timestamp = now();
    let guard = uuid()?;
    let out = serde_json::json!({"operation_id":input.operation_id,"state":"completed","request_id":request_id});
    let normalized = Sha256::digest(
        serde_json::to_vec(&serde_json::json!({"operation_id":input.operation_id}))
            .map_err(|_| Failure::unavailable())?,
    );
    db.batch(vec![
        statement(
            db,
            session::SESSION_GUARD_SQL,
            &[
                text(&guard),
                text(&row.session_id),
                text(&row.participant_id),
                text(&row.device_id),
                text(&config.deployment),
                number(timestamp),
                blob(&hash),
            ],
        )?,
        statement(db,"INSERT INTO auth_operation_claims VALUES ((SELECT participant_id FROM sessions WHERE session_id=?1),'logout',?2,?1,?3)",&[text(&row.session_id),text(input.operation_id.as_str()),number(timestamp)])?,
        statement(db, session::REVOKE_FAMILY_SQL, &[text(&row.session_id)])?,
        statement(
            db,
            "DELETE FROM push_installations WHERE session_id=?1",
            &[text(&row.session_id)],
        )?,
        statement(
            db,
            "INSERT INTO session_operations VALUES ((SELECT participant_id FROM sessions WHERE session_id=?1),?1,'logout',?2,?3,?4,?5)",
            &[
                text(&row.session_id),
                text(input.operation_id.as_str()),
                blob(&normalized),
                text(&out.to_string()),
                number(timestamp),
            ],
        )?,
        statement(
            db,
            "DELETE FROM mutation_guards WHERE guard_id=?1",
            &[text(&guard)],
        )?,
    ])
    .await
    .map_err(|_| Failure::unauthorized())?;
    response(&out)
}

/// Server-derived session identity for community operations, including key enrollment before join.
pub(crate) struct CommunitySession {
    pub session_id: String,
    pub participant_id: String,
    pub device_id: String,
    pub revision: i64,
    pub access_hash: [u8; 32],
}
#[derive(Deserialize)]
struct CommunityRow {
    session_id: String,
    participant_id: String,
    device_id: String,
    revision: i64,
}
pub(crate) async fn community_session(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
) -> std::result::Result<CommunitySession, Failure> {
    authenticated_session(request, db, config, true).await
}
pub(crate) async fn authenticated_session(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    require_community: bool,
) -> std::result::Result<CommunitySession, Failure> {
    let authorization = request
        .headers()
        .get("Authorization")
        .map_err(|_| Failure::unauthorized())?
        .ok_or_else(Failure::unauthorized)?;
    let hash = authorization
        .strip_prefix("Bearer ")
        .and_then(session::token_hash)
        .ok_or_else(Failure::unauthorized)?;
    let row=statement(db,"SELECT s.session_id,s.participant_id,s.device_id,r.revision FROM sessions s JOIN access_tokens a ON a.session_id=s.session_id JOIN participants p ON p.participant_id=s.participant_id JOIN participant_revisions r ON r.participant_id=p.participant_id WHERE a.token_hash=?1 AND s.deployment=?2 AND s.revoked=0 AND s.absolute_expires_at_ms>?3 AND s.idle_expires_at_ms>?3 AND a.expires_at_ms>?3 AND p.account_state='active' AND (?4=0 OR p.restriction='none')",&[blob(&hash),text(&config.deployment),number(now()),number(i64::from(require_community))])?.first::<CommunityRow>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    Ok(CommunitySession {
        session_id: row.session_id,
        participant_id: row.participant_id,
        device_id: row.device_id,
        revision: row.revision,
        access_hash: hash,
    })
}
pub(crate) const COMMUNITY_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (
 SELECT 1 FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id
 WHERE p.participant_id=?2 AND p.account_state='active' AND p.restriction='none' AND r.revision=?3
) THEN 1 ELSE 0 END)
"#;
pub(crate) fn session_guard(
    db: &D1Database,
    guard: &str,
    session: &CommunitySession,
    config: &Configuration,
    timestamp: i64,
) -> std::result::Result<D1PreparedStatement, Failure> {
    statement(
        db,
        session::SESSION_GUARD_SQL,
        &[
            text(guard),
            text(&session.session_id),
            text(&session.participant_id),
            text(&session.device_id),
            text(&config.deployment),
            number(timestamp),
            blob(&session.access_hash),
        ],
    )
}
