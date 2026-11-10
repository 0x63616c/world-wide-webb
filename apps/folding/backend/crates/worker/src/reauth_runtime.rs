//! Same-subject native reauthentication and deletion-status recovery. Neither creates a session.
use crate::{
    auth_runtime::{
        Configuration, Failure, authenticated_session, blob, decode, now, number, random, response,
        session_guard, statement, text, uuid,
    },
    auth_wire::{AppleExchangeRequest, AuthPurpose},
    lifecycle_runtime::PRIVACY_GUARD,
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
struct Owner {
    participant_id: String,
    account_state: String,
}
#[derive(Deserialize)]
struct Proof {
    normalized_hash: Vec<u8>,
    ciphertext: Vec<u8>,
    key_version: String,
    expires_at_ms: i64,
    used: u8,
    session_id: String,
}
pub(crate) fn client_secret(
    env: &Env,
    time: i64,
) -> std::result::Result<(String, String), Failure> {
    let client = env
        .var("APPLE_SIGN_IN_CLIENT_ID")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let private = URL_SAFE_NO_PAD
        .decode(
            env.secret("APPLE_SIGN_IN_PRIVATE_KEY_PKCS8")
                .map_err(|_| Failure::unavailable())?
                .to_string(),
        )
        .map_err(|_| Failure::unavailable())?;
    let secret = crate::apple_client::client_secret(
        &private,
        &env.var("APPLE_SIGN_IN_KEY_ID")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
        &env.var("APPLE_SIGN_IN_TEAM_ID")
            .map_err(|_| Failure::unavailable())?
            .to_string(),
        &client,
        (time / 1000) as u64,
    )
    .map_err(|_| Failure::unavailable())?;
    Ok((client, secret))
}
pub(crate) const CHALLENGE_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM challenges WHERE challenge_id=?2 AND deployment=?3 AND purpose=?4
 AND nonce_hash=?5 AND used=0 AND expires_at_ms>?6
) THEN 1 ELSE 0 END)
"#;
pub(crate) async fn exchange(
    request: &Request,
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: AppleExchangeRequest = decode(body)?;
    if !input.validate() || input.purpose == AuthPurpose::SignIn {
        return Err(Failure::malformed());
    }
    let recovery = input.purpose == AuthPurpose::RecoverDeletion;
    let purpose = if recovery {
        "recover_deletion"
    } else {
        "reauthenticate"
    };
    let time = now();
    let challenge=statement(db,"SELECT nonce_hash,used,expires_at_ms FROM challenges WHERE challenge_id=?1 AND deployment=?2 AND purpose=?3",&[text(input.challenge_id.as_str()),text(&config.deployment),text(purpose)])?.first::<Challenge>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    if (challenge.used == 0 && challenge.expires_at_ms <= time) || challenge.nonce_hash.len() != 32
    {
        return Err(Failure::unauthorized());
    }
    let nonce = crate::assertion::hex(&challenge.nonce_hash);
    let (client, secret) = client_secret(env, time)?;
    let keys = crate::apple_transport::apple_keys()
        .await
        .map_err(|_| Failure::unavailable())?;
    let identity = crate::apple_identity::verify_identity_token(
        &input.identity_token,
        &keys,
        &client,
        &nonce,
        (time / 1000) as u64,
    )
    .map_err(|_| Failure::unauthorized())?;
    let digests =
        crate::auth_signin::subject_keys(env)?.keyed_digests("apple-subject", &identity.subject);
    let placeholders = (1..=digests.len())
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(",");
    let owners=statement(db,&format!("SELECT participant_id,account_state FROM participants WHERE subject_hmac IN ({placeholders})"),&digests.iter().map(|(_,d)|text(&crate::assertion::hex(d))).collect::<Vec<_>>())?.all().await.map_err(|_|Failure::unavailable())?.results::<Owner>().map_err(|_|Failure::unavailable())?;
    if owners.len() != 1 {
        return Err(Failure::unauthorized());
    }
    let owner = &owners[0];
    // Reject expired/unknown receipts before exchanging an Apple code for a fresh revocation grant.
    if recovery {
        #[derive(Deserialize)]
        struct RecoveryWindow {
            recover_until_ms: Option<i64>,
        }
        let window = statement(db, "SELECT recover_until_ms FROM deletion_operations WHERE participant_id=?1 AND operation_id=?2", &[text(&owner.participant_id), text(input.deletion_operation_id.as_ref().ok_or_else(Failure::malformed)?.as_str())])?
            .first::<RecoveryWindow>(None).await.map_err(|_| Failure::unavailable())?
            .ok_or(Failure { status: 404, code: "not_found", retryable: false })?;
        if window.recover_until_ms.is_some_and(|expiry| expiry <= time) {
            return Err(Failure::unauthorized());
        }
    }

    let normalized=Sha256::digest(serde_json::to_vec(&serde_json::json!({"operation_id":input.operation_id,"purpose":purpose,"challenge_id":input.challenge_id,"device_id":input.device_id,"deletion_operation_id":input.deletion_operation_id})).map_err(|_|Failure::unavailable())?);
    if recovery
        && let Some(value) = crate::deletion_runtime::recover_receipt(
            db,
            config,
            &owner.participant_id,
            &input.operation_id,
            &normalized,
            time,
        )
        .await?
    {
        return response(&value);
    }
    let session = if recovery {
        None
    } else {
        let s = authenticated_session(request, db, config, false).await?;
        if s.participant_id != owner.participant_id
            || s.device_id != input.device_id.as_str()
            || owner.account_state != "active"
        {
            return Err(Failure::unauthorized());
        }
        Some(s)
    };
    if let Some(s) = &session
        && let Some(old)=statement(db,"SELECT normalized_hash,ciphertext,key_version,expires_at_ms,used,session_id FROM reauthentications WHERE participant_id=?1 AND operation_id=?2",&[text(&s.participant_id),text(input.operation_id.as_str())])?.first::<Proof>(None).await.map_err(|_|Failure::unavailable())? {
   if old.normalized_hash!=normalized.as_slice(){return Err(Failure::conflict());}
   if old.used!=0||old.expires_at_ms<=time||old.session_id!=s.session_id{return Err(Failure::unauthorized());}
   let plain=config.keys.open(&old.key_version,&format!("Folding-v1/{}/reauth/{}/{}",config.deployment,s.participant_id,input.operation_id.as_str()),&old.ciphertext).map_err(|_|Failure::unavailable())?;
   let value:serde_json::Value=serde_json::from_slice(&plain).map_err(|_|Failure::unavailable())?;
   let guard=uuid()?;db.batch(vec![session_guard(db,&guard,s,config,time)?,statement(db,PRIVACY_GUARD,&[text(&format!("{guard}-community")),text(&s.participant_id),number(s.revision)])?,crate::competition_runtime::cleanup(db,&guard)?]).await.map_err(|_|Failure::unauthorized())?;return response(&value);
    }
    if challenge.used != 0 {
        return Err(Failure::unauthorized());
    }
    let verified = crate::apple_transport::exchange_native_authorization(
        &input.identity_token,
        &input.authorization_code,
        &client,
        &secret,
        &nonce,
    )
    .await
    .map_err(|e| match e {
        crate::apple_transport::AppleTransportError::Rejected => Failure::unauthorized(),
        _ => Failure::unavailable(),
    })?;
    if verified.identity.subject != identity.subject {
        return Err(Failure::unauthorized());
    }
    let time = now(); // Network verification must not extend the challenge's authorization window.
    let guard = uuid()?;
    let mut writes = vec![
        statement(
            db,
            CHALLENGE_GUARD,
            &[
                text(&guard),
                text(input.challenge_id.as_str()),
                text(&config.deployment),
                text(purpose),
                blob(&challenge.nonce_hash),
                number(time),
            ],
        )?,
        statement(
            db,
            "UPDATE challenges SET used=1 WHERE challenge_id=?1",
            &[text(input.challenge_id.as_str())],
        )?,
    ];
    if let Some(s) = &session {
        let authorization=config.keys.seal(random::<12>()?,&format!("Folding-v1/{}/apple/{}",config.deployment,s.participant_id),&serde_json::to_vec(&serde_json::json!({"subject":verified.identity.subject,"refresh_token":verified.revocation_refresh_token})).map_err(|_|Failure::unavailable())?).map_err(|_|Failure::unavailable())?;
        writes.push(statement(db,"INSERT INTO apple_authorizations VALUES (?1,?2,?3,?4,?5) ON CONFLICT(participant_id,deployment) DO UPDATE SET ciphertext=excluded.ciphertext,key_version=excluded.key_version,updated_at_ms=excluded.updated_at_ms",&[text(&s.participant_id),text(&config.deployment),blob(&authorization),text(config.keys.version()),number(time)])?);
    } else {
        let job = uuid()?;
        let cipher = config
            .keys
            .seal(
                random::<12>()?,
                &format!("Folding-v1/{}/revocation/{job}", config.deployment),
                verified.revocation_refresh_token.as_bytes(),
            )
            .map_err(|_| Failure::unavailable())?;
        writes.push(statement(db,"INSERT INTO apple_revocation_jobs(job_id,deployment,ciphertext,key_version) VALUES (?1,?2,?3,?4)",&[text(&job),text(&config.deployment),blob(&cipher),text(config.keys.version())])?);
    }
    if let Some(s) = session {
        let token = random::<32>()?;
        let expires = time + 300000;
        let value = serde_json::json!({"reauthentication_token":URL_SAFE_NO_PAD.encode(token),"expires_at_ms":expires,"request_id":request_id});
        let cipher = config
            .keys
            .seal(
                random::<12>()?,
                &format!(
                    "Folding-v1/{}/reauth/{}/{}",
                    config.deployment,
                    s.participant_id,
                    input.operation_id.as_str()
                ),
                &serde_json::to_vec(&value).map_err(|_| Failure::unavailable())?,
            )
            .map_err(|_| Failure::unavailable())?;
        writes.push(session_guard(
            db,
            &format!("{guard}-session"),
            &s,
            config,
            time,
        )?);
        writes.push(statement(
            db,
            PRIVACY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&s.participant_id),
                number(s.revision),
            ],
        )?);
        writes.push(statement(
            db,
            "INSERT INTO reauthentication_claims VALUES (?1,?2,?3)",
            &[
                text(&s.participant_id),
                text(input.operation_id.as_str()),
                blob(&normalized),
            ],
        )?);
        writes.push(statement(
            db,
            "INSERT INTO reauthentications VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0)",
            &[
                blob(&Sha256::digest(token)),
                text(&s.participant_id),
                text(&s.session_id),
                text(input.operation_id.as_str()),
                text(input.challenge_id.as_str()),
                blob(&normalized),
                blob(&cipher),
                text(config.keys.version()),
                number(expires),
            ],
        )?);
        writes.push(statement(
            db,
            "DELETE FROM mutation_guards WHERE guard_id=?1",
            &[text(&format!("{guard}-session"))],
        )?);
        writes.push(crate::competition_runtime::cleanup(db, &guard)?);
        db.batch(writes).await.map_err(|_| Failure::conflict())?;
        response(&value)
    } else {
        crate::deletion_runtime::recover(
            db,
            config,
            &owner.participant_id,
            &input.operation_id,
            &normalized,
            input
                .deletion_operation_id
                .as_ref()
                .ok_or_else(Failure::malformed)?,
            writes,
            &guard,
            request_id,
        )
        .await
    }
}
