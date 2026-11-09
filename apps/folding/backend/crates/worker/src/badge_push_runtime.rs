//! Private, opt-in badge delivery. One persisted delivery groups up to six catalog awards.
use crate::auth_runtime::{Configuration, Failure, blob, now, number, statement, text, uuid};
use serde::Deserialize;
use worker::*;

#[derive(Deserialize)]
struct Job {
    participant_id: String,
    generation_revision: i64,
    generation_id: String,
    delivery_id: String,
    attempts: i64,
}
#[derive(Deserialize)]
struct Badge {
    badge_id: String,
}
#[derive(Deserialize, PartialEq)]
struct Target {
    device_id: String,
    token_ciphertext: Vec<u8>,
    key_version: String,
    token_hash: Vec<u8>,
    registered_at_ms: i64,
    locale: String,
}

const OWNER: &str = "SELECT count(*) AS count FROM participants p JOIN badge_notification_preferences n ON n.participant_id=p.participant_id AND n.enabled=1 JOIN milestone_state m ON m.participant_id=p.participant_id AND m.state='ready' WHERE p.participant_id=?1 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=?2 AND p.generation_id=?3 AND m.generation_revision=p.generation_revision AND m.generation_id=p.generation_id";
async fn enabled(db: &D1Database, job: &Job) -> Result<bool, Failure> {
    #[derive(Deserialize)]
    struct Count {
        count: i64,
    }
    Ok(statement(
        db,
        OWNER,
        &[
            text(&job.participant_id),
            number(job.generation_revision),
            text(&job.generation_id),
        ],
    )?
    .first::<Count>(None)
    .await
    .map_err(|_| Failure::unavailable())?
    .is_some_and(|r| r.count == 1))
}
async fn badges(
    db: &D1Database,
    job: &Job,
    delivery: &str,
    lease: i64,
) -> Result<Vec<String>, Failure> {
    Ok(statement(db,"SELECT j.badge_id FROM badge_notification_jobs j JOIN milestone_grants g ON g.participant_id=j.participant_id AND g.badge_id=j.badge_id WHERE j.participant_id=?1 AND j.generation_revision=?2 AND j.generation_id=?3 AND j.delivery_id=?4 AND j.lease_until_ms=?5 AND j.state='pending' AND NOT EXISTS(SELECT 1 FROM milestone_acknowledgments a WHERE a.participant_id=j.participant_id AND a.badge_id=j.badge_id) ORDER BY j.badge_id",&[text(&job.participant_id),number(job.generation_revision),text(&job.generation_id),text(delivery),number(lease)])?
        .all().await.map_err(|_|Failure::unavailable())?.results::<Badge>().map_err(|_|Failure::unavailable())?
        .into_iter().map(|b|b.badge_id).collect())
}
async fn target(
    db: &D1Database,
    config: &Configuration,
    job: &Job,
    topic: &str,
    environment: &str,
) -> Result<Option<Target>, Failure> {
    statement(db,"SELECT i.device_id,i.token_ciphertext,i.key_version,i.token_hash,i.registered_at_ms,n.locale FROM participants p JOIN epochs e ON e.epoch_id=p.epoch_id AND e.closed_at_ms IS NULL AND e.participant_id=p.participant_id AND e.device_id=p.active_device_id AND e.generation_revision=p.generation_revision AND e.generation_id=p.generation_id JOIN notification_preferences n ON n.participant_id=p.participant_id JOIN badge_notification_preferences b ON b.participant_id=p.participant_id AND b.enabled=1 JOIN push_installations i ON i.participant_id=p.participant_id AND i.device_id=p.active_device_id JOIN sessions s ON s.session_id=i.session_id AND s.participant_id=p.participant_id AND s.device_id=i.device_id WHERE p.participant_id=?1 AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=?2 AND p.generation_id=?3 AND i.enabled=1 AND i.token_hash IS NOT NULL AND i.deployment=?4 AND i.topic=?5 AND i.environment=?6 AND s.revoked=0 AND s.absolute_expires_at_ms>?7 AND s.idle_expires_at_ms>?7",&[text(&job.participant_id),number(job.generation_revision),text(&job.generation_id),text(&config.deployment),text(topic),text(environment),number(now())])?
        .first(None).await.map_err(|_|Failure::unavailable())
}
async fn finish(
    db: &D1Database,
    job: &Job,
    delivery: &str,
    lease: i64,
    state: &str,
    error: &str,
    next: i64,
    paused: bool,
) -> Result<(), Failure> {
    statement(db,"UPDATE badge_notification_jobs SET state=?1,lease_until_ms=0,next_attempt_ms=?2,last_error=?3,attempts=attempts-?9,sent_at_ms=CASE WHEN ?1='sent' THEN ?4 ELSE NULL END WHERE participant_id=?5 AND generation_revision=?6 AND generation_id=?7 AND delivery_id=?8 AND lease_until_ms=?10 AND state='pending'",&[text(state),number(next),text(error),number(now()),text(&job.participant_id),number(job.generation_revision),text(&job.generation_id),text(delivery),number(i64::from(paused)),number(lease)])?.run().await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
pub(crate) async fn dispatch(
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    topic: &str,
    environment: &str,
) -> Result<(), Failure> {
    let jobs=statement(db,"SELECT participant_id,generation_revision,generation_id,COALESCE(delivery_id,'') AS delivery_id,MIN(attempts) AS attempts FROM badge_notification_jobs WHERE state='pending' AND lease_until_ms<=?1 AND next_attempt_ms<=?1 GROUP BY participant_id,generation_revision,generation_id,delivery_id ORDER BY MIN(created_at_ms),participant_id LIMIT 10",&[number(now())])?.all().await.map_err(|_|Failure::unavailable())?.results::<Job>().map_err(|_|Failure::unavailable())?;
    for job in jobs {
        if crate::operational_runtime::controls(db)
            .await?
            .result_notifications_enabled
            == 0
        {
            break;
        }
        let time = now();
        let lease = time + 120000;
        let delivery = if job.delivery_id.is_empty() {
            uuid()?
        } else {
            job.delivery_id.clone()
        };
        let claimed=statement(db,"UPDATE badge_notification_jobs SET delivery_id=?1,lease_until_ms=?2,attempts=attempts+1 WHERE participant_id=?3 AND generation_revision=?4 AND generation_id=?5 AND COALESCE(delivery_id,'')=?6 AND state='pending' AND attempts=?7 AND lease_until_ms<=?8 AND next_attempt_ms<=?8 RETURNING badge_id",&[text(&delivery),number(lease),text(&job.participant_id),number(job.generation_revision),text(&job.generation_id),text(&job.delivery_id),number(job.attempts),number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Badge>().map_err(|_|Failure::unavailable())?;
        if claimed.is_empty() {
            continue;
        }
        let ids = badges(db, &job, &delivery, lease).await?;
        if !enabled(db, &job).await? || ids.is_empty() {
            finish(db, &job, &delivery, lease, "suppressed", "", 0, false).await?;
            continue;
        }
        let destination = target(db, config, &job, topic, environment).await?;
        let result = async {
            let destination = destination.as_ref().ok_or_else(Failure::unavailable)?;
            let context = crate::notification_runtime::token_context(
                config,
                &job.participant_id,
                &destination.device_id,
                topic,
                environment,
            );
            let token = String::from_utf8(
                config
                    .keys
                    .open(
                        &destination.key_version,
                        &context,
                        &destination.token_ciphertext,
                    )
                    .map_err(|_| Failure::unavailable())?,
            )
            .map_err(|_| Failure::unavailable())?;
            let provider =
                match crate::apns_runtime::provider(env, db, config, environment, topic).await {
                    Ok(value) => value,
                    Err(error) => {
                        crate::operational_runtime::pause_notifications(
                            db,
                            "Badge provider configuration unavailable",
                        )
                        .await?;
                        return Err(error);
                    }
                };
            // Recheck consent, owner generation, revocation, acknowledgment and the exact token after all awaits.
            if !enabled(db, &job).await?
                || target(db, config, &job, topic, environment).await?.as_ref() != Some(destination)
                || badges(db, &job, &delivery, lease).await? != ids
            {
                return Err(Failure::unavailable());
            }
            crate::operational_runtime::require(db, "notifications").await?;
            crate::apns_runtime::send_payload(
                &token,
                &provider,
                environment,
                topic,
                &job.participant_id,
                &format!("badge:{delivery}"),
                crate::apns::badge_payload(&destination.locale, &job.participant_id, &ids),
            )
            .await
        }
        .await;
        let mut state = "pending";
        let mut error = "transport";
        if let Ok(outcome) = &result {
            if outcome.status == 200 {
                state = "sent";
                error = "";
            } else if outcome.status == 410
                || (outcome.status == 400
                    && matches!(
                        outcome.error.reason.as_deref(),
                        Some("BadDeviceToken" | "DeviceTokenNotForTopic")
                    ))
            {
                state = "failed";
                error = "invalid_token";
                if let Some(destination) = &destination {
                    if outcome.status != 410
                        || outcome
                            .error
                            .timestamp
                            .is_some_and(|t| t >= destination.registered_at_ms)
                    {
                        statement(db,"UPDATE push_installations SET enabled=0 WHERE participant_id=?1 AND device_id=?2 AND token_hash=?3 AND registered_at_ms=?4",&[text(&job.participant_id),text(&destination.device_id),blob(&destination.token_hash),number(destination.registered_at_ms)])?.run().await.map_err(|_|Failure::unavailable())?;
                    }
                }
            } else if outcome.status == 403 {
                crate::operational_runtime::pause_notifications(
                    db,
                    "APNs rejected badge provider authorization",
                )
                .await?;
                error = "provider_authorization";
            } else if outcome.status != 429 && outcome.status < 500 {
                state = "failed";
                error = "provider_rejected";
            }
        }
        let paused = state != "sent"
            && crate::operational_runtime::controls(db)
                .await?
                .result_notifications_enabled
                == 0;
        if paused {
            state = "pending";
        }
        if state == "pending" && job.attempts >= 11 && !paused {
            state = "failed";
        }
        let retry = (30000_i64.saturating_mul(1_i64 << job.attempts.min(11))).min(3600000);
        finish(
            db,
            &job,
            &delivery,
            lease,
            state,
            error,
            time + retry,
            paused,
        )
        .await?;
    }
    Ok(())
}
