//! Durable award delivery. D1 owns eligibility and retry state; APNs is an external best-effort hop.
use crate::auth_runtime::{Configuration, Failure, blob, now, number, random, statement, text};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use futures_util::StreamExt;
use serde::Deserialize;
use worker::*;

#[derive(Deserialize)]
struct Provider {
    issued_at_ms: i64,
    expires_at_ms: i64,
    ciphertext: Vec<u8>,
    key_version: String,
}
async fn provider(
    env: &Env,
    db: &D1Database,
    config: &Configuration,
    environment: &str,
    topic: &str,
) -> std::result::Result<String, Failure> {
    let key_id = env
        .var("APNS_KEY_ID")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let team = env
        .var("APNS_TEAM_ID")
        .map_err(|_| Failure::unavailable())?
        .to_string();
    let cache_key = format!("{team}/{key_id}/{environment}/{topic}");
    let context = format!("Folding-v1/{}/apns-provider/{cache_key}", config.deployment);
    let time = now();
    let old=statement(db,"SELECT issued_at_ms,expires_at_ms,ciphertext,key_version FROM apns_provider_tokens WHERE cache_key=?1",&[text(&cache_key)])?.first::<Provider>(None).await.map_err(|_|Failure::unavailable())?;
    if let Some(old) = old
        && old.issued_at_ms <= time
        && old.expires_at_ms > time
    {
        return String::from_utf8(
            config
                .keys
                .open(&old.key_version, &context, &old.ciphertext)
                .map_err(|_| Failure::unavailable())?,
        )
        .map_err(|_| Failure::unavailable());
    }
    let key = URL_SAFE_NO_PAD
        .decode(
            env.secret("APNS_PRIVATE_KEY_PKCS8")
                .map_err(|_| Failure::unavailable())?
                .to_string(),
        )
        .map_err(|_| Failure::unavailable())?;
    let token = crate::apns::provider_token(&key, &key_id, &team, time / 1000)
        .ok_or_else(Failure::unavailable)?;
    let ciphertext = config
        .keys
        .seal(random::<12>()?, &context, token.as_bytes())
        .map_err(|_| Failure::unavailable())?;
    statement(db,"INSERT INTO apns_provider_tokens VALUES (?1,?2,?3,?4,?5) ON CONFLICT(cache_key) DO UPDATE SET issued_at_ms=excluded.issued_at_ms,expires_at_ms=excluded.expires_at_ms,ciphertext=excluded.ciphertext,key_version=excluded.key_version WHERE apns_provider_tokens.expires_at_ms<=?2 OR apns_provider_tokens.issued_at_ms>?2",&[text(&cache_key),number(time),number(time+3000000),blob(&ciphertext),text(config.keys.version())])?.run().await.map_err(|_|Failure::unavailable())?;
    // Concurrent workers reuse the winning token instead of rotating the provider identity per request.
    let winner=statement(db,"SELECT issued_at_ms,expires_at_ms,ciphertext,key_version FROM apns_provider_tokens WHERE cache_key=?1",&[text(&cache_key)])?.first::<Provider>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
    String::from_utf8(
        config
            .keys
            .open(&winner.key_version, &context, &winner.ciphertext)
            .map_err(|_| Failure::unavailable())?,
    )
    .map_err(|_| Failure::unavailable())
}
#[derive(Deserialize)]
struct Job {
    participant_id: String,
    period_id: String,
    attempts: i64,
}
#[derive(Deserialize)]
struct Target {
    kind: String,
    finalized_at_ms: i64,
    rank: i64,
    medal: Option<String>,
    weekly: String,
    monthly: String,
    home_timezone: String,
    locale: String,
    device_id: String,
    token_ciphertext: Vec<u8>,
    key_version: String,
    token_hash: Vec<u8>,
    registered_at_ms: i64,
}
const TARGET: &str = "SELECT d.kind,d.finalized_at_ms,r.rank,r.medal,n.weekly,n.monthly,n.home_timezone,n.locale,i.device_id,i.token_ciphertext,i.key_version,i.token_hash,i.registered_at_ms FROM award_jobs j JOIN participants p ON p.participant_id=j.participant_id JOIN epochs e ON e.epoch_id=p.epoch_id JOIN periods d ON d.period_id=j.period_id JOIN results r ON r.period_id=d.period_id AND r.version=d.published_version AND r.participant_id=p.participant_id JOIN notification_preferences n ON n.participant_id=p.participant_id JOIN push_installations i ON i.participant_id=p.participant_id AND i.device_id=p.active_device_id JOIN sessions s ON s.session_id=i.session_id WHERE j.participant_id=?1 AND j.period_id=?2 AND j.state='pending' AND p.account_state='active' AND p.membership='joined' AND p.restriction='none' AND p.generation_revision=j.generation_revision AND p.generation_id=j.generation_id AND e.joined_at_ms=j.joined_at_ms AND r.generation_revision=j.generation_revision AND r.generation_id=j.generation_id AND r.joined_at_ms=j.joined_at_ms AND d.state='finalized' AND i.enabled=1 AND i.deployment=?3 AND i.environment=?4 AND i.topic=?5 AND s.revoked=0 AND s.absolute_expires_at_ms>?6 AND s.idle_expires_at_ms>?6";
async fn target(
    db: &D1Database,
    config: &Configuration,
    job: &Job,
    environment: &str,
    topic: &str,
) -> std::result::Result<Option<Target>, Failure> {
    statement(
        db,
        TARGET,
        &[
            text(&job.participant_id),
            text(&job.period_id),
            text(&config.deployment),
            text(environment),
            text(topic),
            number(now()),
        ],
    )?
    .first(None)
    .await
    .map_err(|_| Failure::unavailable())
}
#[derive(Deserialize, Default)]
struct AppleError {
    reason: Option<String>,
    timestamp: Option<i64>,
}
struct Outcome {
    status: u16,
    error: AppleError,
}
async fn deliver(
    token: &str,
    provider: &str,
    environment: &str,
    topic: &str,
    job: &Job,
    target: &Target,
) -> std::result::Result<Outcome, Failure> {
    if token.is_empty() || token.len() > 1024 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Failure::unavailable());
    }
    let host = if environment == "production" {
        "api.push.apple.com"
    } else {
        "api.sandbox.push.apple.com"
    };
    let (id, collapse) = crate::apns::identifiers(&job.participant_id, &job.period_id);
    let headers = Headers::new();
    for (name, value) in [
        ("authorization", format!("bearer {provider}")),
        ("apns-topic", topic.into()),
        ("apns-push-type", "alert".into()),
        ("apns-priority", "10".into()),
        ("apns-id", id),
        ("apns-collapse-id", collapse),
        ("apns-expiration", ((now() / 1000) + 86400).to_string()),
        ("content-type", "application/json".into()),
    ] {
        headers
            .set(name, &value)
            .map_err(|_| Failure::unavailable())?;
    }
    let payload = crate::apns::payload(
        &target.locale,
        &target.kind,
        &job.period_id,
        target.rank,
        target.medal.as_deref(),
    )
    .to_string();
    let mut init = RequestInit::new();
    init.with_method(Method::Post)
        .with_redirect(RequestRedirect::Manual)
        .with_headers(headers)
        .with_body(Some(wasm_bindgen::JsValue::from_str(&payload)));
    let request = Request::new_with_init(&format!("https://{host}/3/device/{token}"), &init)
        .map_err(|_| Failure::unavailable())?;
    let signal = AbortSignal::from(web_sys::AbortSignal::timeout_with_u32(10000));
    let mut response = Fetch::Request(request)
        .send_with_signal(&signal)
        .await
        .map_err(|_| Failure::unavailable())?;
    let status = response.status_code();
    if status == 200 {
        return Ok(Outcome {
            status,
            error: AppleError::default(),
        });
    }
    let mut bytes = vec![];
    if let Ok(mut stream) = response.stream() {
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| Failure::unavailable())?;
            if bytes.len() + chunk.len() > 4096 {
                return Err(Failure::unavailable());
            }
            bytes.extend(chunk);
        }
    }
    Ok(Outcome {
        status,
        error: serde_json::from_slice(&bytes).unwrap_or_default(),
    })
}
pub(crate) async fn dispatch(env: &Env, db: &D1Database) -> std::result::Result<(), Failure> {
    if !env
        .var("APNS_ENABLED")
        .is_ok_and(|v| v.to_string() == "true")
    {
        return Ok(());
    }
    if crate::operational_runtime::controls(db)
        .await?
        .result_notifications_enabled
        == 0
    {
        return Ok(());
    }
    let config = Configuration::load(env)?;
    let (topic, environment, _) = match crate::notification_runtime::push_configuration(env) {
        Ok(configuration) => configuration,
        Err(error) => {
            crate::operational_runtime::pause_notifications(db, "APNs configuration unavailable")
                .await?;
            return Err(error);
        }
    };
    let jobs=statement(db,"SELECT participant_id,period_id,attempts FROM award_jobs WHERE state='pending' AND lease_until_ms<=?1 AND next_attempt_ms<=?1 AND (due_ms IS NULL OR due_ms<=?1) ORDER BY COALESCE(due_ms,0),period_id,participant_id LIMIT 10",&[number(now())])?.all().await.map_err(|_|Failure::unavailable())?.results::<Job>().map_err(|_|Failure::unavailable())?;
    for job in jobs {
        if crate::operational_runtime::controls(db)
            .await?
            .result_notifications_enabled
            == 0
        {
            break;
        }
        #[derive(Deserialize)]
        struct Schedule {
            finalized_at_ms: i64,
            home_timezone: String,
        }
        let schedule=statement(db,"SELECT d.finalized_at_ms,COALESCE(n.home_timezone,'UTC') AS home_timezone FROM periods d LEFT JOIN notification_preferences n ON n.participant_id=?1 WHERE d.period_id=?2 AND d.state='finalized'",&[text(&job.participant_id),text(&job.period_id)])?.first::<Schedule>(None).await.map_err(|_|Failure::unavailable())?.ok_or_else(Failure::unavailable)?;
        let due = crate::apns::next_morning(schedule.finalized_at_ms, &schedule.home_timezone)
            .ok_or_else(Failure::unavailable)?;
        statement(db,"UPDATE award_jobs SET due_ms=?1 WHERE participant_id=?2 AND period_id=?3 AND state='pending'",&[number(due),text(&job.participant_id),text(&job.period_id)])?.run().await.map_err(|_|Failure::unavailable())?;
        let time = now();
        if due > time {
            continue;
        }
        let lease = time + 120000;
        let claimed=statement(db,"UPDATE award_jobs SET lease_until_ms=?1,attempts=attempts+1 WHERE participant_id=?2 AND period_id=?3 AND state='pending' AND lease_until_ms<=?4 AND attempts=?5 RETURNING attempts",&[number(lease),text(&job.participant_id),text(&job.period_id),number(time),number(job.attempts)])?.first::<serde_json::Value>(None).await.map_err(|_|Failure::unavailable())?;
        if claimed.is_none() {
            continue;
        }
        // Re-read all current consent, membership, generation and installation state after claiming.
        let Some(destination) = target(db, &config, &job, &environment, &topic).await? else {
            suppress(db, &job).await?;
            continue;
        };
        let preference = if destination.kind == "month" {
            &destination.monthly
        } else {
            &destination.weekly
        };
        if preference == "off" || (preference == "podium" && destination.medal.is_none()) {
            suppress(db, &job).await?;
            continue;
        }
        if crate::apns::next_morning(destination.finalized_at_ms, &destination.home_timezone)
            .is_none_or(|v| v > now())
        {
            statement(db,"UPDATE award_jobs SET due_ms=NULL,lease_until_ms=0 WHERE participant_id=?1 AND period_id=?2 AND state='pending' AND lease_until_ms=?3",&[text(&job.participant_id),text(&job.period_id),number(lease)])?.run().await.map_err(|_|Failure::unavailable())?;
            continue;
        }
        let result = async {
            let context = crate::notification_runtime::token_context(
                &config,
                &job.participant_id,
                &destination.device_id,
                &topic,
                &environment,
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
            let jwt = match provider(env, db, &config, &environment, &topic).await {
                Ok(jwt) => jwt,
                Err(error) => {
                    crate::operational_runtime::pause_notifications(
                        db,
                        "Provider configuration unavailable",
                    )
                    .await?;
                    return Err(error);
                }
            };
            let fresh = target(db, &config, &job, &environment, &topic)
                .await?
                .ok_or_else(Failure::unavailable)?;
            if fresh.token_hash != destination.token_hash
                || fresh.registered_at_ms != destination.registered_at_ms
                || fresh.weekly != destination.weekly
                || fresh.monthly != destination.monthly
                || fresh.home_timezone != destination.home_timezone
                || fresh.locale != destination.locale
                || fresh.rank != destination.rank
                || fresh.medal != destination.medal
            {
                return Err(Failure::unavailable());
            }
            crate::operational_runtime::require(db, "notifications").await?;
            deliver(&token, &jwt, &environment, &topic, &job, &destination).await
        }
        .await;
        let mut state = "pending";
        let mut error = "transport";
        if let Ok(outcome) = &result {
            error = "provider_rejected";
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
                if outcome.status != 410
                    || outcome
                        .error
                        .timestamp
                        .is_some_and(|t| t >= destination.registered_at_ms)
                {
                    statement(db,"UPDATE push_installations SET enabled=0 WHERE participant_id=?1 AND device_id=?2 AND token_hash=?3 AND registered_at_ms=?4",&[text(&job.participant_id),text(&destination.device_id),blob(&destination.token_hash),number(destination.registered_at_ms)])?.run().await.map_err(|_|Failure::unavailable())?;
                }
            } else if outcome.status == 403 {
                crate::operational_runtime::pause_notifications(
                    db,
                    "APNs rejected provider authorization",
                )
                .await?;
                error = "provider_authorization";
            } else if outcome.status != 429 && outcome.status < 500 {
                state = "failed";
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
        let base = (30000_i64.saturating_mul(1_i64 << job.attempts.min(11))).min(3600000);
        let jitter = u16::from_be_bytes(random::<2>()?) as i64 % (base / 5 + 1);
        let next = time + (base + jitter).min(3600000);
        statement(db,"UPDATE award_jobs SET state=?1,lease_until_ms=0,next_attempt_ms=?2,last_error=?3,attempts=attempts-?8,sent_at_ms=CASE WHEN ?1='sent' THEN ?4 ELSE NULL END WHERE participant_id=?5 AND period_id=?6 AND state='pending' AND lease_until_ms=?7",&[text(state),number(next),text(error),number(now()),text(&job.participant_id),text(&job.period_id),number(lease),number(if paused{1}else{0})])?.run().await.map_err(|_|Failure::unavailable())?;
    }
    Ok(())
}
async fn suppress(db: &D1Database, job: &Job) -> std::result::Result<(), Failure> {
    statement(db,"UPDATE award_jobs SET state='suppressed',lease_until_ms=0 WHERE participant_id=?1 AND period_id=?2 AND state='pending'",&[text(&job.participant_id),text(&job.period_id)])?.run().await.map_err(|_|Failure::unavailable())?;
    Ok(())
}
