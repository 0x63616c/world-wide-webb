use crate::{
    AppState,
    http::{ApiError, Result},
};
use axum::{Json, extract::State};
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
