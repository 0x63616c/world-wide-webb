//! Sign in is independent of App Attest. Only a verified Apple exchange can create a session.
use crate::{
    auth_runtime::{
        Configuration, Failure, blob, now, number, random, response, statement, text, uuid,
    },
    auth_wire::{AppleExchangeRequest, AuthPurpose},
    secrets::KeyRing,
    session,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;

#[derive(Deserialize)]
struct Challenge {
    nonce_hash: Vec<u8>,
    used: u8,
    expires_at_ms: i64,
}
#[derive(Deserialize)]
struct Participant {
    account_state: String,
    participant_id: String,
    revision: i64,
    nickname: String,
    avatar_id: Option<String>,
    membership: String,
    restriction: String,
    nickname_status: String,
    avatar_status: String,
}
#[derive(Deserialize)]
struct Receipt {
    session_id: String,
    challenge_id: String,
    normalized_hash: Vec<u8>,
    participant_revision: i64,
    ciphertext: Vec<u8>,
    key_version: String,
    expires_at_ms: i64,
}
pub(crate) fn subject_keys(env: &Env) -> std::result::Result<KeyRing, Failure> {
    KeyRing::from_secret_json(
        &env.var("AUTH_SUBJECT_HMAC_KEY_VERSION")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
        &env.secret("AUTH_SUBJECT_HMAC_KEYS")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
    )
    .map_err(|_| Failure::unavailable())
}
async fn participant(
    db: &D1Database,
    digests: &[(String, [u8; 32])],
) -> std::result::Result<Option<Participant>, Failure> {
    let parameters = (1..=digests.len())
        .map(|n| format!("?{n}"))
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT p.account_state,p.participant_id,r.revision,f.nickname,f.avatar_id,p.membership,p.restriction,f.nickname_status,f.avatar_status FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id JOIN profiles f ON f.participant_id=p.participant_id WHERE p.subject_hmac IN ({parameters})"
    );
    let values = digests
        .iter()
        .map(|(_, digest)| text(&crate::assertion::hex(digest)))
        .collect::<Vec<_>>();
    let rows = statement(db, &sql, &values)?
        .all()
        .await
        .map_err(|_| Failure::unavailable())?
        .results::<Participant>()
        .map_err(|_| Failure::unavailable())?;
    if rows.len() > 1 {
        return Err(Failure::unavailable());
    }
    Ok(rows.into_iter().next())
}
pub(crate) async fn sign_in(
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: AppleExchangeRequest = crate::auth_runtime::decode(body)?;
    if !input.validate() {
        return Err(Failure::malformed());
    }
    // Separate reauthentication/deletion recovery operations must not accidentally create accounts.
    if input.purpose != AuthPurpose::SignIn {
        return Err(Failure::unavailable());
    }
    let timestamp = now();
    statement(
        db,
        "DELETE FROM sign_in_receipts WHERE expires_at_ms<=?1",
        &[number(timestamp)],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    let challenge=statement(db,"SELECT nonce_hash,used,expires_at_ms FROM challenges WHERE challenge_id=?1 AND deployment=?2 AND purpose='sign_in'",&[text(input.challenge_id.as_str()),text(&config.deployment)])?.first::<Challenge>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    if (challenge.used == 0 && challenge.expires_at_ms <= timestamp)
        || challenge.nonce_hash.len() != 32
    {
        return Err(Failure::unauthorized());
    }
    let expected_nonce = crate::assertion::hex(&challenge.nonce_hash);
    let client_id = env
        .var("APPLE_SIGN_IN_CLIENT_ID")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let keys = crate::apple_transport::apple_keys()
        .await
        .map_err(|_| Failure::unavailable())?;
    let identity = crate::apple_identity::verify_identity_token(
        &input.identity_token,
        &keys,
        &client_id,
        &expected_nonce,
        (timestamp / 1000) as u64,
    )
    .map_err(|_| Failure::unauthorized())?;
    let subjects = subject_keys(env)?;
    let digests = subjects.keyed_digests("apple-subject", &identity.subject);
    let current_digest = &digests
        .iter()
        .find(|(version, _)| version == subjects.version())
        .ok_or_else(Failure::unavailable)?
        .1;
    let normalized=Sha256::digest(serde_json::to_vec(&serde_json::json!({"operation_id":input.operation_id,"purpose":"sign_in","challenge_id":input.challenge_id,"device_id":input.device_id,"deletion_operation_id":null})).map_err(|_|Failure::unavailable())?);
    if let Some(owner) = participant(db, &digests).await? {
        if owner.account_state != "active" {
            return Err(Failure::unauthorized());
        }
        if let Some(receipt)=statement(db,"SELECT session_id,challenge_id,normalized_hash,participant_revision,ciphertext,key_version,expires_at_ms FROM sign_in_receipts WHERE participant_id=?1 AND operation_id=?2",&[text(&owner.participant_id),text(input.operation_id.as_str())])?.first::<Receipt>(None).await.map_err(|_|Failure::unavailable())? {
            if receipt.normalized_hash!=normalized.as_slice() || receipt.challenge_id!=input.challenge_id.as_str() {return Err(Failure::conflict());}
            if receipt.expires_at_ms<=timestamp || owner.restriction!="none" {return Err(Failure::unauthorized());}
            let context=format!("Folding-v1/{}/sign-in/{}/{}",config.deployment,owner.participant_id,input.operation_id.as_str());
            let plain=config.keys.open(&receipt.key_version,&context,&receipt.ciphertext).map_err(|_|Failure::unavailable())?;
            let value:serde_json::Value=serde_json::from_slice(&plain).map_err(|_|Failure::unavailable())?;
            let current_hash=value.get("refresh_token").and_then(serde_json::Value::as_str).and_then(session::token_hash).ok_or_else(Failure::unavailable)?;
            let guard=uuid()?;
            db.batch(vec![statement(db,RECOVERY_GUARD,&[text(&guard),text(&owner.participant_id),text(&receipt.session_id),text(input.operation_id.as_str()),number(timestamp),number(receipt.participant_revision),text(&config.deployment),text(input.device_id.as_str()),text(input.challenge_id.as_str()),blob(&normalized),blob(&current_hash)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::unauthorized())?;
            return response(&value);
        }
    }
    if challenge.used != 0 {
        return Err(Failure::unauthorized());
    }
    let private = URL_SAFE_NO_PAD
        .decode(
            env.secret("APPLE_SIGN_IN_PRIVATE_KEY_PKCS8")
                .map_err(|_| Failure::unavailable())?
                .to_string(),
        )
        .map_err(|_| Failure::unavailable())?;
    let client_secret = crate::apple_client::client_secret(
        &private,
        &env.var("APPLE_SIGN_IN_KEY_ID")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
        &env.var("APPLE_SIGN_IN_TEAM_ID")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
        &client_id,
        (timestamp / 1000) as u64,
    )
    .map_err(|_| Failure::unavailable())?;
    let verified = crate::apple_transport::exchange_native_authorization(
        &input.identity_token,
        &input.authorization_code,
        &client_id,
        &client_secret,
        &expected_nonce,
    )
    .await
    .map_err(|error| match error {
        crate::apple_transport::AppleTransportError::Rejected => Failure::unauthorized(),
        _ => Failure::unavailable(),
    })?;
    if verified.identity.subject != identity.subject {
        return Err(Failure::unauthorized());
    }
    for _ in 0..3 {
        let existing = participant(db, &digests).await?;
        let created = existing.is_none();
        let owner = existing.unwrap_or(Participant {
            account_state: "active".into(),
            participant_id: uuid()?,
            revision: 0,
            nickname: "Folder".into(),
            avatar_id: None,
            membership: "not_joined".into(),
            restriction: "none".into(),
            nickname_status: "approved".into(),
            avatar_status: "none".into(),
        });
        if owner.account_state != "active" {
            return Err(Failure::unauthorized());
        }
        let timestamp = now();
        let session_id = uuid()?;
        let guard = uuid()?;
        let access = random::<32>()?;
        let refresh = random::<32>()?;
        let expiry = timestamp + session::ACCESS_LIFETIME_MS;
        let profile = serde_json::json!({"participant_id":owner.participant_id,"nickname":owner.nickname,"avatar_id":owner.avatar_id,"membership":owner.membership,"restriction":owner.restriction,"nickname_status":owner.nickname_status,"avatar_status":owner.avatar_status});
        let value = serde_json::json!({"access_token":URL_SAFE_NO_PAD.encode(access),"refresh_token":URL_SAFE_NO_PAD.encode(refresh),"expires_at_ms":expiry,"profile":profile,"request_id":request_id});
        let receipt_context = format!(
            "Folding-v1/{}/sign-in/{}/{}",
            config.deployment,
            owner.participant_id,
            input.operation_id.as_str()
        );
        let receipt = config
            .keys
            .seal(
                random::<12>()?,
                &receipt_context,
                &serde_json::to_vec(&value).map_err(|_| Failure::unavailable())?,
            )
            .map_err(|_| Failure::unavailable())?;
        let authorization = serde_json::json!({"subject":verified.identity.subject,"refresh_token":verified.revocation_refresh_token});
        let authorization = config
            .keys
            .seal(
                random::<12>()?,
                &format!(
                    "Folding-v1/{}/apple/{}",
                    config.deployment, owner.participant_id
                ),
                &serde_json::to_vec(&authorization).map_err(|_| Failure::unavailable())?,
            )
            .map_err(|_| Failure::unavailable())?;
        let mut statements = vec![statement(
            db,
            SIGN_IN_GUARD,
            &[
                text(&guard),
                text(input.challenge_id.as_str()),
                text(&config.deployment),
                number(timestamp),
                blob(&challenge.nonce_hash),
            ],
        )?];
        if created {
            statements.push(statement(db,"INSERT INTO participants(participant_id,subject_hmac,membership,restriction,generation_revision,generation_id,epoch_id,active_device_id) VALUES (?1,?2,'not_joined','none',0,'00000000-0000-0000-0000-000000000000',NULL,NULL)",&[text(&owner.participant_id),text(&crate::assertion::hex(current_digest))])?);
            statements.push(statement(
                db,
                "INSERT INTO participant_revisions VALUES (?1,0)",
                &[text(&owner.participant_id)],
            )?);
            statements.push(statement(
                db,
                "INSERT INTO profiles VALUES (?1,'Folder',NULL,'approved','none')",
                &[text(&owner.participant_id)],
            )?);
        } else {
            statements.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (SELECT 1 FROM participant_revisions r JOIN participants p ON p.participant_id=r.participant_id WHERE r.participant_id=?2 AND r.revision=?3 AND p.account_state='active') THEN 1 ELSE 0 END)",&[text(&format!("{guard}-participant")),text(&owner.participant_id),number(owner.revision)])?);
            statements.push(statement(
                db,
                "UPDATE participants SET subject_hmac=?1 WHERE participant_id=?2",
                &[
                    text(&crate::assertion::hex(current_digest)),
                    text(&owner.participant_id),
                ],
            )?);
        }
        statements.extend([
            statement(db,"INSERT INTO auth_operation_claims VALUES (?1,'sign_in',?2,?3,?4)",&[text(&owner.participant_id),text(input.operation_id.as_str()),text(&session_id),number(timestamp)])?,
            statement(db,"UPDATE challenges SET used=1 WHERE challenge_id=?1",&[text(input.challenge_id.as_str())])?,
            statement(db,"INSERT INTO sessions VALUES (?1,?2,?3,?4,?5,?5,?6,?7,0)",&[text(&session_id),text(&owner.participant_id),text(input.device_id.as_str()),text(&config.deployment),number(timestamp),number(timestamp+session::MAX_LIFETIME_MS),number(timestamp+session::IDLE_LIFETIME_MS)])?,
            statement(db,"INSERT INTO access_tokens VALUES (?1,?2,?3)",&[blob(&Sha256::digest(access)),text(&session_id),number(expiry)])?,
            statement(db,"INSERT INTO refresh_tokens VALUES (?1,?2,?3,NULL,NULL)",&[blob(&Sha256::digest(refresh)),text(&session_id),number(timestamp)])?,
            statement(db,"INSERT INTO apple_authorizations VALUES (?1,?2,?3,?4,?5) ON CONFLICT(participant_id,deployment) DO UPDATE SET ciphertext=excluded.ciphertext,key_version=excluded.key_version,updated_at_ms=excluded.updated_at_ms",&[text(&owner.participant_id),text(&config.deployment),blob(&authorization),text(config.keys.version()),number(timestamp)])?,
            statement(db,"INSERT INTO sign_in_receipts VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",&[text(&owner.participant_id),text(input.operation_id.as_str()),text(&session_id),text(input.challenge_id.as_str()),blob(&normalized),number(owner.revision),blob(&receipt),text(config.keys.version()),number(timestamp+60000)])?,
            statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1 OR guard_id=?2",&[text(&guard),text(&format!("{guard}-participant"))])?,
        ]);
        if db.batch(statements).await.is_ok() {
            return response(&value);
        }
    }
    Err(Failure::conflict())
}
const SIGN_IN_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (
 SELECT 1 FROM challenges WHERE challenge_id=?2 AND deployment=?3 AND purpose='sign_in'
 AND expires_at_ms>?4 AND used=0 AND nonce_hash=?5 AND participant_id IS NULL AND session_id IS NULL
) THEN 1 ELSE 0 END)
"#;
const RECOVERY_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS (
 SELECT 1 FROM participants p JOIN participant_revisions r ON r.participant_id=p.participant_id
 JOIN sessions s ON s.participant_id=p.participant_id JOIN sign_in_receipts i ON i.session_id=s.session_id
 JOIN challenges c ON c.challenge_id=i.challenge_id
 JOIN refresh_tokens current ON current.session_id=s.session_id
 WHERE p.participant_id=?2 AND p.restriction='none' AND p.account_state='active' AND s.session_id=?3 AND i.operation_id=?4
 AND s.revoked=0 AND s.absolute_expires_at_ms>?5 AND s.idle_expires_at_ms>?5 AND i.expires_at_ms>?5
 AND r.revision=?6 AND i.participant_revision=?6 AND s.deployment=?7 AND c.deployment=?7
 AND s.device_id=?8 AND c.challenge_id=?9 AND c.used=1 AND i.normalized_hash=?10
 AND current.token_hash=?11 AND current.rotated_operation_id IS NULL
) THEN 1 ELSE 0 END)
"#;
