//! Immediate deletion fencing, narrow polling capability and leased external-revocation cleanup.
use crate::auth_runtime::{
    Configuration, Failure, authenticated_session, blob, decode, now, number, random, response,
    session_guard, statement, text, uuid,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use folding_domain::wire::Id;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use worker::*;
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Delete {
    operation_id: Id,
    reauthentication_token: String,
}
#[derive(Deserialize)]
struct Operation {
    state: String,
    recover_until_ms: Option<i64>,
}
fn value(
    operation: &Id,
    state: &str,
    token: &[u8; 32],
    time: i64,
    request_id: &Id,
) -> serde_json::Value {
    serde_json::json!({"status":{"operation_id":operation,"state":state,"error_code":null},"polling_token":URL_SAFE_NO_PAD.encode(token),"polling_token_expires_at_ms":time+900000,"request_id":request_id})
}
pub(crate) async fn delete(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    body: &[u8],
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let input: Delete = decode(body)?;
    let token =
        crate::session::token_hash(&input.reauthentication_token).ok_or_else(Failure::malformed)?;
    let session = authenticated_session(request, db, config, false).await?;
    let time = now();
    let guard = uuid()?;
    let polling = random::<32>()?;
    let value = value(&input.operation_id, "pending", &polling, time, request_id);
    let mut writes = vec![
        session_guard(db, &guard, &session, config, time)?,
        statement(
            db,
            crate::lifecycle_runtime::PRIVACY_GUARD,
            &[
                text(&format!("{guard}-community")),
                text(&session.participant_id),
                number(session.revision),
            ],
        )?,
        statement(
            db,
            DELETE_GUARD,
            &[
                text(&format!("{guard}-business")),
                blob(&token),
                text(&session.participant_id),
                text(&session.session_id),
                number(time),
            ],
        )?,
        statement(
            db,
            "UPDATE reauthentications SET used=1 WHERE token_hash=?1",
            &[blob(&token)],
        )?,
        statement(
            db,
            "INSERT INTO deletion_operations(participant_id,operation_id,state,created_at_ms) VALUES (?1,?2,'pending',?3)",
            &[
                text(&session.participant_id),
                text(input.operation_id.as_str()),
                number(time),
            ],
        )?,
        statement(
            db,
            "INSERT INTO deletion_polling_tokens VALUES (?1,?2,?3,?4)",
            &[
                blob(&Sha256::digest(polling)),
                text(&session.participant_id),
                text(input.operation_id.as_str()),
                number(time + 900000),
            ],
        )?,
        statement(
            db,
            "UPDATE participants SET account_state='deleting',membership='left',epoch_id=NULL,active_device_id=NULL WHERE participant_id=?1",
            &[text(&session.participant_id)],
        )?,
        statement(
            db,
            "UPDATE sessions SET revoked=1 WHERE participant_id=?1",
            &[text(&session.participant_id)],
        )?,
        statement(
            db,
            "UPDATE attestation_keys SET revoked=1 WHERE participant_id=?1",
            &[text(&session.participant_id)],
        )?,
        statement(
            db,
            "UPDATE epochs SET closed_at_ms=?1 WHERE participant_id=?2 AND closed_at_ms IS NULL",
            &[number(time), text(&session.participant_id)],
        )?,
    ];
    writes.extend(crate::lifecycle_runtime::erase_results(
        db,
        &session.participant_id,
    )?);
    for table in [
        "live_scores",
        "score_jobs",
        "observations",
        "nickname_requests",
        "push_installations",
    ] {
        writes.push(statement(
            db,
            &format!("DELETE FROM {table} WHERE participant_id=?1"),
            &[text(&session.participant_id)],
        )?);
    }
    writes.push(statement(
        db,
        crate::mutation::ADVANCE_REVISION,
        &[text(&session.participant_id)],
    )?);
    writes.push(crate::competition_runtime::cleanup(db, &guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    Ok(response(&value)?.with_status(202))
}
const DELETE_GUARD: &str = r#"
INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(
 SELECT 1 FROM reauthentications WHERE token_hash=?2 AND participant_id=?3 AND session_id=?4
 AND expires_at_ms>?5 AND used=0
) THEN 1 ELSE 0 END)
"#;
pub(crate) async fn recover(
    db: &D1Database,
    config: &Configuration,
    participant: &str,
    recovery_operation: &Id,
    normalized: &[u8],
    operation: &Id,
    mut writes: Vec<D1PreparedStatement>,
    guard: &str,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let time = now();
    let old=statement(db,"SELECT state,recover_until_ms FROM deletion_operations WHERE participant_id=?1 AND operation_id=?2",&[text(participant),text(operation.as_str())])?.first::<Operation>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
    if old.recover_until_ms.is_some_and(|expiry| expiry <= time) {
        return Err(Failure::unauthorized());
    }
    let token = random::<32>()?;
    writes.push(statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM deletion_operations WHERE participant_id=?2 AND operation_id=?3 AND (recover_until_ms IS NULL OR recover_until_ms>?4)) THEN 1 ELSE 0 END)",&[text(&format!("{guard}-business")),text(participant),text(operation.as_str()),number(time)])?);
    writes.push(statement(
        db,
        "INSERT INTO deletion_polling_tokens VALUES (?1,?2,?3,?4)",
        &[
            blob(&Sha256::digest(token)),
            text(participant),
            text(operation.as_str()),
            number(time + 900000),
        ],
    )?);
    let result = value(operation, &old.state, &token, time, request_id);
    let ciphertext = config
        .keys
        .seal(
            random::<12>()?,
            &format!(
                "Folding-v1/{}/deletion-recovery/{participant}/{}",
                config.deployment,
                recovery_operation.as_str()
            ),
            &serde_json::to_vec(&result).map_err(|_| Failure::unavailable())?,
        )
        .map_err(|_| Failure::unavailable())?;
    writes.push(statement(
        db,
        "INSERT INTO deletion_recovery_claims VALUES (?1,?2,?3)",
        &[
            text(participant),
            text(recovery_operation.as_str()),
            blob(normalized),
        ],
    )?);
    writes.push(statement(
        db,
        "INSERT INTO deletion_recovery_receipts VALUES (?1,?2,?3,?4,?5,?6,?7)",
        &[
            text(participant),
            text(recovery_operation.as_str()),
            text(operation.as_str()),
            blob(normalized),
            blob(&ciphertext),
            text(config.keys.version()),
            number(time + 60000),
        ],
    )?);
    writes.push(crate::competition_runtime::cleanup(db, guard)?);
    db.batch(writes).await.map_err(|_| Failure::conflict())?;
    response(&result)
}
pub(crate) async fn poll(
    request: &Request,
    db: &D1Database,
    config: &Configuration,
    request_id: &Id,
) -> std::result::Result<Response, Failure> {
    let path = request.path();
    let operation = Id::parse(
        path.strip_prefix("/v1/operations/")
            .ok_or_else(Failure::malformed)?,
    )
    .map_err(|_| Failure::malformed())?;
    let authorization = request
        .headers()
        .get("Authorization")
        .map_err(|_| Failure::unauthorized())?
        .ok_or_else(Failure::unauthorized)?;
    if let Some(token) = authorization.strip_prefix("Deletion ") {
        let hash = crate::session::token_hash(token).ok_or_else(Failure::unauthorized)?;
        let row=statement(db,"SELECT d.state,d.recover_until_ms FROM deletion_operations d JOIN deletion_polling_tokens t ON t.participant_id=d.participant_id AND t.operation_id=d.operation_id WHERE t.token_hash=?1 AND t.operation_id=?2 AND t.expires_at_ms>?3",&[blob(&hash),text(operation.as_str()),number(now())])?.first::<Operation>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unauthorized)?;
        return response(
            &serde_json::json!({"operation_id":operation,"state":row.state,"error_code":null,"request_id":request_id}),
        );
    }
    let session = authenticated_session(request, db, config, false).await?;
    let old = crate::competition_runtime::receipt(db, &session.participant_id, &operation)
        .await?
        .filter(|r| r.route == "/v1/enrollment/leave")
        .ok_or(Failure {
            status: 404,
            code: "not_found",
            retryable: false,
        })?;
    let value: serde_json::Value =
        serde_json::from_str(&old.response_json).map_err(|_| Failure::unavailable())?;
    response(&value)
}
#[derive(Deserialize)]
struct Job {
    participant_id: String,
    operation_id: String,
}
#[derive(Deserialize)]
struct Authorization {
    ciphertext: Vec<u8>,
    key_version: String,
}
#[derive(Deserialize)]
struct Credential {
    refresh_token: String,
}
pub(crate) async fn process(env: &Env, db: &D1Database) -> std::result::Result<(), Failure> {
    let config = Configuration::load(env)?;
    let time = now();
    let jobs=statement(db,"SELECT participant_id,operation_id FROM deletion_operations WHERE state='pending' AND lease_until_ms<=?1 ORDER BY created_at_ms LIMIT 10",&[number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Job>().map_err(|_|Failure::unavailable())?;
    for job in jobs {
        let lease = time + 120000;
        let claimed=statement(db,"UPDATE deletion_operations SET lease_until_ms=?1,attempts=attempts+1 WHERE participant_id=?2 AND operation_id=?3 AND state='pending' AND lease_until_ms<=?4 RETURNING participant_id,operation_id",&[number(lease),text(&job.participant_id),text(&job.operation_id),number(time)])?.first::<Job>(None).await.map_err(|_|Failure::unavailable())?;
        if claimed.is_none() {
            continue;
        }
        let authorization=statement(db,"SELECT ciphertext,key_version FROM apple_authorizations WHERE participant_id=?1 AND deployment=?2",&[text(&job.participant_id),text(&config.deployment)])?.first::<Authorization>(None).await.map_err(|_|Failure::unavailable())?;
        if let Some(auth) = authorization {
            let plain = config
                .keys
                .open(
                    &auth.key_version,
                    &format!(
                        "Folding-v1/{}/apple/{}",
                        config.deployment, job.participant_id
                    ),
                    &auth.ciphertext,
                )
                .map_err(|_| Failure::unavailable())?;
            let credential: Credential =
                serde_json::from_slice(&plain).map_err(|_| Failure::unavailable())?;
            let (client, secret) = crate::reauth_runtime::client_secret(env, now())?;
            if crate::apple_transport::revoke_refresh_token(
                &client,
                &secret,
                &credential.refresh_token,
            )
            .await
            .is_err()
            {
                continue;
            }
        }
        let guard = uuid()?;
        let completed = now();
        let mut writes = vec![statement(
            db,
            "INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM deletion_operations d JOIN participants p ON p.participant_id=d.participant_id WHERE d.participant_id=?2 AND d.operation_id=?3 AND d.state='pending' AND d.lease_until_ms=?4 AND p.account_state='deleting') THEN 1 ELSE 0 END)",
            &[
                text(&guard),
                text(&job.participant_id),
                text(&job.operation_id),
                number(lease),
            ],
        )?];
        for table in [
            "results",
            "period_roster",
            "award_jobs",
            "observations",
            "live_scores",
            "score_jobs",
            "competition_operations",
            "nickname_requests",
            "profiles",
            "blocks",
            "attestation_keys",
            "sessions",
            "apple_authorizations",
            "epochs",
            "auth_operation_claims",
            "reauthentication_claims",
        ] {
            writes.push(statement(
                db,
                &format!("DELETE FROM {table} WHERE participant_id=?1"),
                &[text(&job.participant_id)],
            )?);
        }
        writes.push(statement(db,"UPDATE participants SET account_state='deleted',generation_revision=0,generation_id='00000000-0000-0000-0000-000000000000' WHERE participant_id=?1",&[text(&job.participant_id)])?);
        writes.push(statement(db,"UPDATE deletion_operations SET state='completed',completed_at_ms=?1,recover_until_ms=?2,lease_until_ms=0 WHERE participant_id=?3 AND operation_id=?4",&[number(completed),number(completed+2592000000),text(&job.participant_id),text(&job.operation_id)])?);
        writes.push(statement(
            db,
            "DELETE FROM mutation_guards WHERE guard_id=?1",
            &[text(&guard)],
        )?);
        db.batch(writes).await.map_err(|_| Failure::unavailable())?;
    }
    Ok(())
}
#[derive(Deserialize)]
struct Revocation {
    job_id: String,
    ciphertext: Vec<u8>,
    key_version: String,
}
pub(crate) async fn revoke_recovery_grants(
    env: &Env,
    db: &D1Database,
) -> std::result::Result<(), Failure> {
    let config = Configuration::load(env)?;
    let time = now();
    let jobs=statement(db,"SELECT job_id,ciphertext,key_version FROM apple_revocation_jobs WHERE deployment=?1 AND lease_until_ms<=?2 LIMIT 10",&[text(&config.deployment),number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Revocation>().map_err(|_|Failure::unavailable())?;
    for job in jobs {
        let lease = time + 120000;
        let claimed=statement(db,"UPDATE apple_revocation_jobs SET lease_until_ms=?1 WHERE job_id=?2 AND lease_until_ms<=?3 RETURNING job_id,ciphertext,key_version",&[number(lease),text(&job.job_id),number(time)])?.first::<Revocation>(None).await.map_err(|_|Failure::unavailable())?;
        if claimed.is_none() {
            continue;
        }
        let plain = config
            .keys
            .open(
                &job.key_version,
                &format!("Folding-v1/{}/revocation/{}", config.deployment, job.job_id),
                &job.ciphertext,
            )
            .map_err(|_| Failure::unavailable())?;
        let token = String::from_utf8(plain).map_err(|_| Failure::unavailable())?;
        let (client, secret) = crate::reauth_runtime::client_secret(env, now())?;
        if crate::apple_transport::revoke_refresh_token(&client, &secret, &token)
            .await
            .is_ok()
        {
            statement(
                db,
                "DELETE FROM apple_revocation_jobs WHERE job_id=?1 AND lease_until_ms=?2",
                &[text(&job.job_id), number(lease)],
            )?
            .run()
            .await
            .map_err(|_| Failure::unavailable())?;
        }
    }
    Ok(())
}
#[derive(Deserialize)]
struct RecoveryReceipt {
    deletion_operation_id: String,
    normalized_hash: Vec<u8>,
    ciphertext: Vec<u8>,
    key_version: String,
    expires_at_ms: i64,
}
pub(crate) async fn recover_receipt(
    db: &D1Database,
    config: &Configuration,
    participant: &str,
    operation: &Id,
    normalized: &[u8],
    time: i64,
) -> std::result::Result<Option<serde_json::Value>, Failure> {
    let old=statement(db,"SELECT deletion_operation_id,normalized_hash,ciphertext,key_version,expires_at_ms FROM deletion_recovery_receipts WHERE participant_id=?1 AND operation_id=?2",&[text(participant),text(operation.as_str())])?.first::<RecoveryReceipt>(None).await.map_err(|_|Failure::unavailable())?;
    let Some(old) = old else { return Ok(None) };
    if old.normalized_hash != normalized {
        return Err(Failure::conflict());
    }
    if old.expires_at_ms <= time {
        return Err(Failure::unauthorized());
    }
    let plain = config
        .keys
        .open(
            &old.key_version,
            &format!(
                "Folding-v1/{}/deletion-recovery/{participant}/{}",
                config.deployment,
                operation.as_str()
            ),
            &old.ciphertext,
        )
        .map_err(|_| Failure::unavailable())?;
    let value: serde_json::Value =
        serde_json::from_slice(&plain).map_err(|_| Failure::unavailable())?;
    let token = value
        .get("polling_token")
        .and_then(serde_json::Value::as_str)
        .and_then(crate::session::token_hash)
        .ok_or_else(Failure::unavailable)?;
    let guard = uuid()?;
    db.batch(vec![statement(db,"INSERT INTO mutation_guards VALUES (?1,CASE WHEN EXISTS(SELECT 1 FROM deletion_operations d JOIN deletion_polling_tokens t ON t.participant_id=d.participant_id AND t.operation_id=d.operation_id WHERE d.participant_id=?2 AND d.operation_id=?3 AND (d.recover_until_ms IS NULL OR d.recover_until_ms>?4) AND t.token_hash=?5 AND t.expires_at_ms>?4) THEN 1 ELSE 0 END)",&[text(&guard),text(participant),text(&old.deletion_operation_id),number(time),blob(&token)])?,statement(db,"DELETE FROM mutation_guards WHERE guard_id=?1",&[text(&guard)])?]).await.map_err(|_|Failure::unauthorized())?;
    Ok(Some(value))
}
