//! One request-bound assertion, provisionally verified and atomically consumed by its mutation.
use crate::{
    assertion::{Binding, client_data_hash, verify_assertion_with_policy},
    attestation::AppPolicy,
    attestation_runtime::{AttestationConfiguration, nonce_context},
    auth_runtime::{
        CommunitySession, Configuration, Failure, blob, community_session, now, number, statement,
        text,
    },
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;

#[derive(Deserialize)]
struct Material {
    public_key_sec1: Vec<u8>,
    counter: u32,
    nonce_hash: Vec<u8>,
    nonce_ciphertext: Vec<u8>,
    nonce_key_version: String,
}
pub(crate) struct VerifiedRequest {
    pub session: CommunitySession,
    pub key_id: String,
    pub challenge_id: String,
    pub old_counter: u32,
    pub new_counter: u32,
    pub nonce_hash: Vec<u8>,
    pub environment: String,
    pub purpose: String,
}
fn header(request: &Request, name: &str) -> std::result::Result<String, Failure> {
    request
        .headers()
        .get(name)
        .map_err(|_| Failure::malformed())?
        .filter(|v| !v.is_empty() && v.len() <= 22000)
        .ok_or_else(Failure::unauthorized)
}
pub(crate) async fn verify(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    purpose: &str,
) -> std::result::Result<VerifiedRequest, Failure> {
    if request
        .url()
        .map_err(|_| Failure::malformed())?
        .query()
        .is_some()
    {
        return Err(Failure::malformed());
    }
    let session = community_session(request, db, config).await?;
    let policy = AttestationConfiguration::load(env)?;
    let key_id = header(request, "X-Folding-Key-ID")?;
    let challenge_id = header(request, "X-Folding-Challenge-ID")?;
    let id = Id::parse(&challenge_id).map_err(|_| Failure::malformed())?;
    let encoded = header(request, "X-Folding-Assertion")?;
    let assertion = URL_SAFE_NO_PAD
        .decode(&encoded)
        .map_err(|_| Failure::malformed())?;
    if assertion.len() > 16384 || URL_SAFE_NO_PAD.encode(&assertion) != encoded {
        return Err(Failure::malformed());
    }
    let material=statement(db,"SELECT k.public_key_sec1,k.counter,c.nonce_hash,c.nonce_ciphertext,c.nonce_key_version FROM attestation_keys k JOIN challenges c ON c.key_id=k.key_id WHERE k.key_id=?1 AND k.participant_id=?2 AND k.device_id=?3 AND k.deployment=?4 AND k.attestation_environment=?5 AND k.revoked=0 AND c.challenge_id=?6 AND c.participant_id=k.participant_id AND c.device_id=k.device_id AND c.deployment=k.deployment AND c.session_id=?7 AND c.purpose=?8 AND c.used=0 AND c.expires_at_ms>?9",&[text(&key_id),text(&session.participant_id),text(&session.device_id),text(&config.deployment),text(&policy.environment),text(&challenge_id),text(&session.session_id),text(purpose),number(now())])?.first::<Material>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    let nonce = config
        .keys
        .open(
            &material.nonce_key_version,
            &nonce_context(config, &session.session_id, &challenge_id),
            &material.nonce_ciphertext,
        )
        .map_err(|_| Failure::unavailable())?;
    if nonce.len() != 32 || Sha256::digest(&nonce).as_slice() != material.nonce_hash {
        return Err(Failure::unavailable());
    }
    let nonce = URL_SAFE_NO_PAD.encode(nonce);
    let hash = client_data_hash(&Binding {
        deployment: &config.deployment,
        method: request.method().as_ref(),
        path: &request.path(),
        challenge_id: &id,
        nonce_base64url: &nonce,
        exact_body: body,
    })
    .map_err(|_| Failure::malformed())?;
    let versions: Vec<_> = policy.versions.iter().map(String::as_str).collect();
    let counter = verify_assertion_with_policy(
        &assertion,
        &material.public_key_sec1,
        material.counter,
        &hash,
        &AppPolicy {
            app_id: &policy.app_id,
            development: policy.environment == "development",
            allowed_bundle_versions: &versions,
        },
    )
    .map_err(|error| {
        // Only a fixed verifier outcome is logged: never assertion bytes, tokens,
        // request bodies, participant identifiers or the device's public key.
        console_log!(
            "{}",
            serde_json::json!({
                "event": "app_attest_assertion_rejected",
                "reason": format!("{error:?}"),
                "purpose": purpose,
            })
        );
        Failure::unauthorized()
    })?;
    Ok(VerifiedRequest {
        session,
        key_id,
        challenge_id,
        old_counter: material.counter,
        new_counter: counter,
        nonce_hash: material.nonce_hash,
        environment: policy.environment,
        purpose: purpose.into(),
    })
}
/// Deliberately independent of joined membership: join and transfer have their own business fences.
pub(crate) const ASSERTION_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM attestation_keys k JOIN challenges c ON c.key_id=k.key_id
 WHERE k.key_id=?2 AND k.participant_id=?3 AND k.device_id=?4 AND k.deployment=?5
 AND k.attestation_environment=?6 AND k.revoked=0 AND k.counter=?7 AND ?8>?7
 AND c.challenge_id=?9 AND c.participant_id=?3 AND c.device_id=?4 AND c.deployment=?5
 AND c.session_id=?10 AND c.purpose=?11 AND c.nonce_hash=?12 AND c.used=0 AND c.expires_at_ms>?13
) THEN 1 ELSE 0 END)
"#;
impl VerifiedRequest {
    pub(crate) fn guard(
        &self,
        db: &D1Database,
        config: &Configuration,
        id: &str,
        time: i64,
    ) -> std::result::Result<D1PreparedStatement, Failure> {
        statement(
            db,
            ASSERTION_GUARD,
            &[
                text(id),
                text(&self.key_id),
                text(&self.session.participant_id),
                text(&self.session.device_id),
                text(&config.deployment),
                text(&self.environment),
                number(self.old_counter as i64),
                number(self.new_counter as i64),
                text(&self.challenge_id),
                text(&self.session.session_id),
                text(&self.purpose),
                blob(&self.nonce_hash),
                number(time),
            ],
        )
    }
    pub(crate) fn consume(
        &self,
        db: &D1Database,
    ) -> std::result::Result<Vec<D1PreparedStatement>, Failure> {
        Ok(vec![
            statement(
                db,
                "UPDATE challenges SET used=1 WHERE challenge_id=?1",
                &[text(&self.challenge_id)],
            )?,
            statement(
                db,
                "UPDATE attestation_keys SET counter=?1 WHERE key_id=?2",
                &[number(self.new_counter as i64), text(&self.key_id)],
            )?,
        ])
    }
}
