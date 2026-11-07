use crate::{
    AppState,
    features::{
        alarms, booth, climate, diagnostics, lights, notifications, releases, settings, sound,
        tesla, walks, weather,
    },
};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Request, State},
    http::{StatusCode, header},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use subtle::ConstantTimeEq;

#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct ApiError {
    pub status: StatusCode,
    pub message: &'static str,
}
impl ApiError {
    pub fn bad(message: &'static str) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            message,
        }
    }
    pub fn not_found() -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            message: "Not found",
        }
    }
}
impl From<sqlx::Error> for ApiError {
    fn from(error: sqlx::Error) -> Self {
        // Do not log bind values, SQL or row contents.
        tracing::error!(kind = "database", "database operation failed");
        if error
            .as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            Self {
                status: StatusCode::CONFLICT,
                message: "Conflicting state",
            }
        } else {
            Self {
                status: StatusCode::SERVICE_UNAVAILABLE,
                message: "Storage unavailable",
            }
        }
    }
}
impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({"error": self.message}))).into_response()
    }
}
pub type Result<T> = std::result::Result<T, ApiError>;

pub fn router(state: AppState) -> Router {
    let api = Router::new()
        .route("/api/v1/health", get(health))
        .route(
            "/api/v1/diagnostics",
            get(diagnostics::list).post(diagnostics::submit),
        )
        .route("/api/v1/diagnostics/status", get(diagnostics::status))
        .route("/api/v1/settings/pin/verify", post(settings::verify))
        .route(
            "/api/v1/settings/pin",
            axum::routing::patch(settings::change_pin),
        )
        .route("/api/v1/alarms", get(alarms::get).post(alarms::create))
        .route("/api/v1/alarms/action", post(alarms::action))
        .route(
            "/api/v1/alarms/{id}",
            axum::routing::patch(alarms::update).delete(alarms::remove),
        )
        .route("/api/v1/tesla", get(tesla::get))
        .route("/api/v1/tesla/commands", post(tesla::command))
        .route("/api/v1/sound", get(sound::get).post(sound::command))
        .route(
            "/api/v1/sound/calibration",
            post(sound::calibrate).delete(sound::clear),
        )
        .route("/api/v1/controls", get(lights::get).post(lights::command))
        .route("/api/v1/climate", get(climate::get).patch(climate::command))
        .route(
            "/api/v1/releases/latest",
            get(releases::latest).post(releases::publish),
        )
        .route("/api/v1/weather/now", get(weather::current))
        .route("/api/v1/weather/hourly", get(weather::hourly))
        .route("/api/v1/weather/daily", get(weather::daily))
        .route("/api/v1/wifi/guest", get(wifi))
        .route("/api/v1/walks/state", get(walks::state))
        .route("/api/v1/walks/history", get(walks::history))
        .route("/api/v1/walks/start", post(walks::start))
        .route("/api/v1/walks/stop", post(walks::stop))
        .route(
            "/api/v1/walks/{id}",
            axum::routing::patch(walks::update).delete(walks::delete),
        )
        .route(
            "/api/v1/settings",
            get(settings::get).patch(settings::update),
        )
        .route(
            "/api/v1/notifications",
            get(notifications::list).post(notifications::create),
        )
        .route("/api/v1/notifications/read", post(notifications::read))
        .route(
            "/api/v1/notifications/dismiss",
            post(notifications::dismiss),
        )
        .route(
            "/api/v1/notifications/dismiss-all",
            post(notifications::dismiss_all),
        )
        .route("/api/v1/notifications/stream", get(notifications::stream))
        .route("/api/v1/booth", get(booth::list))
        .route("/api/v1/booth/{id}", axum::routing::delete(booth::remove))
        .route(
            "/api/v1/booth/{id}/filter",
            axum::routing::delete(booth::clear_filter),
        )
        .layer(DefaultBodyLimit::max(32768));
    let media = Router::new()
        .route("/media/sonos/{room}/artwork", get(sound::artwork))
        .route("/media/booth-photo", post(booth::upload))
        .route("/media/booth-photos/{*path}", get(booth::download))
        .layer(DefaultBodyLimit::max(20 * 1024 * 1024));
    Router::new()
        .merge(
            api.merge(media)
                .route_layer(middleware::from_fn_with_state(state.clone(), authenticate)),
        )
        .route("/up", get(|| async { StatusCode::NO_CONTENT }))
        .route("/healthz", get(health))
        .with_state(state)
}
async fn authenticate(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let supplied = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    // Native installations cannot publish release metadata. The automation
    // token is provisioned separately and never distributed to clients.
    let publishing = request.method() == axum::http::Method::POST
        && request.uri().path() == "/api/v1/releases/latest";
    let expected = if publishing {
        state.config.release_token.as_deref().unwrap_or("")
    } else {
        &state.token
    };
    if expected.len() < 32 || !bool::from(supplied.as_bytes().ct_eq(expected.as_bytes())) {
        return (
            StatusCode::UNAUTHORIZED,
            [(header::WWW_AUTHENTICATE, "Bearer")],
            Json(json!({"error":"Unauthorized"})),
        )
            .into_response();
    }
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}
async fn health(State(state): State<AppState>) -> Result<Json<Value>> {
    sqlx::query("SELECT 1").execute(&state.db).await?;
    Ok(Json(
        json!({"status":"ok","timestamp":chrono::Utc::now().timestamp_millis(),"database":"ok","cycles":{"enabled":state.config.workers_enabled}, "workers":state.workers.read().expect("worker lock").clone(), "backend":"rust", "build": option_env!("BUILD_HASH").unwrap_or("local")}),
    ))
}

async fn wifi(State(s): State<AppState>) -> Result<Json<Value>> {
    Ok(Json(
        json!({"qr":s.config.wifi_qr.as_deref().unwrap_or("")}),
    ))
}
