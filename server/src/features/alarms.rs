//! Durable alarm occurrences; calendar arithmetic always uses the alarm's zone.
use crate::{
    AppState,
    http::{ApiError, Result},
    id,
};
use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
use chrono::{DateTime, Datelike, Days, SecondsFormat, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{FromRow, SqliteConnection};
fn label() -> String {
    "Alarm".into()
}
fn time() -> String {
    "07:00".into()
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Definition {
    #[serde(default = "label")]
    label: String,
    #[serde(default = "time")]
    time: String,
    time_zone: String,
    #[serde(default)]
    repeat_days: Vec<u32>,
    at: Option<String>,
    snooze_minutes: Option<i64>,
    light_target: Option<String>,
}
pub fn valid_target(value: &str) -> bool {
    let entity = |id: &str, domains: &[&str]| {
        id.split_once('.').is_some_and(|(d, n)| {
            domains.contains(&d)
                && !n.is_empty()
                && n.bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        })
    };
    value.len() <= 1000
        && (entity(value, &["scene"]) || value.split(',').all(|v| entity(v, &["light", "switch"])))
}
impl Definition {
    fn validate(mut self) -> Result<Self> {
        self.label = self.label.trim().into();
        let b = self.time.as_bytes();
        if self.label.is_empty()
            || self.label.chars().count() > 80
            || b.len() != 5
            || b[2] != b':'
            || ![b[0], b[1], b[3], b[4]].iter().all(u8::is_ascii_digit)
            || &self.time[..2] > "23"
            || &self.time[3..] > "59"
            || self.time_zone.parse::<chrono_tz::Tz>().is_err()
            || self.repeat_days.len() > 7
            || self.repeat_days.iter().any(|v| *v > 6)
            || self.snooze_minutes.is_some_and(|v| !(1..=60).contains(&v))
            || self.light_target.as_ref().is_some_and(|v| !valid_target(v))
            || self.at.as_ref().is_some_and(|v| {
                DateTime::parse_from_rfc3339(v).is_err() || !self.repeat_days.is_empty()
            })
        {
            return Err(ApiError::bad("Invalid alarm details"));
        }
        self.repeat_days.sort_unstable();
        self.repeat_days.dedup();
        Ok(self)
    }
    pub fn next(&self, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
        if let Some(at) = &self.at {
            return DateTime::parse_from_rfc3339(at)
                .ok()
                .map(|d| d.with_timezone(&Utc))
                .filter(|d| *d > after);
        }
        let zone = self.time_zone.parse::<chrono_tz::Tz>().ok()?;
        let today = after.with_timezone(&zone).date_naive();
        let hour = self.time[..2].parse::<u32>().ok()?;
        let minute = self.time[3..].parse::<u32>().ok()?;
        for offset in 0..=8 {
            let date = today.checked_add_days(Days::new(offset))?;
            if !self.repeat_days.is_empty()
                && !self
                    .repeat_days
                    .contains(&date.weekday().num_days_from_sunday())
            {
                continue;
            }
            // Gaps are skipped; a fold always selects its first instance, even
            // when `after` lies between the first and second instances.
            let at = zone
                .from_local_datetime(&date.and_hms_opt(hour, minute, 0)?)
                .earliest()
                .map(|d| d.with_timezone(&Utc));
            if let Some(at) = at.filter(|d| *d > after) {
                return Some(at);
            }
        }
        None
    }
}
fn stamp(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Micros, true)
}
fn parse(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|d| d.with_timezone(&Utc))
        .map_err(|_| ApiError::bad("Invalid stored alarm date"))
}
fn conflict() -> ApiError {
    ApiError {
        status: StatusCode::CONFLICT,
        message: "Alarm changed; refresh and try again",
    }
}
#[derive(FromRow)]
struct Alarm {
    id: String,
    definition: String,
    enabled: bool,
    next_fire_at: Option<String>,
}
#[derive(FromRow)]
struct Ring {
    id: String,
    alarm_id: String,
    label: String,
    status: String,
    version: i64,
    ring_at: String,
    expires_at: String,
    snooze_minutes: i64,
    light_target: String,
    lights_delivered_at: Option<String>,
    lights_attempts: i64,
}
fn definition(raw: &str) -> Result<Definition> {
    serde_json::from_str::<Definition>(raw)
        .map_err(|_| ApiError::bad("Invalid stored alarm"))?
        .validate()
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    snapshot(&s, Utc::now()).await
}
pub async fn snapshot(s: &AppState, now: DateTime<Utc>) -> Result<Json<Value>> {
    let mut tx = s.db.begin().await?;
    let alarms: Vec<Alarm> = sqlx::query_as(
        "SELECT id,definition,enabled,next_fire_at FROM alarm ORDER BY created_at,id",
    )
    .fetch_all(&mut *tx)
    .await?;
    let rings:Vec<Ring>=sqlx::query_as("SELECT * FROM alarm_ring WHERE status IN ('ringing','snoozed') AND expires_at>? ORDER BY ring_at,id").bind(stamp(now)).fetch_all(&mut *tx).await?;
    let mut defs = vec![];
    let mut nexts = vec![];
    let mut zones = std::collections::BTreeMap::new();
    for a in alarms {
        let def = definition(&a.definition)?;
        zones.insert(a.id.clone(), def.time_zone.clone());
        if a.enabled {
            if let Some(at) = &a.next_fire_at {
                nexts.push(json!({"id":a.id,"label":def.label,"at":at,"timeZone":def.time_zone}));
            }
        }
        let mut v = serde_json::to_value(def).map_err(|_| ApiError::bad("Invalid alarm"))?;
        v["id"] = json!(a.id);
        v["enabled"] = json!(a.enabled);
        v["nextFireAt"] = json!(a.next_fire_at);
        defs.push(v);
    }
    let active:Vec<_>=rings.into_iter().map(|r|{if r.status=="snoozed"{nexts.push(json!({"id":r.id,"label":r.label,"at":r.ring_at,"timeZone":zones.get(&r.alarm_id).map(String::as_str).unwrap_or("UTC")}));}json!({"id":r.id,"alarmId":r.alarm_id,"label":r.label,"status":r.status,"version":r.version,"ringAt":r.ring_at,"expiresAt":r.expires_at,"snoozeMinutes":r.snooze_minutes,"lightsPending":r.lights_delivered_at.is_none()})}).collect();
    nexts.sort_by(|a, b| a["at"].as_str().cmp(&b["at"].as_str()));
    tx.commit().await?;
    Ok(Json(
        json!({"alarms":defs,"active":active,"next":nexts.first(),"defaults":{"snoozeMinutes":s.config.alarm_snooze_minutes,"lightTarget":s.config.alarm_light_target},"serverNow":stamp(now)}),
    ))
}
pub async fn create(
    State(s): State<AppState>,
    headers: HeaderMap,
    Json(def): Json<Definition>,
) -> Result<Json<Value>> {
    let key = headers
        .get("Idempotency-Key")
        .map(|v| v.to_str().map(str::to_owned))
        .transpose()
        .map_err(|_| ApiError::bad("Invalid Idempotency-Key"))?;
    create_at(&s, def, key, Utc::now()).await
}
pub async fn create_at(
    s: &AppState,
    def: Definition,
    key: Option<String>,
    now: DateTime<Utc>,
) -> Result<Json<Value>> {
    let def = def.validate()?;
    if key.as_ref().is_some_and(|v| {
        !(8..=128).contains(&v.len())
            || !v
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    }) {
        return Err(ApiError::bad("Invalid Idempotency-Key"));
    }
    let raw = serde_json::to_string(&def).map_err(|_| ApiError::bad("Invalid alarm"))?;
    let hash = format!("{:x}", Sha256::digest(raw.as_bytes()));
    let mut tx = s.db.begin().await?;
    if let Some(key) = &key {
        let row: Option<(String, Option<String>, Option<String>)> =
            sqlx::query_as("SELECT id,request_hash,next_fire_at FROM alarm WHERE request_key=?")
                .bind(key)
                .fetch_optional(&mut *tx)
                .await?;
        if let Some((id, old, next)) = row {
            if old.as_deref() != Some(&hash) {
                return Err(conflict());
            }
            return Ok(Json(json!({"id":id,"nextFireAt":next})));
        }
    }
    let next = def
        .next(now)
        .ok_or_else(|| ApiError::bad("Choose a future alarm time"))?;
    let id = id("alm");
    sqlx::query("INSERT INTO alarm(id,definition,next_fire_at,request_key,request_hash,created_at) VALUES(?,?,?,?,?,?)").bind(&id).bind(raw).bind(stamp(next)).bind(key).bind(hash).bind(stamp(now)).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id,"nextFireAt":stamp(next)})))
}
#[derive(Deserialize)]
#[serde(untagged, deny_unknown_fields)]
pub enum Patch {
    Definition(Definition),
    Enabled { enabled: bool },
}
pub async fn update(
    State(s): State<AppState>,
    Path(id): Path<String>,
    Json(patch): Json<Patch>,
) -> Result<Json<Value>> {
    let _gate = s.alarm_light_gate.lock().await;
    let mut tx = s.db.begin().await?;
    let row: Alarm =
        sqlx::query_as("SELECT id,definition,enabled,next_fire_at FROM alarm WHERE id=?")
            .bind(&id)
            .fetch_optional(&mut *tx)
            .await?
            .ok_or_else(ApiError::not_found)?;
    let (def, enabled) = match patch {
        Patch::Definition(def) => (def.validate()?, row.enabled),
        Patch::Enabled { enabled } => {
            if row.enabled == enabled {
                return Ok(Json(json!({"id":id})));
            }
            (definition(&row.definition)?, enabled)
        }
    };
    let next = if enabled {
        Some(stamp(def.next(Utc::now()).ok_or_else(|| {
            ApiError::bad("Choose a future alarm time")
        })?))
    } else {
        None
    };
    sqlx::query("UPDATE alarm SET definition=?,enabled=?,next_fire_at=? WHERE id=?")
        .bind(serde_json::to_string(&def).map_err(|_| ApiError::bad("Invalid alarm"))?)
        .bind(enabled)
        .bind(next)
        .bind(&id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE alarm_ring SET status='stopped',version=version+1 WHERE alarm_id=? AND status IN ('ringing','snoozed')").bind(&id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"id":id})))
}
pub async fn remove(State(s): State<AppState>, Path(id): Path<String>) -> Result<Json<Value>> {
    let _gate = s.alarm_light_gate.lock().await;
    if sqlx::query("DELETE FROM alarm WHERE id=?")
        .bind(&id)
        .execute(&s.db)
        .await?
        .rows_affected()
        == 0
    {
        return Err(ApiError::not_found());
    }
    Ok(Json(json!({"id":id})))
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Stop,
    Snooze,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Act {
    id: String,
    version: i64,
    action: Action,
}
pub async fn action(State(s): State<AppState>, Json(a): Json<Act>) -> Result<Json<Value>> {
    act_at(&s, a, Utc::now()).await
}
pub async fn act_at(s: &AppState, a: Act, now: DateTime<Utc>) -> Result<Json<Value>> {
    if a.version < 0 {
        return Err(ApiError::bad("Invalid alarm version"));
    }
    let _gate = s.alarm_light_gate.lock().await;
    let mut tx = s.db.begin().await?;
    let ring:Ring=sqlx::query_as("SELECT * FROM alarm_ring WHERE id=? AND version=? AND expires_at>? AND status IN ('ringing','snoozed')").bind(&a.id).bind(a.version).bind(stamp(now)).fetch_optional(&mut *tx).await?.ok_or_else(conflict)?;
    let snooze = matches!(a.action, Action::Snooze);
    if snooze && ring.status != "ringing" {
        return Err(conflict());
    }
    if snooze {
        let at = now + chrono::Duration::minutes(ring.snooze_minutes);
        sqlx::query("UPDATE alarm_ring SET status='snoozed',version=version+1,ring_at=?,expires_at=? WHERE id=?").bind(stamp(at)).bind(stamp(at+chrono::Duration::minutes(30))).bind(&a.id).execute(&mut *tx).await?;
    } else {
        sqlx::query("UPDATE alarm_ring SET status='stopped',version=version+1 WHERE id=?")
            .bind(&a.id)
            .execute(&mut *tx)
            .await?;
    }
    notice(
        &mut tx,
        &ring.id,
        ring.version + 1,
        if snooze { "snoozed" } else { "stopped" },
        &ring.label,
        "normal",
    )
    .await?;
    tx.commit().await?;
    Ok(Json(json!({"id":a.id})))
}
async fn notice(
    conn: &mut SqliteConnection,
    id: &str,
    version: i64,
    status: &str,
    label: &str,
    priority: &str,
) -> Result<()> {
    super::notifications::insert(
        conn,
        super::notifications::Input {
            source_module: "alarms".into(),
            title: match status {
                "ringing" => "Alarm ringing",
                "missed" => "Missed alarm",
                "snoozed" => "Alarm snoozed",
                _ => "Alarm stopped",
            }
            .into(),
            body: label.into(),
            deep_link: "module/alarms".into(),
            priority: priority.into(),
            dedupe_key: Some(format!("{id}:{version}:{status}")),
        },
    )
    .await?;
    Ok(())
}
/// Ring claims and notifications are one transaction. No network I/O can hold
/// this write connection, so an unreachable light cannot delay another alarm.
pub async fn claim_due(s: &AppState, now: DateTime<Utc>) -> Result<u64> {
    let mut tx = s.db.begin().await?;
    let stamp_now = stamp(now);
    let mut fired = 0;
    let due:Vec<Alarm>=sqlx::query_as("SELECT id,definition,enabled,next_fire_at FROM alarm WHERE enabled=1 AND next_fire_at<=? ORDER BY next_fire_at LIMIT 100").bind(&stamp_now).fetch_all(&mut *tx).await?;
    for alarm in due {
        let def = definition(&alarm.definition)?;
        let persisted = parse(
            alarm
                .next_fire_at
                .as_deref()
                .ok_or_else(|| ApiError::bad("Invalid alarm date"))?,
        )?;
        let recent = if def.repeat_days.is_empty() {
            None
        } else {
            def.next(now - chrono::Duration::minutes(15) - chrono::Duration::milliseconds(1))
        };
        let scheduled = recent
            .filter(|at| *at <= now && *at >= persisted)
            .unwrap_or(persisted);
        let ring = now - scheduled <= chrono::Duration::minutes(15);
        let rid = id("alr");
        let inserted=sqlx::query("INSERT INTO alarm_ring(id,alarm_id,scheduled_at,label,status,ring_at,expires_at,snooze_minutes,light_target,lights_retry_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(alarm_id,scheduled_at) DO NOTHING").bind(&rid).bind(&alarm.id).bind(stamp(scheduled)).bind(&def.label).bind(if ring{"ringing"}else{"missed"}).bind(stamp(scheduled)).bind(stamp(now+chrono::Duration::minutes(30))).bind(def.snooze_minutes.unwrap_or(s.config.alarm_snooze_minutes)).bind(def.light_target.as_deref().unwrap_or(&s.config.alarm_light_target)).bind(&stamp_now).execute(&mut *tx).await?.rows_affected();
        if inserted > 0 {
            notice(
                &mut tx,
                &rid,
                0,
                if ring { "ringing" } else { "missed" },
                &def.label,
                if ring { "critical" } else { "high" },
            )
            .await?;
            if ring {
                fired += 1
            }
        }
        let next = if def.repeat_days.is_empty() {
            None
        } else {
            def.next(now).map(stamp)
        };
        sqlx::query("UPDATE alarm SET enabled=?,next_fire_at=? WHERE id=?")
            .bind(next.is_some())
            .bind(next)
            .bind(alarm.id)
            .execute(&mut *tx)
            .await?;
    }
    let expired:Vec<Ring>=sqlx::query_as("UPDATE alarm_ring SET status='missed',version=version+1 WHERE status IN ('ringing','snoozed') AND expires_at<=? RETURNING *").bind(&stamp_now).fetch_all(&mut *tx).await?;
    for r in expired {
        notice(&mut tx, &r.id, r.version, "missed", &r.label, "high").await?;
    }
    let snoozes:Vec<Ring>=sqlx::query_as("UPDATE alarm_ring SET status='ringing',version=version+1 WHERE status='snoozed' AND ring_at<=? AND expires_at>? RETURNING *").bind(&stamp_now).bind(&stamp_now).fetch_all(&mut *tx).await?;
    for r in snoozes {
        notice(&mut tx, &r.id, r.version, "ringing", &r.label, "critical").await?;
        fired += 1;
    }
    tx.commit().await?;
    Ok(fired)
}

pub async fn deliver_lights(s: &AppState, now: DateTime<Utc>) -> Result<()> {
    // Gate stop/update/delete against in-flight delivery, without holding a
    // SQLite transaction during network I/O. Clock claims remain independent.
    let _gate = s.alarm_light_gate.lock().await;
    let pending:Vec<Ring>=sqlx::query_as("SELECT * FROM alarm_ring WHERE status IN ('ringing','snoozed') AND lights_delivered_at IS NULL AND lights_retry_at<=? AND expires_at>? ORDER BY lights_retry_at LIMIT 10").bind(stamp(now)).bind(stamp(now)).fetch_all(&s.db).await?;
    for r in pending {
        match super::lights::alarm_lights(s, &r.light_target).await {
            Ok(()) => {
                sqlx::query("UPDATE alarm_ring SET lights_delivered_at=? WHERE id=? AND lights_delivered_at IS NULL").bind(stamp(Utc::now())).bind(r.id).execute(&s.db).await?;
            }
            Err(_) => {
                let delay = 1000_i64
                    .saturating_mul(1_i64 << r.lights_attempts.clamp(0, 6))
                    .min(60000);
                sqlx::query("UPDATE alarm_ring SET lights_attempts=lights_attempts+1,lights_retry_at=? WHERE id=?").bind(stamp(Utc::now()+chrono::Duration::milliseconds(delay))).bind(r.id).execute(&s.db).await?;
                tracing::warn!(worker = "alarm-lights", "delivery failed; retry scheduled");
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn at(s: &str) -> DateTime<Utc> {
        parse(s).unwrap()
    }
    fn def(patch: Value) -> Definition {
        let mut v = json!({"time":"09:00","timeZone":"America/Los_Angeles"});
        for (k, vv) in patch.as_object().unwrap() {
            v[k] = vv.clone();
        }
        serde_json::from_value::<Definition>(v)
            .unwrap()
            .validate()
            .unwrap()
    }
    #[test]
    fn recurrence_matches_calendar_dst_gaps_folds_and_non_hour_offsets() {
        for (after, patch, expected) in [
            ("2026-10-05T15:00:00Z", json!({}), "2026-10-05T16:00:00Z"),
            ("2026-10-05T16:00:00Z", json!({}), "2026-10-06T16:00:00Z"),
            (
                "2026-12-31T18:00:00Z",
                json!({"repeatDays":[1]}),
                "2027-01-04T17:00:00Z",
            ),
            (
                "2026-03-08T08:00:00Z",
                json!({"time":"02:30"}),
                "2026-03-09T09:30:00Z",
            ),
            (
                "2026-03-08T08:00:00Z",
                json!({"time":"02:30","repeatDays":[0]}),
                "2026-03-15T09:30:00Z",
            ),
            (
                "2026-11-01T07:00:00Z",
                json!({"time":"01:30"}),
                "2026-11-01T08:30:00Z",
            ),
            (
                "2026-11-01T08:45:00Z",
                json!({"time":"01:30"}),
                "2026-11-02T09:30:00Z",
            ),
            (
                "2026-10-05T00:00:00Z",
                json!({"timeZone":"Asia/Kathmandu"}),
                "2026-10-05T03:15:00Z",
            ),
            (
                "2026-10-03T12:00:00Z",
                json!({"timeZone":"Australia/Lord_Howe","time":"02:15"}),
                "2026-10-04T15:15:00Z",
            ),
        ] {
            assert_eq!(def(patch).next(at(after)), Some(at(expected)));
        }
    }
    #[tokio::test]
    async fn occurrences_retry_snooze_versions_and_notification_rollback_are_durable() {
        let dir = tempfile::tempdir().unwrap();
        let db = crate::storage::open(&dir.path().join("db.sqlite"))
            .await
            .unwrap();
        let s = AppState::new(db.clone(), dir.path().join("media"));
        let start = at("2026-10-05T15:59:00Z");
        let due = at("2026-10-05T16:00:00Z");
        let alarm = create_at(&s, def(json!({})), Some("fixture-key".into()), start)
            .await
            .unwrap()
            .0;
        let aid = alarm["id"].as_str().unwrap();
        let (a, b) = tokio::join!(claim_due(&s, due), claim_due(&s, due));
        assert_eq!(a.unwrap() + b.unwrap(), 1);
        let (ring, version): (String, i64) =
            sqlx::query_as("SELECT id,version FROM alarm_ring WHERE alarm_id=?")
                .bind(aid)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(version, 0);
        let retry = create_at(
            &s,
            def(json!({})),
            Some("fixture-key".into()),
            due + chrono::Duration::days(1),
        )
        .await
        .unwrap()
        .0;
        assert_eq!(retry["id"], aid);
        assert!(
            create_at(
                &s,
                def(json!({"label":"changed"})),
                Some("fixture-key".into()),
                start
            )
            .await
            .is_err()
        );
        let _ = act_at(
            &s,
            Act {
                id: ring.clone(),
                version: 0,
                action: Action::Snooze,
            },
            due,
        )
        .await
        .unwrap();
        assert!(
            act_at(
                &s,
                Act {
                    id: ring.clone(),
                    version: 0,
                    action: Action::Stop
                },
                due
            )
            .await
            .is_err()
        );
        assert_eq!(
            claim_due(&s, due + chrono::Duration::minutes(9))
                .await
                .unwrap(),
            1
        );
        let current: i64 = sqlx::query_scalar("SELECT version FROM alarm_ring WHERE id=?")
            .bind(&ring)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(current, 2);
        let _ = act_at(
            &s,
            Act {
                id: ring.clone(),
                version: 2,
                action: Action::Stop,
            },
            due + chrono::Duration::minutes(9),
        )
        .await
        .unwrap();
        assert_eq!(
            claim_due(&s, due + chrono::Duration::minutes(10))
                .await
                .unwrap(),
            0
        );
        let status: String = sqlx::query_scalar("SELECT status FROM alarm_ring WHERE id=?")
            .bind(&ring)
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(status, "stopped");
        // An insert failure in notifications must roll back the ring AND advance.
        let other = create_at(&s, def(json!({"label":"atomic"})), None, start)
            .await
            .unwrap()
            .0;
        sqlx::query("CREATE TRIGGER reject_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'fixture'); END").execute(&db).await.unwrap();
        assert!(claim_due(&s, due).await.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM alarm_ring WHERE alarm_id=?")
            .bind(other["id"].as_str().unwrap())
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0);
        sqlx::query("DROP TRIGGER reject_notice")
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(claim_due(&s, due).await.unwrap(), 1);
    }
}
