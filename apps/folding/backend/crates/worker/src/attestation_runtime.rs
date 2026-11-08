//! Session-bound challenge issuance and full App Attest enrollment. No root/key verifier override.
use crate::{
    attestation::{AppPolicy, verify_attestation},
    auth_runtime::{
        COMMUNITY_GUARD, CommunitySession, Configuration, Failure, blob, community_session, decode,
        now, number, random, response, session_guard, statement, text, uuid,
    },
    auth_wire::{AttestationChallengeRequest, AttestationPurpose, EnrollKeyRequest},
    secrets::keyed_digest,
};
use base64::{
    Engine,
    engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD},
};
use folding_domain::wire::Id;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;

pub(crate) struct AttestationConfiguration {
    pub app_id: String,
    pub environment: String,
    pub versions: Vec<String>,
}
impl AttestationConfiguration {
    pub(crate) fn load(env: &Env) -> std::result::Result<Self, Failure> {
        let app_id = env
            .var("APP_ATTEST_APP_ID")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let environment = env
            .var("APP_ATTEST_ENVIRONMENT")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        if env
            .var("DEPLOYMENT")
            .is_ok_and(|v| v.to_string() == "production")
            && environment != "production"
        {
            return Err(Failure::unavailable());
        }
        let versions: Vec<String> = serde_json::from_str(
            &env.var("APP_ATTEST_BUNDLE_VERSIONS")
                .map_err(|_| Failure::unavailable())?
                .to_string(),
        )
        .map_err(|_| Failure::unavailable())?;
        if app_id.len() > 255
            || !app_id.contains('.')
            || !app_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
            || !["development", "production"].contains(&environment.as_str())
            || versions.is_empty()
            || versions.len() > 128
            || versions
                .iter()
                .any(|v| v.is_empty() || v.len() > 64 || v.chars().any(char::is_control))
        {
            return Err(Failure::unavailable());
        }
        Ok(Self {
            app_id,
            environment,
            versions,
        })
    }
}
#[derive(Deserialize)]
struct Rate {
    count: u32,
}
pub(crate) const KEY_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN
 (?2=0 AND NOT EXISTS(SELECT 1 FROM attestation_keys WHERE key_id=?5)) OR
 (?2=1 AND EXISTS(SELECT 1 FROM attestation_keys WHERE participant_id=?3 AND device_id=?4 AND key_id=?5 AND deployment=?6 AND attestation_environment=?7 AND revoked=0))
 THEN 1 ELSE 0 END)
