//! The Mini's NAS/deploy summary and redacted log tails, exported by Homelab into a
//! read-only folder. The server never touches Docker or the host directly.
use crate::{
    AppState,
    http::{ApiError, Result},
};
use axum::{
    Json,
    extract::{Path, State},
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{io::SeekFrom, path::PathBuf};
use tokio::io::{AsyncReadExt, AsyncSeekExt};

/// Homelab refreshes the folder every minute; older data is reported as stale.
const STALE_AFTER_SECONDS: i64 = 5 * 60;
const MAX_LINES: usize = 500;
const MAX_TAIL_BYTES: u64 = 512 * 1024;
const MAX_REASON: usize = 200;

#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct Check {
    state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    since: Option<DateTime<Utc>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}
impl Check {
    fn unknown() -> Self {
        Self {
            state: "unknown".into(),
            since: None,
            reason: None,
        }
    }
    fn valid(&self, failure: &str) -> bool {
        ["ok", "unknown", failure].contains(&self.state.as_str())
            && self
                .reason
                .as_ref()
                .is_none_or(|r| r.chars().count() <= MAX_REASON && !r.contains('\n'))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct File {
    format: u8,
    updated_at: DateTime<Utc>,
    nas: Check,
    deploy: Check,
}

fn folder(state: &AppState) -> Option<&PathBuf> {
    state.config.host_dir.as_ref()
}

fn summary(file: Option<File>, now: DateTime<Utc>) -> Value {
    match file.filter(|f| f.format == 1 && f.nas.valid("failing") && f.deploy.valid("blocked")) {
        Some(f) => json!({
            "nas": f.nas,
            "deploy": f.deploy,
            "updatedAt": f.updated_at,
            "stale": (now - f.updated_at).num_seconds() > STALE_AFTER_SECONDS,
        }),
        None => json!({
            "nas": Check::unknown(),
            "deploy": Check::unknown(),
            "updatedAt": null,
            "stale": true,
        }),
    }
}

pub async fn status(State(state): State<AppState>) -> Result<Json<Value>> {
    let file = match folder(&state) {
        Some(dir) => tokio::fs::read(dir.join("status.json"))
            .await
            .ok()
            .and_then(|bytes| serde_json::from_slice::<File>(&bytes).ok()),
        None => None,
    };
    Ok(Json(summary(file, Utc::now())))
}

fn valid_source(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name.as_bytes()[0].is_ascii_alphanumeric()
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

fn modified(meta: &std::fs::Metadata) -> Option<DateTime<Utc>> {
    meta.modified().ok().map(DateTime::<Utc>::from)
}

pub async fn sources(State(state): State<AppState>) -> Result<Json<Value>> {
    let mut sources = Vec::new();
    if let Some(dir) = folder(&state)
        && let Ok(mut entries) = tokio::fs::read_dir(dir.join("logs")).await
    {
        while let Ok(Some(entry)) = entries.next_entry().await {
            let name = entry.file_name();
            let Some(source) = name.to_str().and_then(|n| n.strip_suffix(".log")) else {
                continue;
            };
            let Ok(meta) = entry.metadata().await else {
                continue;
            };
            if valid_source(source) && meta.is_file() {
                sources.push(json!({"name": source, "updatedAt": modified(&meta)}));
            }
        }
    }
    sources.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    Ok(Json(json!({ "sources": sources })))
}

pub async fn logs(
    State(state): State<AppState>,
    Path(source): Path<String>,
) -> Result<Json<Value>> {
    let dir = folder(&state).ok_or_else(ApiError::not_found)?;
    if !valid_source(&source) {
        return Err(ApiError::not_found());
    }
    // Open only a file the export folder actually lists; the request never builds a path.
    let wanted = format!("{source}.log");
    let mut entries = tokio::fs::read_dir(dir.join("logs"))
        .await
        .map_err(|_| ApiError::not_found())?;
    let mut path = None;
    while let Ok(Some(entry)) = entries.next_entry().await {
        if entry.file_name().to_str() == Some(wanted.as_str()) {
            path = Some(entry.path());
            break;
        }
    }
    let path = path.ok_or_else(ApiError::not_found)?;
    let mut file = tokio::fs::File::open(&path)
        .await
        .map_err(|_| ApiError::not_found())?;
    let meta = file.metadata().await.map_err(|_| ApiError::not_found())?;
    if !meta.is_file() {
        return Err(ApiError::not_found());
    }
    let start = meta.len().saturating_sub(MAX_TAIL_BYTES);
    let mut bytes = Vec::new();
    let read = async {
        file.seek(SeekFrom::Start(start)).await?;
        file.read_to_end(&mut bytes).await
    };
    read.await.map_err(|_| ApiError {
        status: axum::http::StatusCode::SERVICE_UNAVAILABLE,
        message: "Log unavailable",
    })?;
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<&str> = text.lines().collect();
    if start > 0 && !lines.is_empty() {
        lines.remove(0); // The first line was cut mid-way.
    }
    let lines = &lines[lines.len().saturating_sub(MAX_LINES)..];
    Ok(Json(json!({
        "source": source,
        "updatedAt": modified(&meta),
        "lines": lines,
    })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_names_cannot_escape_the_folder() {
        assert!(valid_source("www-control-center-www-1"));
        assert!(valid_source("deploy"));
        for bad in [
            "",
            "../status",
            "a/b",
            "-x",
            "Deploy",
            "a.log",
            &"a".repeat(65),
        ] {
            assert!(!valid_source(bad), "{bad}");
        }
    }
}
