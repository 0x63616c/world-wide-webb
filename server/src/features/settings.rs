use crate::{
    AppState,
    http::{ApiError, Result},
    now,
};
use axum::{Json, extract::State};
use serde::Deserialize;
use serde_json::{Value, json};

// PIN is deliberately never returned by general settings reads.
fn public(mut v: Value) -> Value {
    if let Some(o) = v.as_object_mut() {
        o.remove("pinCode");
    }
    v
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    let v: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE id='singleton'")
        .fetch_optional(&s.db)
        .await?;
    match v {
        Some(v) => Ok(Json(public(
            serde_json::from_str(&v).map_err(|_| ApiError::bad("Invalid stored settings"))?,
        ))),
        None => Ok(Json(
            json!({"accent":"blue","timeZone":"America/Los_Angeles"}),
        )),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Patch {
    accent: Option<String>,
    time_zone: Option<String>,
}
pub async fn update(State(s): State<AppState>, Json(v): Json<Patch>) -> Result<Json<Value>> {
    if v.accent
        .as_ref()
        .is_some_and(|v| !["blue", "white", "green", "orange"].contains(&v.as_str()))
    {
        return Err(ApiError::bad("Invalid accent"));
    }
    if v.time_zone
        .as_ref()
        .is_some_and(|v| v.parse::<chrono_tz::Tz>().is_err())
    {
        return Err(ApiError::bad("Invalid time zone"));
    }
    let mut tx = s.db.begin().await?;
    let stored: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE id='singleton'")
            .fetch_optional(&mut *tx)
            .await?;
    let mut value = stored
        .map(|s| serde_json::from_str::<Value>(&s))
        .transpose()
        .map_err(|_| ApiError::bad("Invalid stored settings"))?
        .unwrap_or_else(|| json!({"accent":"blue","timeZone":"America/Los_Angeles"}));
    if !value.is_object() {
        return Err(ApiError::bad("Invalid stored settings"));
    }
    if let Some(a) = v.accent {
        value["accent"] = json!(a);
    }
    if let Some(t) = v.time_zone {
        value["timeZone"] = json!(t);
    }
    sqlx::query("INSERT INTO settings(id,value,updated_at_utc) VALUES('singleton',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at_utc=excluded.updated_at_utc").bind(value.to_string()).bind(now()).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(Json(public(value)))
}
