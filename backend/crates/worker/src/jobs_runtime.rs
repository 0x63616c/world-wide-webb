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
const KINDS: &[&str] = &[
    "avatar_cleanup",
    "avatar_alerts",
    "finalization",
    "awards",
    "deletion",
    "recovery_revocation",
    "retention",
];
pub(crate) async fn schedule(env: &Env, db: &D1Database) -> std::result::Result<(), Failure> {
    let time = now();
    let slot = time / 300000;
    // The unique category/slot makes repeated Cron delivery harmless. Domain tables retain
    // individual jobs and receipts, so a lost dispatch cannot lose an accepted business mutation.
    let mut writes = vec![];
    for kind in KINDS {
        writes.push(statement(db,"INSERT INTO jobs(job_id,kind,logical_key,version,due_ms,state) VALUES (?1,?2,?2,?3,?4,'pending') ON CONFLICT(kind,logical_key,version) DO NOTHING",&[text(&uuid()?),text(kind),number(slot),number(time)])?);
    }
    db.batch(writes).await.map_err(|_| Failure::unavailable())?;
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
            "avatar_alerts" => crate::avatar_alerts::dispatch(env, db).await,
            "finalization" => crate::finalization_runtime::dispatch(db).await,
            "awards" => crate::apns_runtime::dispatch(env, db).await,
            "deletion" => crate::deletion_runtime::process(env, db).await,
            "recovery_revocation" => crate::deletion_runtime::revoke_recovery_grants(env, db).await,
            "retention" => crate::auth_maintenance::cleanup(db, now())
                .await
                .map_err(|_| Failure::unavailable()),
            _ => Err(Failure::unavailable()),
        }
    };
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
