//! Bounded retries for external cleanup work. Failure never changes the privacy fence or destroys credentials.
use crate::auth_runtime::{Failure, now, number, random, statement, text, uuid};
use serde::Deserialize;
use worker::*;
pub(crate) async fn ready(
    db: &D1Database,
    kind: &str,
    key: &str,
) -> std::result::Result<bool, Failure> {
    #[derive(Deserialize)]
    struct Count {
        count: i64,
    }
    Ok(statement(db,"SELECT count(*) AS count FROM external_retry_state WHERE kind=?1 AND ((work_key='' AND state='paused') OR (work_key=?2 AND (state='failed' OR next_attempt_ms>?3)))",&[text(kind),text(key),number(now())])?.first::<Count>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?.count==0)
}
pub(crate) async fn failed(
    db: &D1Database,
    kind: &str,
    key: &str,
) -> std::result::Result<(), Failure> {
    #[derive(Deserialize)]
    struct Attempt {
        attempts: i64,
    }
    let row=statement(db,"INSERT INTO external_retry_state VALUES (?1,?2,?3,'pending',1,0,?4,'external_failure') ON CONFLICT(kind,work_key) DO UPDATE SET attempts=attempts+1,updated_at_ms=excluded.updated_at_ms,last_error='external_failure' RETURNING attempts",&[text(&uuid()?),text(kind),text(key),number(now())])?.first::<Attempt>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    let base = (30000_i64.saturating_mul(1_i64 << (row.attempts - 1).clamp(0, 11))).min(3600000);
    let jitter = u16::from_be_bytes(random::<2>()?) as i64 % (base / 5 + 1);
    statement(db,"UPDATE external_retry_state SET state=?1,next_attempt_ms=?2 WHERE kind=?3 AND work_key=?4 AND attempts=?5",&[text(if row.attempts>=12{"failed"}else{"pending"}),number(now()+(base+jitter).min(3600000)),text(kind),text(key),number(row.attempts)])?.run().await.map_err(|_|Failure::unavailable())?;
    if row.attempts >= 12 {
        console_error!(
            "{}",
            serde_json::json!({"event":"external_job_requires_review","kind":kind})
        );
    }
    Ok(())
}
pub(crate) async fn clear(
    db: &D1Database,
    kind: &str,
    key: &str,
) -> std::result::Result<(), Failure> {
    statement(
        db,
        "DELETE FROM external_retry_state WHERE kind=?1 AND work_key=?2",
        &[text(kind), text(key)],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    Ok(())
}
pub(crate) async fn pause(db: &D1Database, kind: &str) -> std::result::Result<(), Failure> {
    statement(db,"INSERT INTO external_retry_state VALUES (?1,?2,'','paused',0,0,?3,'configuration_or_authorization') ON CONFLICT(kind,work_key) DO UPDATE SET state='paused',updated_at_ms=excluded.updated_at_ms,last_error=excluded.last_error",&[text(&uuid()?),text(kind),number(now())])?.run().await.map_err(|_|Failure::unavailable())?;
    console_error!(
        "{}",
        serde_json::json!({"event":"external_category_paused","kind":kind})
    );
    Ok(())
}

pub(crate) async fn terminal(
    db: &D1Database,
    kind: &str,
    key: &str,
) -> std::result::Result<(), Failure> {
    failed(db, kind, key).await?;
    statement(db,"UPDATE external_retry_state SET state='failed',last_error='request_rejected' WHERE kind=?1 AND work_key=?2",&[text(kind),text(key)])?.run().await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
