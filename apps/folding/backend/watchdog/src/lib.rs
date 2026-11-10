//! Scheduled-only availability watchdog. Never logs remote data or mail addresses.
use futures_util::{
    StreamExt,
    future::{Either, select},
};
use serde::Deserialize;
use std::time::Duration;
use wasm_bindgen::JsValue;
use worker::*;

const SENDER: &str = "alerts@getfolding.app";

#[derive(Deserialize)]
struct State {
    last_slot: i64,
    failures: i64,
    incident: Option<String>,
}
#[derive(Deserialize)]
struct Notice {
    id: String,
    incident: String,
    category: String,
    attempts: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Health {
    status: String,
    worker_version: String,
}

fn now() -> i64 {
    js_sys::Date::now() as i64
}
fn token() -> String {
    format!("{}-{}", now(), js_sys::Math::random())
}
fn enabled(env: &Env, key: &str) -> bool {
    env.var(key).is_ok_and(|v| v.to_string() == "true")
}
fn environment(env: &Env) -> Result<String> {
    let value = env.var("DEPLOYMENT")?.to_string();
    if value != "production" {
        return Err(Error::RustError("invalid configuration".into()));
    }
    Ok(value)
}

#[event(fetch)]
pub async fn fetch(_: Request, _: Env, _: Context) -> Result<Response> {
    Response::error("Not found", 404)
}

#[event(scheduled)]
pub async fn scheduled(event: ScheduledEvent, env: Env, _: ScheduleContext) {
    if !enabled(&env, "MONITOR_ENABLED") {
        return;
    }
    if run(event.schedule() as i64, &env).await.is_err() {
        console_error!("{{\"event\":\"watchdog_error\",\"code\":\"execution_failed\"}}");
    }
}

async fn run(scheduled_at: i64, env: &Env) -> Result<()> {
    let deployment = environment(env)?;
    let db = env.d1("MONITOR_DB")?;
    let slot = scheduled_at / 60_000;
    let timestamp = now();
    // Ignore ancient/future scheduler deliveries; missing slots are not observed failures.
    if scheduled_at > timestamp + 60_000 || scheduled_at < timestamp - 120_000 {
        return Ok(());
    }
    let lease = token();
    let state = db.prepare("UPDATE monitor SET lease=?1,lease_until=?2 WHERE singleton=1 AND last_slot<?3 AND lease_until<?4 RETURNING last_slot,failures,incident")
        .bind(&[lease.clone().into(), (timestamp+45_000).into(), slot.into(), timestamp.into()])?
        .first::<State>(None).await?;
    if let Some(state) = state {
        let success = probe(&deployment).await;
        let failures = if success {
            0
        } else if state.last_slot == slot - 1 {
            (state.failures + 1).min(5)
        } else {
            1
        };
        let mut incident = state.incident.clone();
        let mut notice = None;
        if success {
            if let Some(id) = incident.take() {
                notice = Some((id, "recovery"));
            }
        } else if failures == 5 && incident.is_none() {
            let id = format!("{deployment}-{slot}");
            incident = Some(id.clone());
            notice = Some((id, "down"));
        }
        let finished = now();
        let mut commands = vec![];
        if let Some((id, category)) = notice {
            commands.push(db.prepare("INSERT OR IGNORE INTO notifications(id,incident,category,created_at) SELECT ?1,?2,?3,?4 FROM monitor WHERE singleton=1 AND lease=?5 AND lease_until>?4")
                .bind(&[format!("{id}-{category}").into(), id.into(), category.into(), finished.into(), lease.clone().into()])?);
        }
        commands.push(db.prepare("UPDATE monitor SET last_slot=?1,failures=?2,incident=?3,lease=NULL,lease_until=0 WHERE singleton=1 AND lease=?4 AND lease_until>?5")
            .bind(&[slot.into(), failures.into(), incident.map(Into::into).unwrap_or(JsValue::NULL), lease.into(), finished.into()])?);
        db.batch(commands).await?;
        console_log!(
            "{{\"event\":\"watchdog_probe\",\"ok\":{},\"consecutive_failures\":{}}}",
            success,
            failures
        );
    }
    if enabled(env, "OUTBOUND_DELIVERY_VERIFIED") {
        for _ in 0..2 {
            if !deliver(&db, env, &deployment).await? {
                break;
            }
        }
    }
    // Bound cleanup work, retain unresolved and active incident evidence.
    db.prepare("DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE status IN ('delivered','dead') AND created_at<?1 AND incident IS NOT (SELECT incident FROM monitor WHERE singleton=1) LIMIT 50)")
        .bind(&[(now()-90*86_400_000i64).into()])?.run().await?;
    Ok(())
}

async fn probe(deployment: &str) -> bool {
    let operation = async {
        if deployment != "production" {
            return Err(Error::RustError("invalid deployment".into()));
        }
        let url = "https://api.getfolding.app/v1/health";
        let mut init = RequestInit::new();
        init.with_redirect(RequestRedirect::Error);
        let headers = Headers::new();
        headers.set("Cache-Control", "no-cache")?;
        init.with_headers(headers);
        let request = Request::new_with_init(&url, &init)?;
        let mut response = Fetch::Request(request).send().await?;
        if response.status_code() != 200 {
            return Ok::<bool, Error>(false);
        }
        let mut stream = response.stream()?;
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            if bytes.len() + chunk.len() > 2048 {
                return Ok(false);
            }
            bytes.extend_from_slice(&chunk);
        }
        let health: Health = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(_) => return Ok(false),
        };
        Ok(health.status == "ok"
            && health.worker_version.len() == 40
            && health.worker_version.bytes().all(|b| b.is_ascii_hexdigit()))
    };
    matches!(
        select(
            Box::pin(operation),
            Box::pin(Delay::from(Duration::from_secs(3)))
        )
        .await,
        Either::Left((Ok(true), _))
    )
}