"#;
fn key_guard(
    db: &D1Database,
    guard: &str,
    existing: bool,
    session: &CommunitySession,
    key_id: &str,
    config: &Configuration,
    attest: &AttestationConfiguration,
) -> std::result::Result<D1PreparedStatement, Failure> {
    statement(
        db,
        KEY_GUARD,
        &[
            text(guard),
            number(i64::from(existing)),
            text(&session.participant_id),
            text(&session.device_id),
            text(key_id),
            text(&config.deployment),
            text(&attest.environment),
        ],
    )
}
fn delete_guards(
    db: &D1Database,
    guard: &str,
) -> std::result::Result<D1PreparedStatement, Failure> {
    statement(
        db,
        "DELETE FROM mutation_guards WHERE guard_id=?1 OR guard_id=?2 OR guard_id=?3 OR guard_id=?4",
        &[
            text(guard),
            text(&format!("{guard}-community")),
            text(&format!("{guard}-key")),
            text(&format!("{guard}-challenge")),
        ],
    )
}
pub(crate) fn nonce_context(
    config: &Configuration,
    session_id: &str,
    challenge_id: &str,
) -> String {
    format!(
        "Folding-v1/{}/challenge/{session_id}/{challenge_id}",
        config.deployment
    )
}
pub(crate) async fn challenge(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: AttestationChallengeRequest = decode(body)?;
    if !input.validate() {
        return Err(Failure::malformed());
    }
    let attest = AttestationConfiguration::load(env)?;
    let session = community_session(request, db, config).await?;
    if input.device_id.as_str() != session.device_id {
        return Err(Failure::unauthorized());
    }
    let timestamp = now();
    let window = timestamp / 60000 * 60000;
    let rate_key = keyed_digest(
        &config.network_key,
        "attestation-session",
        &session.session_id,
    );
    let rate=statement(db,"INSERT INTO auth_rate_windows VALUES (?1,?2,1) ON CONFLICT(key_hash,window_ms) DO UPDATE SET count=count+1 RETURNING count",&[blob(&rate_key),number(window)])?.first::<Rate>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    if rate.count > 10 {
        return Err(Failure {
            status: 429,
            code: "rate_limited",
            retryable: true,
        });
    }
    let nonce = random::<32>()?;
    let challenge_id = uuid()?;
    let guard = uuid()?;
    let sealed = config
        .keys
        .seal(
            random::<12>()?,
            &nonce_context(config, &session.session_id, &challenge_id),
            &nonce,
        )
        .map_err(|_| Failure::unavailable())?;
    let enrollment = input.purpose == AttestationPurpose::EnrollKey;
    let key = if enrollment {
        wasm_bindgen::JsValue::NULL
    } else {
        text(&input.key_id)
    };
    let pending = if enrollment {
        text(&input.key_id)
    } else {
        wasm_bindgen::JsValue::NULL
    };
    db.batch(vec![
        session_guard(db,&guard,&session,config,timestamp)?,
        statement(db,COMMUNITY_GUARD,&[text(&format!("{guard}-community")),text(&session.participant_id),number(session.revision)])?,
        key_guard(db,&format!("{guard}-key"),!enrollment,&session,&input.key_id,config,&attest)?,
        statement(db,"INSERT INTO challenges(challenge_id,participant_id,device_id,key_id,deployment,purpose,nonce_hash,expires_at_ms,used,session_id,enrollment_key_id,nonce_ciphertext,nonce_key_version) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,0,?9,?10,?11,?12)",&[text(&challenge_id),text(&session.participant_id),text(&session.device_id),key,text(&config.deployment),text(input.purpose.as_str()),blob(&Sha256::digest(nonce)),number(timestamp+300000),text(&session.session_id),pending,blob(&sealed),text(config.keys.version())])?,
        delete_guards(db,&guard)?,
    ]).await.map_err(|_|Failure::conflict())?;
    response(
        &serde_json::json!({"challenge_id":challenge_id,"nonce":URL_SAFE_NO_PAD.encode(nonce),"expires_at_ms":timestamp+300000,"request_id":request_id}),
    )
}
#[derive(Deserialize)]
struct Operation {
    normalized_hash: Vec<u8>,
    response_json: String,
}
#[derive(Deserialize)]
struct Challenge {
    nonce_hash: Vec<u8>,
    expires_at_ms: i64,
    used: u8,
}
pub(crate) async fn enroll(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: EnrollKeyRequest = decode(body)?;
    if !input.validate() {
        return Err(Failure::malformed());
    }
    let attest = AttestationConfiguration::load(env)?;
    let session = community_session(request, db, config).await?;
    if input.device_id.as_str() != session.device_id {
        return Err(Failure::unauthorized());
    }
    let normalized=Sha256::digest(serde_json::to_vec(&serde_json::json!({"operation_id":input.operation_id,"device_id":input.device_id,"key_id":input.key_id,"challenge_id":input.challenge_id})).map_err(|_|Failure::unavailable())?);
    let timestamp = now();
    if let Some(receipt)=statement(db,"SELECT normalized_hash,response_json FROM attestation_operations WHERE participant_id=?1 AND operation_id=?2",&[text(&session.participant_id),text(input.operation_id.as_str())])?.first::<Operation>(None).await.map_err(|_|Failure::unavailable())? {
        if receipt.normalized_hash!=normalized.as_slice(){return Err(Failure::conflict());}
        let guard=uuid()?;
        db.batch(vec![session_guard(db,&guard,&session,config,timestamp)?,statement(db,COMMUNITY_GUARD,&[text(&format!("{guard}-community")),text(&session.participant_id),number(session.revision)])?,key_guard(db,&format!("{guard}-key"),true,&session,&input.key_id,config,&attest)?,delete_guards(db,&guard)?]).await.map_err(|_|Failure::unauthorized())?;
        let value:serde_json::Value=serde_json::from_str(&receipt.response_json).map_err(|_|Failure::unavailable())?;return response(&value);
    }
    let challenge=statement(db,"SELECT nonce_hash,expires_at_ms,used FROM challenges WHERE challenge_id=?1 AND participant_id=?2 AND device_id=?3 AND session_id=?4 AND deployment=?5 AND purpose='enroll_key' AND enrollment_key_id=?6 AND key_id IS NULL",&[text(input.challenge_id.as_str()),text(&session.participant_id),text(&session.device_id),text(&session.session_id),text(&config.deployment),text(&input.key_id)])?.first::<Challenge>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    if challenge.used != 0 || challenge.expires_at_ms <= timestamp {
        return Err(Failure {
            status: 409,
            code: "challenge_expired",
            retryable: false,
        });
    }
    let client_hash: [u8; 32] = challenge
        .nonce_hash
        .try_into()
        .map_err(|_| Failure::unavailable())?;
    let key_id: [u8; 32] = STANDARD
        .decode(&input.key_id)
        .map_err(|_| Failure::malformed())?
        .try_into()
        .map_err(|_| Failure::malformed())?;
    let bytes = STANDARD
        .decode(&input.attestation_base64)
        .map_err(|_| Failure::malformed())?;
    let versions: Vec<_> = attest.versions.iter().map(String::as_str).collect();
    let policy = AppPolicy {
        app_id: &attest.app_id,
        development: attest.environment == "development",
        allowed_bundle_versions: &versions,
    };
    let verified = verify_attestation(&bytes, &key_id, &client_hash, &policy, timestamp as u64)
        .map_err(|_| Failure::malformed())?;
    let value = serde_json::json!({"operation_id":input.operation_id,"key_id":input.key_id,"enrolled":true,"request_id":request_id});
    let sealed = config
        .keys
        .seal(
            random::<12>()?,
            &format!(
                "Folding-v1/{}/attestation/{}",
                config.deployment, input.key_id
            ),
            verified.receipt(),
        )
        .map_err(|_| Failure::unavailable())?;
    let guard = uuid()?;
    db.batch(vec![
        session_guard(db,&guard,&session,config,timestamp)?,
        statement(db,COMMUNITY_GUARD,&[text(&format!("{guard}-community")),text(&session.participant_id),number(session.revision)])?,
        key_guard(db,&format!("{guard}-key"),false,&session,&input.key_id,config,&attest)?,
        statement(db,ENROLLMENT_GUARD,&[text(&format!("{guard}-challenge")),text(input.challenge_id.as_str()),text(&session.participant_id),text(&session.device_id),text(&session.session_id),text(&config.deployment),text(&input.key_id),number(timestamp),blob(&client_hash)])?,
        statement(db,"INSERT INTO attestation_keys(key_id,participant_id,device_id,deployment,public_key_sec1,counter,revoked,attestation_environment) VALUES (?1,?2,?3,?4,?5,0,0,?6)",&[text(&input.key_id),text(&session.participant_id),text(&session.device_id),text(&config.deployment),blob(verified.public_key()),text(&attest.environment)])?,
        statement(db,"INSERT INTO attestation_receipts VALUES (?1,?2,?3,?4,?5)",&[text(&input.key_id),blob(&sealed),text(config.keys.version()),number(timestamp),number(verified.receipt_expires_at_ms() as i64)])?,
        statement(db,"UPDATE challenges SET used=1,key_id=?1 WHERE challenge_id=?2",&[text(&input.key_id),text(input.challenge_id.as_str())])?,
        statement(db,"INSERT INTO attestation_operations VALUES (?1,?2,?3,?4,?5,?6)",&[text(&session.participant_id),text(input.operation_id.as_str()),text(&session.device_id),text(&input.key_id),blob(&normalized),text(&value.to_string())])?,
        delete_guards(db,&guard)?,
    ]).await.map_err(|_|Failure::conflict())?;
    response(&value)
}
pub(crate) const ENROLLMENT_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (
 SELECT 1 FROM challenges WHERE challenge_id=?2 AND participant_id=?3 AND device_id=?4
 AND session_id=?5 AND deployment=?6 AND enrollment_key_id=?7 AND key_id IS NULL
 AND expires_at_ms>?8 AND nonce_hash=?9 AND used=0 AND purpose='enroll_key'
) THEN 1 ELSE 0 END)
"#;
