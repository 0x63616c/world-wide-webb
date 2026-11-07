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

// A missing or corrupt settings row never accepts a default PIN.
pub async fn verify_pin(s: &AppState, pin: &str) -> Result<()> {
    use subtle::ConstantTimeEq;
    let stored: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE id='singleton'")
            .fetch_optional(&s.db)
            .await?;
    let expected = stored
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .and_then(|v| v.get("pinCode").and_then(Value::as_str).map(str::to_owned));
    if pin.len() == 6
        && pin.bytes().all(|b| b.is_ascii_digit())
        && expected.as_ref().is_some_and(|v| {
            v.len() == 6
                && v.bytes().all(|b| b.is_ascii_digit())
                && bool::from(pin.as_bytes().ct_eq(v.as_bytes()))
        })
    {
        Ok(())
    } else {
        Err(ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "PIN not accepted",
        })
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PIN {
    pin: String,
}
pub async fn verify(State(s): State<AppState>, Json(input): Json<PIN>) -> Result<Json<Value>> {
    match verify_pin(&s, &input.pin).await {
        Ok(()) => Ok(Json(json!({"verified":true}))),
        Err(e) if e.status == axum::http::StatusCode::FORBIDDEN => {
            Ok(Json(json!({"verified":false})))
        }
        Err(e) => Err(e),
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PINChange {
    current: String,
    replacement: String,
}
pub async fn change_pin(
    State(s): State<AppState>,
    Json(input): Json<PINChange>,
) -> Result<Json<Value>> {
    use subtle::ConstantTimeEq;
    let valid = |p: &str| p.len() == 6 && p.bytes().all(|b| b.is_ascii_digit());
    if !valid(&input.current) || !valid(&input.replacement) {
        return Err(ApiError::bad("Enter a six-digit PIN"));
    }
    let mut tx = s.db.begin().await?;
    let raw: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE id='singleton'")
        .fetch_optional(&mut *tx)
        .await?;
    let mut value = raw
        .and_then(|v| serde_json::from_str::<Value>(&v).ok())
        .ok_or(ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "PIN not accepted",
        })?;
    let matched = value
        .get("pinCode")
        .and_then(Value::as_str)
        .is_some_and(|p| valid(p) && bool::from(p.as_bytes().ct_eq(input.current.as_bytes())));
    if !matched {
        return Err(ApiError {
            status: axum::http::StatusCode::FORBIDDEN,
            message: "PIN not accepted",
        });
    }
    value["pinCode"] = json!(input.replacement);
    sqlx::query("UPDATE settings SET value=?,updated_at_utc=? WHERE id='singleton'")
        .bind(value.to_string())
        .bind(now())
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Json(json!({"changed":true})))
}
