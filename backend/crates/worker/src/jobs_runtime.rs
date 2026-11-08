//! Transactional D1 outbox. Queue messages contain only opaque job IDs, never authorization or user data.
use crate::auth_runtime::{Failure, now, number, random, statement, text, uuid};
use folding_domain::wire::Id;
use serde::{Deserialize, Serialize};
use worker::*;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Message {
    job_id: Id,
}
#[derive(Deserialize)]
struct Job {
    job_id: String,
    kind: String,
    attempts: i64,
}
// A single indexed existence query replaces unconditional dispatch writes.
// Per-category domain dispatchers still enforce leases, privacy fences and retry times.
pub const DUE_CATEGORIES_SQL: &str = r#"
SELECT value AS kind FROM json_each('["avatar_cleanup","finalization","corrections","awards","deletion","recovery_revocation","retention"]')
WHERE CASE value
 WHEN 'avatar_cleanup' THEN (EXISTS(SELECT 1 FROM avatar_purge_jobs a WHERE lease_until_ms<=?1 AND NOT EXISTS(SELECT 1 FROM external_retry_state r WHERE r.kind='avatar_cleanup' AND r.work_key=a.object_key AND (r.state='failed' OR r.next_attempt_ms>?1)))
 OR (NOT EXISTS(SELECT 1 FROM jobs WHERE kind='avatar_cleanup' AND version>=?2)
 AND EXISTS(SELECT 1 FROM avatar_objects WHERE (state='uploading' AND created_at_ms<=?1-3600000) OR (state='pending' AND created_at_ms<=?1-604800000))))
 WHEN 'finalization' THEN (EXISTS(SELECT 1 FROM periods WHERE state='finalizing' OR (state='grace' AND cutoff_ms<=?1) OR (state='open' AND end_ms<=?1))
 OR (EXISTS(SELECT 1 FROM epochs) AND NOT EXISTS(SELECT 1 FROM jobs WHERE kind='finalization' AND version>=?2)))
 WHEN 'corrections' THEN (EXISTS(SELECT 1 FROM period_corrections WHERE state='building' OR (state='ready' AND expires_at_ms<=?1)))
 WHEN 'awards' THEN (EXISTS(SELECT 1 FROM award_jobs WHERE state='pending' AND lease_until_ms<=?1 AND next_attempt_ms<=?1 AND (due_ms IS NULL OR due_ms<=?1)))
 WHEN 'deletion' THEN (EXISTS(SELECT 1 FROM deletion_operations d WHERE state='pending' AND lease_until_ms<=?1 AND NOT EXISTS(SELECT 1 FROM avatar_purge_jobs a WHERE a.participant_id=d.participant_id) AND NOT EXISTS(SELECT 1 FROM external_retry_state r WHERE r.kind='account_revocation' AND r.work_key=d.operation_id AND (r.state='failed' OR r.next_attempt_ms>?1)))
 AND NOT EXISTS(SELECT 1 FROM external_retry_state WHERE kind='account_revocation' AND work_key='' AND state='paused'))
 WHEN 'recovery_revocation' THEN (EXISTS(SELECT 1 FROM apple_revocation_jobs a WHERE lease_until_ms<=?1 AND NOT EXISTS(SELECT 1 FROM external_retry_state r WHERE r.kind='recovery_revocation' AND r.work_key=a.job_id AND (r.state='failed' OR r.next_attempt_ms>?1)))
 AND NOT EXISTS(SELECT 1 FROM external_retry_state WHERE kind='recovery_revocation' AND work_key='' AND state='paused'))
 WHEN 'retention' THEN (NOT EXISTS(SELECT 1 FROM jobs WHERE kind='retention' AND version>=?2)
 OR EXISTS(SELECT 1 FROM participants WHERE restriction='suspended' AND suspended_until_ms<=?1))
 ELSE 0 END
"#;
pub const INSERT_CATEGORY_SQL: &str = r#"
INSERT INTO jobs(job_id,kind,logical_key,version,due_ms,state)
SELECT ?1,?2,?2,?3,?4,'pending'
WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE kind=?2 AND state IN('pending','failed'))
ON CONFLICT(kind,logical_key,version) DO NOTHING
"#;

