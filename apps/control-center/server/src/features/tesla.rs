//! Read-only telemetry snapshots survive outages. Commands require a fresh
//! discovery and a verified panel PIN; cached telemetry never authorizes writes.
use crate::{
    AppState,
    http::{ApiError, Result},
    integrations::homeassistant::Entity,
    now,
};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::BTreeMap;
const REQUIRED: [&str; 9] = [
    "battery",
    "range",
    "charging",
    "power",
    "odometer",
    "temperature",
    "lock",
    "climate",
    "chargeSwitch",
];
const OPTIONAL: [&str; 6] = [
    "softwareUpdate",
    "shiftState",
    "vehicleOnline",
    "cableConnected",
    "chargeLimit",
    "chargeCompleteAt",
];
fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Tesla unavailable",
    }
}
fn attr<'a>(e: &'a Entity, k: &str) -> Option<&'a str> {
    e.attributes.get(k)?.as_str()
}
fn score(role: &str, e: &Entity) -> i32 {
    let Some((domain, object)) = e.entity_id.split_once('.') else {
        return 0;
    };
    let Some(name) = object.strip_prefix("evee_") else {
        return 0;
    };
    let unit = attr(e, "unit_of_measurement").unwrap_or("");
    let class = attr(e, "device_class").unwrap_or("");
    let suffix = |names: &[&str]| -> i32 {
        names
            .iter()
            .position(|n| name == *n || name.ends_with(&format!("_{n}")))
            .map(|i| 100 - i as i32 + if name == names[i] { 100 } else { 0 })
            .unwrap_or(0)
    };
    match role {
        "battery" if domain == "sensor" && unit == "%" => {
            let n = suffix(&["battery_level", "battery"]);
            if n > 0 {
                n
            } else if class == "battery" {
                10
            } else {
                0
            }
        }
        "range" if domain == "sensor" && ["mi", "km"].contains(&unit) => {
            suffix(&["battery_range", "range", "rated_range"])
        }
        "charging" if ["sensor", "binary_sensor"].contains(&domain) => {
            let n = suffix(&["charging_state", "charging"]);
            n + if n > 0 && domain == "sensor" { 10 } else { 0 }
        }
        "power" if domain == "sensor" && ["W", "kW"].contains(&unit) => {
            suffix(&["charger_power", "charging_power"])
        }
        "odometer" if domain == "sensor" && ["mi", "km"].contains(&unit) => suffix(&["odometer"]),
        "temperature" if domain == "sensor" && ["°C", "°F"].contains(&unit) => suffix(&[
            "inside_temperature",
            "temperature_inside",
            "inside_temp",
            "cabin_temperature",
        ]),
        "lock"
            if domain == "lock"
                && !["charge", "cable", "port", "trunk", "frunk"]
                    .iter()
                    .any(|x| name.contains(x)) =>
        {
            suffix(&["lock", "doors", "door_lock"]).max(10)
        }
        "climate"
            if domain == "climate"
                && !["overheat", "protection", "seat"]
                    .iter()
                    .any(|x| name.contains(x)) =>
        {
            suffix(&["climate", "hvac"]).max(10)
        }
        "chargeSwitch"
            if domain == "switch"
                && !["scheduled", "solar", "port", "cable"]
                    .iter()
                    .any(|x| name.contains(x)) =>
        {
            suffix(&["charge", "charger", "charging", "charging_state"])
        }
        "softwareUpdate" if domain == "update" => {
            let n = suffix(&[
                "software_update",
                "software_update_status",
                "software",
                "firmware",
            ]);
            if n > 0 {
                n
            } else if name == "update" {
                100
            } else {
                0
            }
        }
        "shiftState" if domain == "sensor" => suffix(&["shift_state", "gear"]),
        "vehicleOnline" if domain == "binary_sensor" && class == "connectivity" => {
            suffix(&["status", "online"])
        }
        "cableConnected" if domain == "binary_sensor" => {
            suffix(&["charge_cable", "charger_connected"])
        }
        "chargeLimit" if domain == "number" && unit == "%" => suffix(&["charge_limit"]),
        "chargeCompleteAt" if domain == "sensor" && class == "timestamp" => {
            suffix(&["time_to_full_charge"])
        }
        _ => 0,
    }
}
pub fn validate_ids(ids: &BTreeMap<String, String>) -> bool {
    REQUIRED.iter().all(|k| ids.contains_key(*k))
        && ids.iter().all(|(role, id)| {
            let domains: &[&str] = match role.as_str() {
                "battery" | "range" | "power" | "odometer" | "temperature" | "shiftState"
                | "chargeCompleteAt" => &["sensor"],
                "charging" => &["sensor", "binary_sensor"],
                "lock" => &["lock"],
                "climate" => &["climate"],
                "chargeSwitch" => &["switch"],
                "softwareUpdate" => &["update"],
                "vehicleOnline" | "cableConnected" => &["binary_sensor"],
                "chargeLimit" => &["number"],
                _ => return false,
            };
            id.split_once('.').is_some_and(|(d, n)| {
                domains.contains(&d)
                    && !n.is_empty()
                    && n.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            })
        })
}
fn resolve<'a>(
    all: &'a [Entity],
    explicit: Option<&BTreeMap<String, String>>,
) -> Result<BTreeMap<String, &'a Entity>> {
    let mut candidates: Vec<_> = all.iter().collect();
    candidates.sort_by_key(|e| &e.entity_id);
    let mut found = BTreeMap::new();
    for role in REQUIRED.into_iter().chain(OPTIONAL) {
        let e = if let Some(ids) = explicit {
            ids.get(role)
                .and_then(|id| candidates.iter().find(|e| &e.entity_id == id).copied())
        } else {
            let mut best = 0;
            let mut chosen = None;
            for e in &candidates {
                let n = score(role, e);
                if n > best {
                    best = n;
                    chosen = Some(*e)
                }
            }
            chosen
        };
        if let Some(e) = e {
            found.insert(role.to_owned(), e);
        } else if REQUIRED.contains(&role) {
            return Err(unavailable());
        }
    }
    Ok(found)
}
fn number(e: &Entity) -> Result<f64> {
    e.state
        .trim()
        .parse::<f64>()
        .ok()
        .filter(|n| n.is_finite())
        .ok_or_else(unavailable)
}
fn distance(e: &Entity) -> Result<f64> {
    Ok(number(e)?
        / match attr(e, "unit_of_measurement") {
            Some("mi") => 1.0,
            Some("km") => 1.609344,
            _ => return Err(unavailable()),
        })
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    battery_percent: f64,
    range_miles: f64,
    charging_state: String,
    #[serde(rename = "chargePowerKW")]
    charge_power_k_w: f64,
    locked: bool,
    climate_on: bool,
    cabin_fahrenheit: f64,
    odometer_miles: f64,
    #[serde(flatten)]
    extras: BTreeMap<String, Value>,
}
impl Snapshot {
    fn valid(&self) -> bool {
        [
            (self.battery_percent, 0.0, 100.0),
            (self.range_miles, 0.0, 10000.0),
            (self.charge_power_k_w, 0.0, 1000.0),
            (self.cabin_fahrenheit, -100.0, 250.0),
            (self.odometer_miles, 0.0, 10000000.0),
        ]
        .iter()
        .all(|(v, lo, hi)| v.is_finite() && (*lo..=*hi).contains(v))
            && [
                "charging",
                "stopped",
                "complete",
                "disconnected",
                "no_power",
                "starting",
            ]
            .contains(&self.charging_state.as_str())
    }
}
fn snapshot(ids: &BTreeMap<String, &Entity>) -> Result<Snapshot> {
    let battery = ids["battery"];
    let temp = ids["temperature"];
    let power = ids["power"];
    let lock = ids["lock"];
    let climate = ids["climate"];
    let charging = ids["charging"];
    if attr(battery, "unit_of_measurement") != Some("%")
        || !["locked", "unlocked"].contains(&lock.state.as_str())
        || ![
            "off",
            "heat_cool",
            "heat",
            "cool",
            "auto",
            "dry",
            "fan_only",
        ]
        .contains(&climate.state.as_str())
    {
        return Err(unavailable());
    }
    let mut data = Snapshot {
        battery_percent: number(battery)?,
        range_miles: distance(ids["range"])?,
        charging_state: if charging.entity_id.starts_with("binary_sensor.") {
            match charging.state.as_str() {
                "on" => "charging",
                "off" => "stopped",
                _ => return Err(unavailable()),
            }
            .into()
        } else {
            charging
                .state
                .to_lowercase()
                .replace(' ', "_")
                .replace("nopower", "no_power")
        },
        charge_power_k_w: number(power)?
            / match attr(power, "unit_of_measurement") {
                Some("W") => 1000.0,
                Some("kW") => 1.0,
                _ => return Err(unavailable()),
            },
        locked: lock.state == "locked",
        climate_on: climate.state != "off",
        cabin_fahrenheit: match attr(temp, "unit_of_measurement") {
            Some("°C") => number(temp)? * 9.0 / 5.0 + 32.0,
            Some("°F") => number(temp)?,
            _ => return Err(unavailable()),
        },
        odometer_miles: distance(ids["odometer"])?,
        extras: BTreeMap::new(),
    };
    if !data.valid() {
        return Err(unavailable());
    }
    for (key, out) in [
        ("vehicleOnline", "vehicleOnline"),
        ("cableConnected", "cableConnected"),
    ] {
        if let Some(e) = ids.get(key) {
            match e.state.as_str() {
                "on" => {
                    data.extras.insert(out.into(), json!(true));
                }
                "off" => {
                    data.extras.insert(out.into(), json!(false));
                }
                _ => {}
            }
        }
    }
    if let Some(e) = ids.get("shiftState") {
        let state = match e.state.trim().to_lowercase().as_str() {
            "p" => Some("parked"),
            "d" => Some("driving"),
            "r" => Some("reversing"),
            "n" => Some("neutral"),
            _ => None,
        };
        if let Some(v) = state {
            data.extras.insert("driveState".into(), json!(v));
        }
    }
    if let Some(e) = ids.get("chargeLimit")
        && attr(e, "unit_of_measurement") == Some("%")
        && let Ok(n) = number(e)
        && (0.0..=100.0).contains(&n)
    {
        data.extras.insert("chargeLimitPercent".into(), json!(n));
    }
    if let Some(e) = ids.get("chargeCompleteAt")
        && let Ok(t) = chrono::DateTime::parse_from_rfc3339(&e.state)
    {
        data.extras
            .insert("chargeCompleteAt".into(), json!(t.to_rfc3339()));
    }
    if let Some(e) = ids.get("softwareUpdate") {
        let progress = e.attributes.get("in_progress");
        let status = if progress == Some(&json!(true))
            || progress
                .and_then(Value::as_f64)
                .is_some_and(|n| (0.0..=100.0).contains(&n))
        {
            Some("installing")
        } else {
            match e.state.as_str() {
                "on" => Some("available"),
                "off" => Some("up_to_date"),
                _ => None,
            }
        };
        if let Some(status) = status {
            let mut v = json!({"status":status});
            for (from, to) in [
                ("installed_version", "installedVersion"),
                ("latest_version", "latestVersion"),
            ] {
                if let Some(s) = attr(e, from) {
                    v[to] = json!(s);
                }
            }
            data.extras.insert("softwareUpdate".into(), v);
        }
    }
    Ok(data)
}
async fn live(s: &AppState) -> Result<Snapshot> {
    let all = s
        .config
        .ha
        .as_ref()
        .ok_or_else(unavailable)?
        .states()
        .await
        .map_err(|_| unavailable())?;
    snapshot(&resolve(&all, s.config.tesla_entities.as_ref())?)
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    if s.config.ha.is_none() {
        return Ok(Json(json!({"status":"unconfigured","data":null})));
    }
    if let Ok(data) = live(&s).await {
        let time = now();
        if sqlx::query("INSERT INTO device_state(id,kind,entity_id,domain,label,reported_state,reported_at_utc,available,created_at_utc,updated_at_utc) VALUES(?,'vehicle','tesla.vehicle','tesla','Tesla',?,?,1,?,?) ON CONFLICT(entity_id) DO UPDATE SET reported_state=excluded.reported_state,reported_at_utc=excluded.reported_at_utc,available=1,updated_at_utc=excluded.updated_at_utc").bind(crate::id("dev")).bind(serde_json::to_string(&data).map_err(|_|unavailable())?).bind(&time).bind(&time).bind(&time).execute(&s.db).await.is_err(){tracing::warn!(integration="tesla","could not persist telemetry");}
        return Ok(Json(
            json!({"status":"ready","data":data,"stale":false,"lastUpdatedAt":time}),
        ));
    }
    let row=sqlx::query("SELECT reported_state,reported_at_utc FROM device_state WHERE entity_id='tesla.vehicle' AND kind='vehicle'").fetch_optional(&s.db).await?;
    if let Some(row) = row {
        let raw: Option<String> = row.get("reported_state");
        let time: Option<String> = row.get("reported_at_utc");
        if let (Some(data), Some(time)) = (
            raw.and_then(|v| serde_json::from_str::<Snapshot>(&v).ok())
                .filter(Snapshot::valid),
            time,
        ) {
            return Ok(Json(
                json!({"status":"ready","data":data,"stale":true,"lastUpdatedAt":time}),
            ));
        }
    }
    Ok(Json(json!({"status":"unavailable","data":null})))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action {
    Lock,
    Unlock,
    ClimateOn,
    ClimateOff,
    ChargeStart,
    ChargeStop,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    action: Action,
    pin: String,
}
pub async fn command(State(s): State<AppState>, Json(cmd): Json<Command>) -> Result<Json<Value>> {
    super::settings::verify_pin(&s, &cmd.pin).await?;
    let ha = s.config.ha.as_ref().ok_or_else(unavailable)?;
    let all = ha.states().await.map_err(|_| unavailable())?;
    let ids = resolve(&all, s.config.tesla_entities.as_ref())?;
    let (domain, service, role) = match cmd.action {
        Action::Lock => ("lock", "lock", "lock"),
        Action::Unlock => ("lock", "unlock", "lock"),
        Action::ClimateOn => ("climate", "turn_on", "climate"),
        Action::ClimateOff => ("climate", "turn_off", "climate"),
        Action::ChargeStart => ("switch", "turn_on", "chargeSwitch"),
        Action::ChargeStop => ("switch", "turn_off", "chargeSwitch"),
    };
    ha.call(domain, service, json!({"entity_id":ids[role].entity_id}))
        .await
        .map_err(|_| unavailable())?;
    Ok(Json(json!({"accepted":true})))
}
