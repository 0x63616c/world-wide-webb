use crate::{
    AppState,
    http::{ApiError, Result},
    integrations::homeassistant::Entity,
    now,
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;

const ID: &str = "climate-thermostat";
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Climate {
    pub mode: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_low: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_high: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fan_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fan_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ambient: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
}
impl Climate {
    fn desired(&self) -> Self {
        Self {
            ambient: None,
            action: None,
            fan_modes: None,
            ..self.clone()
        }
    }
    fn conditioning(&self) -> bool {
        matches!(self.action.as_deref(), Some("heating" | "cooling"))
    }
    fn converged(&self, reported: &Self, ignore_fan: bool) -> bool {
        self.mode == reported.mode
            && (reported.mode == "off"
                || [
                    (self.target, reported.target),
                    (self.target_low, reported.target_low),
                    (self.target_high, reported.target_high),
                ]
                .iter()
                .all(|(a, b)| a.is_none() || a == b))
            && (ignore_fan || self.fan_mode.is_none() || self.fan_mode == reported.fan_mode)
    }
    fn remembered(&self, previous: &Self) -> Self {
        Self {
            target: self.target.or(previous.target),
            target_low: self.target_low.or(previous.target_low),
            target_high: self.target_high.or(previous.target_high),
            ..self.desired()
        }
    }
}
#[derive(FromRow)]
struct Row {
    entity_id: String,
    reported_state: Option<String>,
    desired_state: Option<String>,
    desired_at_utc: Option<String>,
    desired_until_utc: Option<String>,
    reported_at_utc: Option<String>,
    available: bool,
}
fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Thermostat unavailable",
    }
}
fn decode(s: Option<&str>) -> Result<Option<Climate>> {
    s.map(serde_json::from_str)
        .transpose()
        .map_err(|_| unavailable())
}
async fn row(s: &AppState) -> Result<Option<Row>> {
    Ok(sqlx::query_as("SELECT * FROM device_state WHERE id=?")
        .bind(ID)
        .fetch_optional(&s.db)
        .await?)
}
fn mapped(e: &Entity) -> Option<Climate> {
    if ["unknown", "unavailable"].contains(&e.state.as_str()) {
        return None;
    }
    let a = &e.attributes;
    Some(Climate {
        mode: e.state.clone(),
        target: a.get("temperature").and_then(Value::as_f64),
        target_low: a.get("target_temp_low").and_then(Value::as_f64),
        target_high: a.get("target_temp_high").and_then(Value::as_f64),
        fan_mode: a.get("fan_mode").and_then(Value::as_str).map(str::to_owned),
        fan_modes: a
            .get("fan_modes")
            .and_then(|v| serde_json::from_value(v.clone()).ok()),
        ambient: a.get("current_temperature").and_then(Value::as_f64),
        action: a
            .get("hvac_action")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}
fn effective(r: &Row) -> Result<Climate> {
    let mut reported = decode(r.reported_state.as_deref())?.ok_or_else(unavailable)?;
    if let Some(desired) = decode(r.desired_state.as_deref())? {
        reported.mode = desired.mode;
        reported.target = desired.target.or(reported.target);
        reported.target_low = desired.target_low.or(reported.target_low);
        reported.target_high = desired.target_high.or(reported.target_high);
        reported.fan_mode = desired.fan_mode.or(reported.fan_mode);
    }
    Ok(reported)
}
fn fresh(r: &Row) -> bool {
    r.available
        && r.reported_at_utc
            .as_ref()
            .and_then(|v| DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|t| Utc::now().signed_duration_since(t).num_seconds() < 30)
}
fn response(v: Climate) -> Result<Value> {
    let ambient = v.ambient.ok_or_else(unavailable)?;
    let action = match v.action.as_deref() {
        Some("heating") => "heating",
        Some("cooling") => "cooling",
        _ => "idle",
    };
    match v.mode.as_str() {
        "heat" | "cool" => Ok(
            json!({"mode":v.mode,"target":v.target.ok_or_else(unavailable)?,"ambient":ambient,"action":action}),
        ),
        "heat_cool" => Ok(
            json!({"mode":v.mode,"targetLow":v.target_low.ok_or_else(unavailable)?,"targetHigh":v.target_high.ok_or_else(unavailable)?,"ambient":ambient,"action":action}),
        ),
        "off" => Ok(
            json!({"mode":"off","target":v.target,"targetLow":v.target_low,"targetHigh":v.target_high,"ambient":ambient,"action":action}),
        ),
        _ => Err(unavailable()),
    }
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    let r = row(&s).await?.ok_or_else(unavailable)?;
    if !fresh(&r) {
        return Err(unavailable());
    }
    Ok(Json(response(effective(&r)?)?))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Command {
    mode: Option<String>,
    target: Option<i64>,
    low: Option<i64>,
    high: Option<i64>,
    fan_mode: Option<String>,
}
pub async fn command(State(s): State<AppState>, Json(c): Json<Command>) -> Result<Json<Value>> {
    if c.mode
        .as_ref()
        .is_some_and(|m| !["off", "heat", "cool", "heat_cool"].contains(&m.as_str()))
        || [c.target, c.low, c.high]
            .iter()
            .flatten()
            .any(|n| !(67..=77).contains(n))
        || c.low.is_some() != c.high.is_some()
        || c.low.zip(c.high).is_some_and(|(l, h)| l + 2 > h)
        || c.target.is_some() && c.low.is_some()
    {
        return Err(ApiError::bad("Invalid climate command"));
    }
    if c.mode.is_none() && c.target.is_none() && c.low.is_none() && c.fan_mode.is_none() {
        return Err(ApiError::bad("Empty command"));
    }
    let r = row(&s).await?.ok_or_else(unavailable)?;
    if !fresh(&r) {
        return Err(unavailable());
    }
    let mut v = effective(&r)?;
    if let Some(fan) = c.fan_mode {
        if !v.fan_modes.as_ref().is_some_and(|m| m.contains(&fan)) {
            return Err(ApiError::bad("Unsupported fan mode"));
        }
        v.fan_mode = Some(fan);
    }
    if let Some(mode) = c.mode {
        v.mode = mode;
    }
    if c.target.is_some() && !["heat", "cool"].contains(&v.mode.as_str()) {
        return Err(ApiError::bad("Single target requires heat or cool"));
    }
    if c.low.is_some() && v.mode != "heat_cool" {
        return Err(ApiError::bad("Range requires heat_cool"));
    }
    if let Some(n) = c.target {
        v.target = Some(n as f64);
    }
    if let Some(n) = c.low {
        v.target_low = Some(n as f64);
        v.target_high = c.high.map(|v| v as f64);
    }
    let answer = response(v.clone())?;
    let at = Utc::now();
    let stamp = at.to_rfc3339_opts(SecondsFormat::Micros, true);
    // Compare-and-swap: concurrent commands never silently overwrite a newer desired state.
    let changed=sqlx::query("UPDATE device_state SET desired_state=?,desired_at_utc=?,desired_until_utc=?,updated_at_utc=? WHERE id=? AND desired_at_utc IS ?")
        .bind(serde_json::to_string(&v.desired()).map_err(|_|unavailable())?).bind(&stamp)
        .bind((at+chrono::Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Micros,true)).bind(&stamp).bind(ID).bind(&r.desired_at_utc).execute(&s.db).await?;
    if changed.rows_affected() != 1 {
        return Err(ApiError {
            status: StatusCode::CONFLICT,
            message: "Climate changed; refresh and retry",
        });
    }
    Ok(Json(answer))
}
pub async fn reconcile(s: &AppState, last_fan: &mut Option<String>) -> Result<()> {
    let ha = s.config.ha.as_ref().ok_or_else(unavailable)?;
    let entities = match ha.states().await {
        Ok(v) => v,
        Err(_) => {
            sqlx::query("UPDATE device_state SET available=0 WHERE id=?")
                .bind(ID)
                .execute(&s.db)
                .await?;
            return Err(unavailable());
        }
    };
    let mut climates: Vec<_> = entities
        .iter()
        .filter(|e| e.entity_id.starts_with("climate.") && !e.entity_id.starts_with("climate.evee"))
        .collect();
    climates.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
    let e = s
        .config
        .climate_entity
        .as_ref()
        .and_then(|id| entities.iter().find(|e| &e.entity_id == id))
        .or_else(|| climates.first().copied());
    let Some((entity, reported)) = e.and_then(|e| mapped(e).map(|r| (e, r))) else {
        sqlx::query("UPDATE device_state SET available=0 WHERE id=?")
            .bind(ID)
            .execute(&s.db)
            .await?;
        return Err(unavailable());
    };
    let previous = row(s).await?;
    let stamp = now();
    let reported_json = serde_json::to_string(&reported).map_err(|_| unavailable())?;
    let Some(old) = previous else {
        sqlx::query("INSERT INTO device_state(id,kind,entity_id,domain,label,reported_state,reported_at_utc,reported_changed_at_utc,desired_state,desired_at_utc,available,created_at_utc,updated_at_utc) VALUES(?,'climate',?,'climate','Thermostat',?,?,?,?,?,1,?,?)")
            .bind(ID).bind(&entity.entity_id).bind(&reported_json).bind(&stamp).bind(&stamp)
            .bind(serde_json::to_string(&reported.desired()).map_err(|_|unavailable())?).bind(&stamp).bind(&stamp).bind(&stamp).execute(&s.db).await?;
        return Ok(());
    };
    if old.entity_id != entity.entity_id {
        return Err(ApiError::bad(
            "Configured thermostat identity changed; explicit migration required",
        ));
    }
    let prior = decode(old.reported_state.as_deref())?;
    let desired = decode(old.desired_state.as_deref())?.map(|v| v.desired());
    let window = old.desired_until_utc.as_ref().is_some_and(|v| v > &stamp);
    let mut adopted = None;
    if let Some(wanted) = desired {
        let masked = reported.conditioning()
            || prior.as_ref().is_some_and(|p| {
                (p.conditioning() || p.fan_mode == reported.fan_mode)
                    && wanted.fan_mode != reported.fan_mode
            });
        let fresh_fan =
            window && wanted.fan_mode.is_some() && last_fan.as_ref() != old.desired_at_utc.as_ref();
        if fresh_fan || !wanted.converged(&reported, masked) {
            if window {
                if wanted.mode != reported.mode {
                    ha.call(
                        "climate",
                        "set_hvac_mode",
                        json!({"entity_id":entity.entity_id,"hvac_mode":wanted.mode}),
                    )
                    .await
                    .map_err(|_| unavailable())?;
                }
                if wanted.mode != "off" {
                    if wanted.mode == "heat_cool" {
                        if let Some((low, high)) = wanted.target_low.zip(wanted.target_high) {
                            if reported.target_low != Some(low)
                                || reported.target_high != Some(high)
                            {
                                ha.call("climate","set_temperature",json!({"entity_id":entity.entity_id,"target_temp_low":low,"target_temp_high":high})).await.map_err(|_|unavailable())?;
                            }
                        }
                    } else if let Some(target) = wanted.target {
                        if reported.target != Some(target) {
                            ha.call(
                                "climate",
                                "set_temperature",
                                json!({"entity_id":entity.entity_id,"temperature":target}),
                            )
                            .await
                            .map_err(|_| unavailable())?;
                        }
                    }
                }
                if fresh_fan {
                    ha.call(
                        "climate",
                        "set_fan_mode",
                        json!({"entity_id":entity.entity_id,"fan_mode":wanted.fan_mode}),
                    )
                    .await
                    .map_err(|_| unavailable())?;
                    *last_fan = old.desired_at_utc.clone();
                }
            } else {
                let mut value = reported.remembered(&wanted);
                if masked {
                    value.fan_mode = wanted.fan_mode;
                }
                adopted = Some(value);
            }
        }
    } else {
        adopted = Some(reported.desired());
    }
    let adopted = adopted
        .map(|v| serde_json::to_string(&v))
        .transpose()
        .map_err(|_| unavailable())?;
    sqlx::query("UPDATE device_state SET reported_changed_at_utc=CASE WHEN reported_state IS NOT ? THEN ? ELSE reported_changed_at_utc END,reported_state=?,reported_at_utc=?,available=1,updated_at_utc=?,desired_state=CASE WHEN desired_at_utc IS ? THEN coalesce(?,desired_state) ELSE desired_state END,desired_at_utc=CASE WHEN desired_at_utc IS ? AND ? IS NOT NULL THEN ? ELSE desired_at_utc END WHERE id=?")
        .bind(&reported_json).bind(&stamp).bind(&reported_json).bind(&stamp).bind(&stamp).bind(&old.desired_at_utc).bind(&adopted).bind(&old.desired_at_utc).bind(&adopted).bind(&stamp).bind(ID).execute(&s.db).await?;
    Ok(())
}

pub async fn set_fan(s: &AppState, mode: String) -> Result<()> {
    let _ = command(
        State(s.clone()),
        Json(Command {
            mode: None,
            target: None,
            low: None,
            high: None,
            fan_mode: Some(mode),
        }),
    )
    .await?;
    Ok(())
}
pub async fn fan(s: &AppState) -> Result<Value> {
    let Some(r) = row(s).await? else {
        return Ok(json!({"mode":null,"on":false,"sub":"","pending":false,"modes":["auto","on"]}));
    };
    let v = effective(&r)?;
    let reported = decode(r.reported_state.as_deref())?;
    let on = v.fan_mode.as_deref() == Some("on");
    let sub = if on {
        "On"
    } else if v.mode == "off" || v.fan_mode.as_deref() == Some("off") {
        "Off"
    } else if v.fan_mode.as_deref() == Some("auto") {
        "Auto"
    } else {
        ""
    };
    let pending = reported
        .as_ref()
        .is_some_and(|p| v.fan_mode.is_some() && p.fan_mode != v.fan_mode && !p.conditioning());
    Ok(
        json!({"mode":v.fan_mode,"on":on,"sub":sub,"pending":pending,"modes":v.fan_modes.unwrap_or_else(||vec!["auto".into(),"on".into()])}),
    )
}