pub(crate) async fn schedule(env: &Env, db: &D1Database) -> std::result::Result<(), Failure> {
    let time = now();
    let first_hour_slot = time / 3600000 * 12;
    // Retention and finalization catch-up are hourly; due business work remains five-minute.
    #[derive(Deserialize)]
    struct Category {
        kind: String,
    }
    let categories = statement(
        db,
        DUE_CATEGORIES_SQL,
        &[number(time), number(first_hour_slot)],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results::<Category>()
    .map_err(|_| Failure::unavailable())?;
    let mut writes = vec![];
    for category in categories {
        let feature = match category.kind.as_str() {
            "awards" => Some("APNS_ENABLED"),
            _ => None,
        };
        if feature.is_some_and(|name| !env.var(name).is_ok_and(|v| v.to_string() == "true")) {
            continue;
        }
        let version = time / 300000;
        writes.push(statement(
            db,
            INSERT_CATEGORY_SQL,
            &[
                text(&uuid()?),
                text(&category.kind),
                number(version),
                number(time),
            ],
        )?);
    }
    if !writes.is_empty() {
        db.batch(writes).await.map_err(|_| Failure::unavailable())?;
    }
    let queue = env.queue("JOBS").map_err(|_| Failure::unavailable())?;
    let due=statement(db,"SELECT job_id,kind,attempts FROM jobs WHERE state='pending' AND due_ms<=?1 AND lease_until_ms<=?1 AND (published_at_ms IS NULL OR published_at_ms<=?1-300000) ORDER BY due_ms,job_id LIMIT 50",&[number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Job>().map_err(|_|Failure::unavailable())?;
    for job in due {
        queue
            .send(Message {
                job_id: Id::parse(&job.job_id).map_err(|_| Failure::unavailable())?,
            })
            .await
            .map_err(|_| Failure::unavailable())?;
        statement(
            db,
            "UPDATE jobs SET published_at_ms=?1 WHERE job_id=?2 AND state='pending'",
            &[number(time), text(&job.job_id)],
        )?
        .run()
        .await
        .map_err(|_| Failure::unavailable())?;
    }
    crate::monitoring_runtime::dispatch(db).await?;
    // Failed jobs remain visible for manual investigation; completed dispatch metadata has no user content.
    statement(
        db,
        "DELETE FROM jobs WHERE state='completed' AND due_ms<?1-2592000000",
        &[number(time)],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    Ok(())
}
async fn run(env: &Env, db: &D1Database, id: &Id) -> std::result::Result<(), Failure> {
    let time = now();
    let lease = time + 300000;
    let claimed=statement(db,"UPDATE jobs SET lease_until_ms=?1,attempts=attempts+1 WHERE job_id=?2 AND state='pending' AND lease_until_ms<=?3 AND due_ms<=?3 RETURNING job_id,kind,attempts",&[number(lease),text(id.as_str()),number(time)])?.first::<Job>(None).await.map_err(|_|Failure::unavailable())?;
    let Some(job) = claimed else {
        return Ok(());
    };
    let outcome = if job.attempts > 12 {
        Err(Failure::unavailable())
    } else {
        match job.kind.as_str() {
            "avatar_cleanup" => crate::avatar_runtime::cleanup_objects(env, db).await,
            "avatar_alerts" => Ok(()), // Finish any already-queued retired notification without sending it.
            "finalization" => crate::finalization_runtime::dispatch(db).await,
            "corrections" => crate::correction_runtime::dispatch(db).await,
            "awards" => crate::apns_runtime::dispatch(env, db).await,
            "deletion" => crate::deletion_runtime::process(env, db).await,
            "recovery_revocation" => crate::deletion_runtime::revoke_recovery_grants(env, db).await,
            "monitoring" => crate::monitoring_runtime::dispatch(db).await,
            "retention" => crate::auth_maintenance::cleanup(db, now())
                .await
                .map_err(|_| Failure::unavailable()),
            _ => Err(Failure::unavailable()),
        }
    };
    console_log!(
        "{}",
        serde_json::json!({"event":"background_job","job_id":job.job_id,"kind":job.kind,"worker_version":env.var("WORKER_VERSION").map(|v|v.to_string()).unwrap_or_else(|_|"unconfigured".into()),"attempt":job.attempts,"outcome":if outcome.is_ok(){"completed"}else{"execution_failed"},"duration_ms":now()-time})
    );
    let state = if outcome.is_ok() {
        "completed"
    } else if job.attempts >= 12 {
        "failed"
    } else {
        "pending"
    };
    let base = (30000_i64.saturating_mul(1_i64 << (job.attempts - 1).clamp(0, 11))).min(3600000);
    let jitter = u16::from_be_bytes(random::<2>()?) as i64 % (base / 5 + 1);
    let due = now() + (base + jitter).min(3600000);
    // Publish the failure identifier before committing failed state; a lost response may duplicate
    // the dead letter but never silently discards the record from the protected management queue.
    if state == "failed" {
        env.queue("JOBS_DEAD")
            .map_err(|_| Failure::unavailable())?
            .send(Message { job_id: id.clone() })
            .await
            .map_err(|_| Failure::unavailable())?;
        console_error!("background_job_dead_lettered");
    }
    statement(db,"UPDATE jobs SET state=?1,lease_until_ms=0,published_at_ms=NULL,due_ms=?2,last_error=?3 WHERE job_id=?4 AND state='pending' AND lease_until_ms=?5",&[text(state),number(due),if outcome.is_ok(){wasm_bindgen::JsValue::NULL}else{text("execution_failed")},text(id.as_str()),number(lease)])?.run().await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
#[event(queue)]
pub async fn queue(
    batch: MessageBatch<serde_json::Value>,
    env: Env,
    _context: Context,
) -> Result<()> {
    let db = env.d1("DB")?;
    for raw in batch.messages()? {
        let parsed = serde_json::from_value::<Message>(raw.body().clone());
        match parsed {
            Ok(message) => match run(&env, &db, &message.job_id).await {
                Ok(()) => raw.ack(),
                Err(_) => raw.retry(),
            },
            Err(_) => {
                console_error!("invalid_background_job_identifier");
                raw.ack();
            }
        }
    }
    Ok(())
}