async fn deliver(db: &D1Database, env: &Env, deployment: &str) -> Result<bool> {
    let timestamp = now();
    let lease = token();
    // Consume attempts durably before external I/O, including a crash after claiming.
    db.prepare("UPDATE notifications SET status='dead',lease=NULL,lease_until=0 WHERE status='pending' AND attempts>=12 AND lease_until<?1")
        .bind(&[timestamp.into()])?.run().await?;
    let notice = db.prepare("UPDATE notifications SET lease=?1,lease_until=?2,attempts=attempts+1 WHERE id=(SELECT n.id FROM notifications n WHERE n.status='pending' AND n.attempts<12 AND n.not_before<=?3 AND n.lease_until<?3 AND (n.category='down' OR EXISTS(SELECT 1 FROM notifications d WHERE d.incident=n.incident AND d.category='down' AND d.status IN ('delivered','dead'))) ORDER BY n.created_at,n.id LIMIT 1) RETURNING id,incident,category,attempts")
        .bind(&[lease.clone().into(), (timestamp+45_000).into(), timestamp.into()])?.first::<Notice>(None).await?;
    let Some(notice) = notice else {
        return Ok(false);
    };
    let owner = env.var("ALERT_DESTINATION")?.to_string();
    if owner.contains(['\r', '\n']) || !owner.contains('@') {
        return Err(Error::RustError("invalid alert address".into()));
    }
    let raw = format!(
        "From: Folding Operations <{SENDER}>\r\nTo: {owner}\r\nSubject: Folding {deployment}: {}\r\nMessage-ID: <{}@getfolding.app>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\nFolding {deployment} API {}.\r\nIncident: {}\r\n{}\r\n",
        notice.category,
        notice.id,
        if notice.category == "down" {
            "failed five consecutive minute checks"
        } else {
            "is responding again"
        },
        notice.incident,
        "This monitor checks API and database availability. Delivery may repeat after an ambiguous transport result."
    );
    let message = worker::email::EmailMessage::new(SENDER, &owner, &raw)?;
    let binding = env.send_email("ALERT_EMAIL")?;
    let sent = matches!(
        select(
            Box::pin(binding.send(&message)),
            Box::pin(Delay::from(Duration::from_secs(10)))
        )
        .await,
        Either::Left((Ok(_), _))
    );
    let status = if sent {
        "delivered"
    } else if notice.attempts >= 12 {
        "dead"
    } else {
        "pending"
    };
    let delay = (30_000i64 * (1i64 << (notice.attempts - 1))).min(3_600_000);
    let jitter = (js_sys::Math::random() * 5000.0) as i64;
    db.prepare("UPDATE notifications SET status=?1,not_before=?2,lease=NULL,lease_until=0 WHERE id=?3 AND lease=?4 AND lease_until>?5")
        .bind(&[status.into(), (now()+delay+jitter).into(), notice.id.into(), lease.into(), now().into()])?.run().await?;
    console_log!(
        "{{\"event\":\"watchdog_delivery\",\"outcome\":\"{}\",\"attempt\":{}}}",
        status,
        notice.attempts
    );
    Ok(true)
}
