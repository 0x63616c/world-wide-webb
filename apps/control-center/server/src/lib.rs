//! Native application's server. No static web hosting or frontend registration framework.
pub mod config;
pub mod features;
pub mod http;
pub mod integrations;
pub mod runtime;
pub mod storage;

use chrono::{SecondsFormat, Utc};
use std::{path::PathBuf, sync::Arc};

#[derive(Clone)]
pub struct AppState {
    pub db: sqlx::SqlitePool,
    pub media: PathBuf,
    pub config: Arc<config::Config>,
    pub shutdown: tokio::sync::watch::Sender<bool>,
    pub workers: runtime::Health,
    pub diagnostics: Arc<std::sync::Mutex<std::collections::VecDeque<serde_json::Value>>>,
    pub light_gate: Arc<tokio::sync::Mutex<()>>,
    pub alarm_light_gate: Arc<tokio::sync::Mutex<()>>,
}
impl AppState {
    pub fn new(db: sqlx::SqlitePool, media: PathBuf) -> Self {
        Self {
            db,
            media,
            config: Arc::new(config::Config::default()),
            shutdown: tokio::sync::watch::channel(false).0,
            workers: Default::default(),
            diagnostics: Default::default(),
            alarm_light_gate: Default::default(),
            light_gate: Default::default(),
        }
    }
}
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true)
}
pub fn id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}
pub fn timestamp(raw: &str) -> Result<String, http::ApiError> {
    chrono::DateTime::parse_from_rfc3339(raw)
        .map(|d| {
            d.with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Micros, true)
        })
        .map_err(|_| http::ApiError::bad("Invalid RFC3339 timestamp"))
}
