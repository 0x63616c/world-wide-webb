//! Bounded operational counts only. Never persist request bodies, identities, URLs or credentials.
use crate::auth_runtime::{Failure, now, number, statement, text};
use serde::Deserialize;
use worker::*;
#[derive(Deserialize)]
pub(crate) struct Alert {
    pub code: String,
    pub value: i64,
    pub updated_at_ms: i64,
}
pub(crate) async fn record(db: &D1Database, status: u16) -> std::result::Result<(), Failure> {
    let minute = (now() / 60000) * 60000;
    statement(db,"INSERT INTO ingestion_metrics VALUES (?1,1,?2) ON CONFLICT(minute_ms) DO UPDATE SET requests=requests+1,failures=failures+excluded.failures",&[number(minute),number(i64::from(status>=500))])?.run().await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
async fn alert(
    db: &D1Database,
    code: &str,
    active: bool,
    value: i64,
) -> std::result::Result<(), Failure> {
    statement(db,"INSERT INTO operational_alerts VALUES (?1,?2,?3,?4) ON CONFLICT(code) DO UPDATE SET active=excluded.active,value=excluded.value,updated_at_ms=excluded.updated_at_ms WHERE operational_alerts.active<>excluded.active OR operational_alerts.value<>excluded.value",&[text(code),number(i64::from(active)),number(value),number(now())])?.run().await.map_err(|_|Failure::unavailable())?;
    if active {
        console_error!(
            "{}",
            serde_json::json!({"event":"operational_alert","code":code,"count":value})
        );
    }
    Ok(())
}
pub(crate) async fn dispatch(db: &D1Database) -> std::result::Result<(), Failure> {
    #[derive(Deserialize)]
    struct Counts {
        requests: i64,
        failures: i64,
    }
    let time = now();
    let counts=statement(db,"SELECT COALESCE(sum(requests),0) AS requests,COALESCE(sum(failures),0) AS failures FROM ingestion_metrics WHERE minute_ms>=?1 AND minute_ms<=?2",&[number((time/60000)*60000-840000),number(time)])?.first::<Counts>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    alert(
        db,
        "ingestion_failures",
        counts.requests >= 100 && counts.failures * 100 > counts.requests * 5,
        counts.failures,
    )
    .await?;
    #[derive(Deserialize)]
    struct Count {
        count: i64,
    }
    let delayed=statement(db,"SELECT count(*) AS count FROM periods WHERE state IN('grace','finalizing') AND cutoff_ms<?1-1800000",&[number(time)])?.first::<Count>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    alert(db, "finalization_delayed", delayed.count > 0, delayed.count).await?;
    let failed=statement(db,"SELECT (SELECT count(*) FROM jobs WHERE state='failed')+(SELECT count(*) FROM award_jobs WHERE state='failed')+(SELECT count(*) FROM external_retry_state WHERE state IN('failed','paused')) AS count",&[])?.first::<Count>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    // The protected alert stays visible until the failed backlog is resolved; external queue
    // growth monitoring remains independent so a complete Worker outage is still observable.
    alert(db, "failed_jobs", failed.count > 0, failed.count).await?;
    statement(
        db,
        "DELETE FROM ingestion_metrics WHERE minute_ms<?1-86400000",
        &[number(time)],
    )?
    .run()
    .await
    .map_err(|_| Failure::unavailable())?;
    Ok(())
}
pub(crate) async fn alerts(db: &D1Database) -> std::result::Result<Vec<Alert>, Failure> {
    statement(
        db,
        "SELECT code,value,updated_at_ms FROM operational_alerts WHERE active=1 ORDER BY code",
        &[],
    )?
    .all()
    .await
    .map_err(|_| Failure::unavailable())?
    .results()
    .map_err(|_| Failure::unavailable())
}
pub(crate) fn route(path: &str) -> &'static str {
    match path {
        "/v1/entry-deletions" => "entries.delete",
        "/v1/event-batches" => "events.submit",
        "/v1/capabilities" => "capabilities",
        "/v1/health" => "health",
        "/v1/me" => "account.read",
        "/v1/auth/challenges" => "auth.challenge",
        "/v1/auth/apple" => "auth.apple",
        "/v1/auth/refresh" => "auth.refresh",
        "/v1/auth/logout" => "auth.logout",
        "/v1/attestation/challenges" => "attestation.challenge",
        "/v1/attestation/keys" => "attestation.key",
        "/v1/enrollment/join" => "enrollment.join",
        "/v1/enrollment/transfer" => "enrollment.transfer",
        "/v1/enrollment/leave" => "enrollment.leave",
        "/v1/resets" => "history.reset",
        p if p.starts_with("/v1/avatars/") => "avatars",
        p if p.starts_with("/v1/results") => "results",
        p if p.starts_with("/v1/leaderboard") => "leaderboard",
        p if p.starts_with("/v1/account/") => "account",
        p if p.starts_with("/v1/operations/") => "operations",
        p if p.starts_with("/v1/event-batches/") => "events.receipt",
        "/v1/profile" => "profile",
        "/v1/reports" => "reports",
        p if p.starts_with("/v1/blocks") => "blocks",
        "/v1/preferences" => "preferences",
        p if p.starts_with("/v1/push-installations/") => "push.installation",
        "/admin" => "admin",
        p if p.starts_with("/admin/") => "admin",
        _ => "unknown",
    }
}
/// A bounded public readiness probe, deliberately independent of feature acceptance claims.
pub(crate) async fn health(env: &Env) -> Result<Response> {
    let readiness = async {
        let version = env.var("WORKER_VERSION").ok()?.to_string();
        if version.is_empty() || version.len() > 128 || version.chars().any(char::is_control) {
            return None;
        }
        let db = env.d1("DB").ok()?;
        let query =
            db.prepare("SELECT revision FROM administrative_configuration WHERE singleton=1");
        let result = futures_util::future::select(
            Box::pin(query.first::<serde_json::Value>(None)),
            Box::pin(Delay::from(std::time::Duration::from_secs(2))),
        )
        .await;
        match result {
            futures_util::future::Either::Left((Ok(Some(_)), _)) => Some(version),
            _ => None,
        }
    }
    .await;
    let mut response = if let Some(version) = readiness {
        Response::from_json(&serde_json::json!({"status":"ok","worker_version":version}))?
    } else {
        Response::from_json(&serde_json::json!({"status":"unavailable"}))?.with_status(503)
    };
    response.headers_mut().set("Cache-Control", "no-store")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    Ok(response)
}
