use crate::{
    AppState,
    http::{ApiError, Result},
};
use axum::{
    Json,
    extract::{Query, State},
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    source: String,
    #[serde(rename = "backendURL")]
    backend_u_r_l: String,
    build: String,
    #[serde(rename = "gitSHA")]
    git_s_h_a: String,
    backend: String,
    latency_ms: Option<u32>,
    home_assistant: String,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    control: String,
    payload: BTreeMap<String, String>,
    status: Option<u16>,
    error: Option<String>,
    latency_ms: u32,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Submission {
    snapshot: Snapshot,
    commands: Vec<Command>,
}
fn valid(input: &Submission) -> bool {
    let s = &input.snapshot;
    let origin = s.backend_u_r_l == "unconfigured"
        || reqwest::Url::parse(&s.backend_u_r_l).is_ok_and(|url| {
            ["http", "https"].contains(&url.scheme())
                && url.origin().ascii_serialization() == s.backend_u_r_l
        });
    let build = s.build == "dev"
        || (!s.build.is_empty()
            && s.build.len() <= 32
            && s.build.bytes().all(|b| b.is_ascii_digit() || b == b'.'));
    let sha = s.git_s_h_a == "dev"
        || ((7..=40).contains(&s.git_s_h_a.len())
            && s.git_s_h_a
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)));
    ["live", "fixture"].contains(&s.source.as_str())
        && origin
        && build
        && sha
        && ["checking", "reachable", "unreachable"].contains(&s.backend.as_str())
        && s.latency_ms.is_none_or(|n| n <= 300000)
        && ["unknown", "connected", "unavailable", "unconfigured"]
            .contains(&s.home_assistant.as_str())
        && input.commands.len() <= 50
        && input.commands.iter().all(|c| {
            !c.control.is_empty()
                && c.control.len() <= 80
                && c.control
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._".contains(&b))
                && c.status.is_none_or(|n| (100..=599).contains(&n))
                && c.latency_ms <= 300000
                && c.error.as_deref().is_none_or(|v| {
                    [
                        "dropped: module not live",
                        "dropped: action unavailable",
                        "cancelled",
                        "request failed",
                    ]
                    .contains(&v)
                })
                && c.payload.iter().all(|(k, v)| {
                    [
                        "value",
                        "pct",
                        "seconds",
                        "positionSeconds",
                        "key",
                        "on",
                        "enabled",
                        "brightness",
                        "kelvin",
                        "temperature",
                        "target",
                        "low",
                        "high",
                        "volume",
                        "position",
                        "mode",
                        "speed",
                        "color",
                        "id",
                        "roomId",
                        "entityId",
                    ]
                    .contains(&k.as_str())
                        && v.len() <= 32
                        && (v == "<redacted>"
                            || (!v.is_empty()
                                && !v.contains(char::is_whitespace)
                                && v.parse::<f64>().is_ok_and(f64::is_finite)))
                })
        })
}
pub async fn submit(
    State(s): State<AppState>,
    Json(input): Json<Submission>,
) -> Result<Json<Value>> {
    if !valid(&input) {
        return Err(ApiError::bad("Invalid diagnostics"));
    }
    let mut queue = s.diagnostics.lock().expect("diagnostics lock");
    queue.push_back(
        json!({"timestamp":crate::now(),"snapshot":input.snapshot,"commands":input.commands}),
    );
    while queue.len() > 20 {
        queue.pop_front();
    }
    Ok(Json(json!({"accepted":true})))
}
pub async fn list(State(s): State<AppState>) -> Json<Value> {
    Json(json!(
        s.diagnostics.lock().expect("diagnostics lock").clone()
    ))
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClientEvent {
    id: String,
    time: String,
    category: String,
    action: String,
    outcome: String,
    status: Option<u16>,
    duration_ms: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EventBatch {
    device_id: String,
    device_label: String,
    build: String,
    #[serde(rename = "gitSHA")]
    git_s_h_a: String,
    events: Vec<ClientEvent>,
}

fn safe_name(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 80
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

pub async fn submit_events(
    State(s): State<AppState>,
    Json(batch): Json<EventBatch>,
) -> Result<Json<Value>> {
    if uuid::Uuid::parse_str(&batch.device_id).is_err()
        || batch.device_label.len() > 128
        || batch.device_label.chars().any(char::is_control)
        || batch.build.len() > 32
        || batch.build.is_empty()
        || !batch
            .build
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.')
        || !(batch.git_s_h_a == "dev"
            || ((7..=40).contains(&batch.git_s_h_a.len())
                && batch.git_s_h_a.bytes().all(|b| b.is_ascii_hexdigit())))
        || batch.events.len() > 100
        || batch.events.iter().any(|e| {
            uuid::Uuid::parse_str(&e.id).is_err()
                || crate::timestamp(&e.time).is_err()
                || !safe_name(&e.category)
                || !safe_name(&e.action)
                || !safe_name(&e.outcome)
                || e.status.is_some_and(|n| !(100..=599).contains(&n))
                || e.duration_ms.is_some_and(|n| n > 300_000)
        })
    {
        return Err(ApiError::bad("Invalid diagnostic events"));
    }
    let mut tx = s.db.begin().await?;
    for event in &batch.events {
        let data = json!({"deviceId":batch.device_id,"deviceLabel":batch.device_label,
            "build":batch.build,"gitSHA":batch.git_s_h_a,"event":event});
        let encoded = data.to_string();
        sqlx::query("INSERT OR IGNORE INTO diagnostic_event(device_id,event_id,received_at,data_json,bytes) VALUES(?,?,?,?,?)")
            .bind(&batch.device_id).bind(&event.id).bind(crate::now()).bind(&encoded)
            .bind(encoded.len() as i64).execute(&mut *tx).await?;
    }
    sqlx::query("DELETE FROM diagnostic_event WHERE seq IN (SELECT seq FROM (SELECT seq, SUM(bytes) OVER (ORDER BY seq DESC) AS total FROM diagnostic_event WHERE device_id=?) WHERE total > 2000000)")
        .bind(&batch.device_id).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(json!({"accepted":true})))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    device_id: Option<String>,
}

pub async fn events(
    State(s): State<AppState>,
    Query(query): Query<EventQuery>,
) -> Result<Json<Value>> {
    if query
        .device_id
        .as_ref()
        .is_some_and(|v| uuid::Uuid::parse_str(v).is_err())
    {
        return Err(ApiError::bad("Invalid device ID"));
    }
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT data_json FROM diagnostic_event WHERE (? IS NULL OR lower(device_id)=lower(?)) ORDER BY seq DESC LIMIT 500")
        .bind(&query.device_id).bind(&query.device_id).fetch_all(&s.db).await?;
    Ok(Json(json!(
        rows.into_iter()
            .filter_map(|v| serde_json::from_str::<Value>(&v).ok())
            .collect::<Vec<_>>()
    )))
}
pub async fn status(State(s): State<AppState>) -> Json<Value> {
    let status = match &s.config.ha {
        None => "unconfigured",
        Some(ha) => {
            if ha.states().await.is_ok() {
                "connected"
            } else {
                "unavailable"
            }
        }
    };
    Json(json!({"homeAssistant":status}))
}
