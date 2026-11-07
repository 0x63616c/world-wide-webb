//! The protected avatar queue is always available. Outbound mail is an explicitly verified opt-in.
use crate::auth_runtime::{Failure, now, number, statement, text};
use serde::Deserialize;
use worker::*;
#[derive(Deserialize)]
struct Alert {
    avatar_id: String,
}
pub(crate) async fn dispatch(env: &Env, db: &D1Database) -> Result<(), Failure> {
    if !env
        .var("ADMIN_EMAIL_ENABLED")
        .is_ok_and(|v| v.to_string() == "true")
    {
        return Ok(());
    }
    if !crate::retry_runtime::ready(db, "avatar_alerts", "").await? {
        return Ok(());
    }
    let configuration = (|| -> Result<_, Failure> {
        let from = env
            .var("ADMIN_ALERT_FROM")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let to = env
            .var("ADMIN_ALERT_TO")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let origin = env
            .var("ADMIN_ORIGIN")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        if [&from, &to].iter().any(|s| {
            s.len() > 254
                || !s.contains('@')
                || s.chars().any(|c| c.is_whitespace() || c == '<' || c == '>')
        }) {
            return Err(Failure::unavailable());
        }
        let url = Url::parse(&origin).map_err(|_| Failure::unavailable())?;
        if url.scheme() != "https" || url.origin().ascii_serialization() != origin {
            return Err(Failure::unavailable());
        }
        let binding = env
            .send_email("ADMIN_EMAIL")
            .map_err(|_| Failure::unavailable())?;
        Ok((from, to, origin, binding))
    })();
    let (from, to, origin, binding) = match configuration {
        Ok(c) => c,
        Err(error) => {
            crate::retry_runtime::pause(db, "avatar_alerts").await?;
            return Err(error);
        }
    };
    let time = now();
    let jobs=statement(db,"SELECT j.avatar_id,j.attempts FROM avatar_alerts j JOIN avatar_objects a ON a.avatar_id=j.avatar_id WHERE j.state='pending' AND j.lease_until_ms<=?1 AND a.state='pending' AND NOT EXISTS(SELECT 1 FROM external_retry_state r WHERE r.kind='avatar_alerts' AND r.work_key=j.avatar_id AND (r.state='failed' OR r.next_attempt_ms>?1)) ORDER BY a.created_at_ms LIMIT 10",&[number(time)])?.all().await.map_err(|_|Failure::unavailable())?.results::<Alert>().map_err(|_|Failure::unavailable())?;
    for job in jobs {
        if !crate::retry_runtime::ready(db, "avatar_alerts", &job.avatar_id).await? {
            continue;
        }
        let lease = time + 120000;
        let claimed=statement(db,"UPDATE avatar_alerts SET lease_until_ms=?1,attempts=attempts+1 WHERE avatar_id=?2 AND state='pending' AND lease_until_ms<=?3 RETURNING avatar_id,attempts",&[number(lease),text(&job.avatar_id),number(time)])?.first::<Alert>(None).await.map_err(|_|Failure::unavailable())?;
        let Some(_claimed) = claimed else { continue };
        let domain = from
            .split('@')
            .next_back()
            .ok_or_else(Failure::unavailable)?;
        let raw = format!(
            "From: {from}\r\nTo: {to}\r\nSubject: Folding avatar awaiting review\r\nMessage-ID: <avatar-{}@{domain}>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nAvatar {} is awaiting review.\r\n{origin}/admin/queue?kind=avatars\r\n",
            job.avatar_id, job.avatar_id
        );
        let email =
            worker::EmailMessage::new(&from, &to, &raw).map_err(|_| Failure::unavailable())?;
        let state = if binding.send(&email).await.is_ok() {
            crate::retry_runtime::clear(db, "avatar_alerts", &job.avatar_id).await?;
            "sent"
        } else {
            crate::retry_runtime::failed(db, "avatar_alerts", &job.avatar_id).await?;
            "pending"
        };
        statement(db,"UPDATE avatar_alerts SET state=?1 WHERE avatar_id=?2 AND lease_until_ms=?3 AND state='pending'",&[text(state),text(&job.avatar_id),number(lease)])?.run().await.map_err(|_|Failure::unavailable())?;
    }
    Ok(())
}
