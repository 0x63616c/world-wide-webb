use crate::{
    AppState,
    http::{ApiError, Result},
    now,
};
use axum::{Json, extract::State, http::StatusCode};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::FromRow;
use std::collections::HashMap;

struct Entry {
    id: &'static str,
    entity: &'static str,
    name: &'static str,
    bedroom: bool,
    lamp: bool,
}
const LIGHTS: [Entry; 10] = [
    Entry {
        id: "living-globe",
        entity: "light.living_room_globe",
        name: "Globe",
        bedroom: false,
        lamp: true,
    },
    Entry {
        id: "living-corner",
        entity: "light.living_room_corner_lamp",
        name: "Corner Lamp",
        bedroom: false,
        lamp: true,
    },
    Entry {
        id: "living-floor",
        entity: "light.living_room_floor_lamp",
        name: "Floor Lamp",
        bedroom: false,
        lamp: true,
    },
    Entry {
        id: "kitchen-lamp",
        entity: "light.kitchen_lamp",
        name: "Lamp",
        bedroom: false,
        lamp: true,
    },
    Entry {
        id: "desk",
        entity: "light.desk",
        name: "Desk",
        bedroom: false,
        lamp: true,
    },
    Entry {
        id: "bed-left",
        entity: "light.bed_lamp_left",
        name: "Bed Left",
        bedroom: true,
        lamp: true,
    },
    Entry {
        id: "bed-right",
        entity: "light.bed_lamp_right",
        name: "Bed Right",
        bedroom: true,
        lamp: true,
    },
    Entry {
        id: "mirror",
        entity: "light.mirror",
        name: "Mirror",
        bedroom: true,
        lamp: true,
    },
    Entry {
        id: "overhead",
        entity: "switch.overhead_lights",
        name: "Overhead",
        bedroom: false,
        lamp: false,
    },
    Entry {
        id: "under-cabinet",
        entity: "switch.under_cabinet",
        name: "Cabinet",
        bedroom: false,
        lamp: false,
    },
];
const MOOD: [[u8; 3]; 8] = [
    [148, 0, 211],
    [75, 0, 130],
    [0, 90, 255],
    [255, 0, 144],
    [0, 200, 180],
    [120, 40, 220],
    [0, 160, 255],
    [220, 0, 255],
];
const PARTY: [[u8; 3]; 6] = [
    [255, 0, 0],
    [255, 140, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [255, 0, 255],
];
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Light {
    on: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    brightness: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    color: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    transition_seconds: Option<f64>,
}
#[derive(FromRow)]
struct Row {
    entity_id: String,
    desired_state: Option<String>,
    reported_state: Option<String>,
    desired_at_utc: Option<String>,
    desired_until_utc: Option<String>,
    available: bool,
    reported_at_utc: Option<String>,
}
fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Lights unavailable",
    }
}
fn parse(raw: Option<&str>) -> Result<Option<Light>> {
    raw.map(serde_json::from_str)
        .transpose()
        .map_err(|_| unavailable())
}
fn xy(rgb: [u8; 3]) -> [f64; 2] {
    let c = rgb.map(|v| {
        let n = f64::from(v) / 255.0;
        if n <= 0.04045 {
            n / 12.92
        } else {
            ((n + 0.055) / 1.055).powf(2.4)
        }
    });
    let x = c[0] * 0.4124 + c[1] * 0.3576 + c[2] * 0.1805;
    let y = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
    let z = c[0] * 0.0193 + c[1] * 0.1192 + c[2] * 0.9505;
    if x + y + z == 0.0 {
        [0.0, 0.0]
    } else {
        [
            (x / (x + y + z) * 1000.0).round() / 1000.0,
            (y / (x + y + z) * 1000.0).round() / 1000.0,
        ]
    }
}
fn hex(s: &str) -> Result<[u8; 3]> {
    if s.len() != 7 || !s.starts_with('#') || !s[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(ApiError::bad("Invalid color"));
    }
    Ok([
        u8::from_str_radix(&s[1..3], 16).map_err(|_| ApiError::bad("Invalid color"))?,
        u8::from_str_radix(&s[3..5], 16).map_err(|_| ApiError::bad("Invalid color"))?,
        u8::from_str_radix(&s[5..7], 16).map_err(|_| ApiError::bad("Invalid color"))?,
    ])
}
fn color_equal(a: &Value, b: &Value) -> bool {
    if let Some(k) = a.get("kelvin").and_then(Value::as_f64) {
        return b
            .get("kelvin")
            .and_then(Value::as_f64)
            .is_some_and(|v| (k - v).abs() <= 250.0);
    }
    for (key, tolerance) in [("xy", 0.005), ("rgb", 12.0)] {
        if let Some(v) = a.get(key).and_then(Value::as_array) {
            return b.get(key).and_then(Value::as_array).is_some_and(|w| {
                v.len() == w.len()
                    && v.iter().zip(w).all(|(a, b)| {
                        a.as_f64()
                            .zip(b.as_f64())
                            .is_some_and(|(a, b)| (a - b).abs() <= tolerance)
                    })
            });
        }
    }
    false
}
fn converged(d: &Light, r: &Light) -> bool {
    d.on == r.on
        && (!d.on
            || d.brightness
                .zip(r.brightness)
                .is_none_or(|(a, b)| (a - b).abs() <= 3.0)
                && d.color
                    .as_ref()
                    .is_none_or(|a| r.color.as_ref().is_some_and(|b| color_equal(a, b))))
}
fn effective(r: &Row) -> Result<Light> {
    let p = parse(r.reported_state.as_deref())?.unwrap_or_default();
    Ok(match parse(r.desired_state.as_deref())? {
        Some(d) => Light {
            brightness: d.brightness.or(p.brightness),
            color: d.color.or(p.color),
            ..d
        },
        None => p,
    })
}
fn reachable(r: &Row) -> bool {
    r.available
        && r.reported_at_utc
            .as_ref()
            .and_then(|v| chrono::DateTime::parse_from_rfc3339(v).ok())
            .is_some_and(|t| Utc::now().signed_duration_since(t).num_seconds() < 30)
}
async fn rows(s: &AppState) -> Result<Vec<Row>> {
    Ok(
        sqlx::query_as("SELECT * FROM device_state WHERE kind IN ('light','switch')")
            .fetch_all(&s.db)
            .await?,
    )
}
async fn preferences(s: &AppState) -> Result<HashMap<String, (String, Option<String>)>> {
    Ok(
        sqlx::query_as::<_, (String, String, Option<String>)>(
            "SELECT id,mode,speed FROM lamp_mode",
        )
        .fetch_all(&s.db)
        .await?
        .into_iter()
        .map(|(a, b, c)| (a, (b, c)))
        .collect(),
    )
}
fn saved(p: &HashMap<String, (String, Option<String>)>) -> Vec<Value> {
    [
        ("red", "Red", "#ff0000"),
        ("blue", "Blue", "#0066ff"),
        ("custom", "Custom", "#8b5cf6"),
    ]
    .iter()
    .map(|(slot, label, default)| {
        let v = p
            .get(&format!("color:{slot}"))
            .map(|v| v.0.as_str())
            .filter(|v| hex(v).is_ok())
            .unwrap_or(default);
        json!({"slot":slot,"label":label,"hex":v})
    })
    .collect()
}
fn kelvin(p: &HashMap<String, (String, Option<String>)>) -> i64 {
    p.get("white:kelvin")
        .and_then(|v| v.0.parse::<i64>().ok())
        .unwrap_or(2700)
        .clamp(2000, 6500)
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    let data = rows(&s).await?;
    if !data.iter().any(reachable) {
        return Err(unavailable());
    }
    let map: HashMap<_, _> = data.iter().map(|r| (r.entity_id.as_str(), r)).collect();
    let p = preferences(&s).await?;
    let saved = saved(&p);
    let mut lamps = vec![];
    let mut on = HashMap::new();
    let mut colors = vec![];
    let mut brightness = vec![];
    for e in &LIGHTS {
        let r = map.get(e.entity);
        let state = r.map(|r| effective(r)).transpose()?.unwrap_or_default();
        let active = r.is_some_and(|r| reachable(r)) && state.on;
        on.insert(e.id, active);
        if e.lamp {
            let pct = (state.brightness.unwrap_or(0.0) / 255.0 * 100.0)
                .round()
                .clamp(0.0, 100.0);
            let mut v = json!({"id":e.id,"name":e.name,"on":active,"brightness":pct});
            if let Some(c) = &state.color {
                v["color"] = c.clone();
            }
            lamps.push(v);
            if active {
                brightness.push(pct);
                colors.push(state.color);
            }
        }
    }
    let group = |name: &str| -> bool {
        LIGHTS
            .iter()
            .filter(|e| selected(e, name))
            .any(|e| on[e.id])
    };
    let party = p.get("singleton").is_some_and(|v| v.0 == "party");
    let mut slot: Option<&str> = None;
    for v in &saved {
        let c = json!({"xy":xy(hex(v["hex"].as_str().unwrap_or("")).map_err(|_|unavailable())?)});
        if !colors.is_empty()
            && colors
                .iter()
                .all(|v| v.as_ref().is_some_and(|v| color_equal(&c, v)))
        {
            slot = v["slot"].as_str();
        }
    }
    let active_scene = if party {
        Some("party")
    } else if colors.is_empty() {
        None
    } else if colors
        .iter()
        .all(|c| c.as_ref().is_some_and(|v| v.get("kelvin").is_some()))
    {
        Some("white")
    } else if colors.iter().all(|c| {
        c.as_ref()
            .is_some_and(|v| color_equal(&json!({"xy":xy([255,0,0])}), v))
    }) {
        Some("red")
    } else if colors.iter().all(|c| {
        c.as_ref()
            .is_some_and(|v| color_equal(&json!({"xy":xy([0,0,255])}), v))
    }) {
        Some("blue")
    } else if colors.iter().all(|c| {
        c.as_ref().is_some_and(|v| {
            MOOD.iter()
                .any(|rgb| color_equal(&json!({"xy":xy(*rgb)}), v))
        })
    }) {
        Some("mood")
    } else {
        None
    };
    let mut lamp = json!({"perLamp":lamps,"on":group("lamps"),"count":brightness.len(),"brightness":if brightness.is_empty(){0.0}else{(brightness.iter().sum::<f64>()/brightness.len() as f64).round()},"sub":if group("lamps"){"On"}else{"Off"},"pending":false,"activeScene":active_scene,"whiteKelvin":kelvin(&p),"savedColors":saved});
    if party {
        lamp["speed"] = json!(
            p.get("singleton")
                .and_then(|v| v.1.as_deref())
                .unwrap_or("medium")
        );
    } else if let Some(slot) = slot {
        lamp["colorSlot"] = json!(slot);
    }
    let fan = super::climate::fan(&s).await?;
    Ok(Json(
        json!({"lamps":lamp,"lights":{"on":group("lights"),"pending":false},"fan":fan,
  "bedroomLamps":{"on":group("bedroomLamps"),"pending":false},"otherLamps":{"on":group("otherLamps"),"pending":false},
  "ceiling":{"on":group("ceiling"),"pending":false},"cabinet":{"on":group("cabinet"),"pending":false},
  "all":{"on":LIGHTS.iter().all(|e|on[e.id]),"pending":false}}),
    ))
}
fn selected(e: &Entry, key: &str) -> bool {
    match key {
        "lamps" => e.lamp,
        "lights" => !e.lamp,
        "bedroomLamps" => e.lamp && e.bedroom,
        "otherLamps" => e.lamp && !e.bedroom,
        "ceiling" => e.id == "overhead",
        "cabinet" => e.id == "under-cabinet",
        "all" => true,
        _ => false,
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Toggle { key: String, on: bool },
    Scene { scene: String },
    Color { slot: String, hex: Option<String> },
    WhiteKelvin { kelvin: i64 },
    Brightness { pct: i64 },
    Mode { mode: String, speed: Option<String> },
    Fan { mode: String },
}
async fn set_preference(
    tx: &mut sqlx::SqliteConnection,
    id: &str,
    value: &str,
    speed: Option<&str>,
) -> Result<()> {
    sqlx::query("INSERT INTO lamp_mode(id,mode,speed,updated_at_utc) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,speed=excluded.speed,updated_at_utc=excluded.updated_at_utc")
 .bind(id).bind(value).bind(speed).bind(now()).execute(tx).await?;
    Ok(())
}
pub async fn command(State(s): State<AppState>, Json(c): Json<Command>) -> Result<Json<Value>> {
    if s.config.ha.is_none() {
        return Err(unavailable());
    }
    if let Command::Fan { mode } = c {
        super::climate::set_fan(&s, mode).await?;
        return get(State(s)).await;
    }
    if let Command::Toggle { ref key, on } = c {
        if key == "fan" {
            super::climate::set_fan(&s, if on { "on" } else { "auto" }.into()).await?;
            return get(State(s)).await;
        }
    }
    let _gate = s.light_gate.lock().await;
    let old = rows(&s).await?;
    if !old.iter().any(reachable) {
        return Err(unavailable());
    }
    let map: HashMap<_, _> = old.iter().map(|r| (r.entity_id.as_str(), r)).collect();
    let prefs = preferences(&s).await?;
    let mut group = "lamps";
    let mut on = None;
    let mut color: Option<Vec<Value>> = None;
    let mut brightness = None;
    let mut clear = false;
    let mut pref = None;
    let mut mode_pref = None;
    match c {
        Command::Toggle { ref key, on: value } => {
            if ![
                "lamps",
                "lights",
                "bedroomLamps",
                "otherLamps",
                "ceiling",
                "cabinet",
                "all",
            ]
            .contains(&key.as_str())
            {
                return Err(ApiError::bad("Unknown light group"));
            }
            group = key;
            on = Some(value);
            clear = !value && ["lamps", "all"].contains(&key.as_str());
        }
        Command::Scene { ref scene } => {
            color = Some(match scene.as_str() {
                "white" => vec![json!({"kelvin":kelvin(&prefs)}); 8],
                "red" => {
                    brightness = Some(255.0);
                    vec![json!({"xy":xy([255,0,0])}); 8]
                }
                "blue" => vec![json!({"xy":xy([0,0,255])}); 8],
                "mood" => {
                    let mut palette = MOOD;
                    for i in (1..palette.len()).rev() {
                        let seed = uuid::Uuid::new_v4().as_u128();
                        palette.swap(i, (seed % (i as u128 + 1)) as usize);
                    }
                    palette.iter().map(|v| json!({"xy":xy(*v)})).collect()
                }
                _ => return Err(ApiError::bad("Invalid scene")),
            });
            on = Some(true);
            clear = true;
        }
        Command::Color { ref slot, ref hex } => {
            if !["red", "blue", "custom"].contains(&slot.as_str()) {
                return Err(ApiError::bad("Invalid color slot"));
            }
            let colors = saved(&prefs);
            let value = hex.as_deref().unwrap_or_else(|| {
                colors
                    .iter()
                    .find(|c| c["slot"] == slot.as_str())
                    .and_then(|c| c["hex"].as_str())
                    .unwrap_or("")
            });
            let rgb = self::hex(value)?;
            pref = Some((format!("color:{slot}"), value.to_lowercase()));
            color = Some(vec![json!({"xy":xy(rgb)}); 8]);
            on = Some(true);
            clear = true;
        }
        Command::WhiteKelvin { kelvin: value } => {
            let value = value.clamp(2000, 6500);
            pref = Some(("white:kelvin".into(), value.to_string()));
            if old
                .iter()
                .filter(|r| r.entity_id.starts_with("light."))
                .any(|r| effective(r).is_ok_and(|l| l.on))
            {
                color = Some(vec![json!({"kelvin":value}); 8]);
                clear = true;
            }
        }
        Command::Brightness { pct } => {
            if !(0..=100).contains(&pct) {
                return Err(ApiError::bad("Invalid brightness"));
            }
            brightness = Some((pct as f64 / 100.0 * 255.0).round());
            on = Some(pct > 0);
        }
        Command::Mode {
            ref mode,
            ref speed,
        } => {
            if !["none", "party"].contains(&mode.as_str())
                || speed
                    .as_ref()
                    .is_some_and(|s| !["slow", "medium", "fast"].contains(&s.as_str()))
            {
                return Err(ApiError::bad("Invalid mode"));
            }
            mode_pref = Some((mode.as_str(), speed.as_deref().unwrap_or("medium")));
            if mode == "party" {
                on = Some(true);
            }
        }
        Command::Fan { .. } => unreachable!(),
    }
    let mut tx = s.db.begin().await?;
    if clear {
        set_preference(&mut tx, "singleton", "none", None).await?;
    }
    if let Some((id, value)) = pref {
        set_preference(&mut tx, &id, &value, None).await?;
    }
    if let Some((mode, speed)) = mode_pref {
        set_preference(&mut tx, "singleton", mode, Some(speed)).await?;
    }
    if on.is_some() || brightness.is_some() || color.is_some() {
        let at = Utc::now();
        let stamp = at.to_rfc3339_opts(SecondsFormat::Micros, true);
        let until =
            (at + chrono::Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Micros, true);
        for (i, e) in LIGHTS
            .iter()
            .enumerate()
            .filter(|(_, e)| selected(e, group))
        {
            let old = map.get(e.entity).ok_or_else(unavailable)?;
            let mut v = effective(old)?;
            if let Some(on) = on {
                v.on = on;
            }
            if let Some(b) = brightness {
                v.brightness = Some(b);
            }
            if let Some(colors) = &color {
                v.color = Some(colors[i].clone());
                v.transition_seconds = None;
            }
            let changed=sqlx::query("UPDATE device_state SET desired_state=?,desired_at_utc=?,desired_until_utc=?,updated_at_utc=? WHERE entity_id=? AND desired_at_utc IS ?")
    .bind(serde_json::to_string(&v).map_err(|_|unavailable())?).bind(&stamp).bind(&until).bind(&stamp).bind(e.entity).bind(&old.desired_at_utc).execute(&mut *tx).await?;
            if changed.rows_affected() != 1 {
                return Err(ApiError {
                    status: StatusCode::CONFLICT,
                    message: "Lights changed; refresh and retry",
                });
            }
        }
    }
    tx.commit().await?;
    drop(_gate);
    get(State(s)).await
}

pub async fn reconcile(s: &AppState) -> Result<()> {
    let _gate = s.light_gate.lock().await;
    let ha = s.config.ha.as_ref().ok_or_else(unavailable)?;
    let entities = match ha.states().await {
        Ok(v) => v,
        Err(_) => {
            sqlx::query("UPDATE device_state SET available=0 WHERE kind IN ('light','switch')")
                .execute(&s.db)
                .await?;
            return Err(unavailable());
        }
    };
    let old = rows(s).await?;
    let map: HashMap<_, _> = old.iter().map(|r| (r.entity_id.as_str(), r)).collect();
    for e in &LIGHTS {
        let entity = entities.iter().find(|v| v.entity_id == e.entity);
        let Some(entity) =
            entity.filter(|v| !["unknown", "unavailable"].contains(&v.state.as_str()))
        else {
            sqlx::query("UPDATE device_state SET available=0 WHERE entity_id=?")
                .bind(e.entity)
                .execute(&s.db)
                .await?;
            continue;
        };
        let reported = reported_light(entity);
        let stamp = now();
        let value = serde_json::to_string(&reported).map_err(|_| unavailable())?;
        if let Some(old) = map.get(e.entity) {
            let desired = parse(old.desired_state.as_deref())?;
            let window = old
                .desired_until_utc
                .as_ref()
                .is_some_and(|until| until > &stamp);
            let mut adopt = None;
            match desired {
                None => adopt = Some(value.clone()),
                Some(wanted) if !converged(&wanted, &reported) => {
                    if e.lamp || window {
                        let mut payload = json!({"entity_id":e.entity});
                        if wanted.on && e.lamp {
                            if let Some(b) = wanted.brightness {
                                payload["brightness"] = json!(b.round().clamp(0.0, 255.0));
                            }
                            if let Some(c) = wanted.color {
                                for (src, dest) in [
                                    ("xy", "xy_color"),
                                    ("rgb", "rgb_color"),
                                    ("kelvin", "color_temp_kelvin"),
                                ] {
                                    if let Some(v) = c.get(src) {
                                        payload[dest] = v.clone();
                                    }
                                }
                            }
                            if let Some(t) = wanted.transition_seconds {
                                payload["transition"] = json!(t);
                            }
                        }
                        ha.call(
                            if e.lamp { "light" } else { "switch" },
                            if wanted.on { "turn_on" } else { "turn_off" },
                            payload,
                        )
                        .await
                        .map_err(|_| unavailable())?;
                    } else {
                        adopt = Some(value.clone());
                    }
                }
                _ => {}
            }
            sqlx::query("UPDATE device_state SET reported_changed_at_utc=CASE WHEN reported_state IS NOT ? THEN ? ELSE reported_changed_at_utc END,reported_state=?,reported_at_utc=?,available=1,updated_at_utc=?,desired_state=CASE WHEN desired_at_utc IS ? THEN coalesce(?,desired_state) ELSE desired_state END,desired_at_utc=CASE WHEN desired_at_utc IS ? AND ? IS NOT NULL THEN ? ELSE desired_at_utc END WHERE entity_id=?")
    .bind(&value).bind(&stamp).bind(&value).bind(&stamp).bind(&stamp).bind(&old.desired_at_utc).bind(&adopt).bind(&old.desired_at_utc).bind(&adopt).bind(&stamp).bind(e.entity).execute(&s.db).await?;
        } else {
            sqlx::query("INSERT INTO device_state(id,kind,entity_id,domain,label,reported_state,reported_at_utc,reported_changed_at_utc,desired_state,desired_at_utc,available,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?,1,?,?)")
    .bind(e.id).bind(if e.lamp{"light"}else{"switch"}).bind(e.entity).bind(if e.lamp{"light"}else{"switch"}).bind(e.name).bind(&value).bind(&stamp).bind(&stamp).bind(&value).bind(&stamp).bind(&stamp).bind(&stamp).execute(&s.db).await?;
        }
    }
    Ok(())
}
#[derive(Default)]
pub struct PartyClock {
    last: Option<std::time::Instant>,
    tick: usize,
}
pub async fn party(s: &AppState, clock: &mut PartyClock) -> Result<()> {
    let _gate = s.light_gate.lock().await;
    let p = preferences(s).await?;
    let Some((mode, speed)) = p.get("singleton") else {
        return Ok(());
    };
    if mode != "party" {
        clock.last = None;
        return Ok(());
    }
    let (seconds, fade) = match speed.as_deref() {
        Some("slow") => (16, 14.0),
        Some("fast") => (4, 3.5),
        _ => (8, 7.0),
    };
    if clock
        .last
        .is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(seconds))
    {
        return Ok(());
    }
    let mut tx = s.db.begin().await?;
    // Check the mode inside the write transaction so a manual scene cannot be overwritten by an old tick.
    let current: Option<String> =
        sqlx::query_scalar("SELECT mode FROM lamp_mode WHERE id='singleton'")
            .fetch_optional(&mut *tx)
            .await?;
    if current.as_deref() != Some("party") {
        return Ok(());
    }
    for (i, e) in LIGHTS.iter().filter(|e| e.lamp).enumerate() {
        let desired: Option<String> =
            sqlx::query_scalar("SELECT desired_state FROM device_state WHERE entity_id=?")
                .bind(e.entity)
                .fetch_optional(&mut *tx)
                .await?
                .flatten();
        if let Some(mut light) = parse(desired.as_deref())? {
            if light.on {
                light.color = Some(json!({"xy":xy(PARTY[(i+clock.tick)%PARTY.len()])}));
                light.transition_seconds = Some(fade);
                let stamp = now();
                sqlx::query("UPDATE device_state SET desired_state=?,desired_at_utc=?,updated_at_utc=? WHERE entity_id=?")
    .bind(serde_json::to_string(&light).map_err(|_|unavailable())?).bind(&stamp).bind(&stamp).bind(e.entity).execute(&mut *tx).await?;
            }
        }
    }
    tx.commit().await?;
    clock.last = Some(std::time::Instant::now());
    clock.tick = clock.tick.wrapping_add(1);
    Ok(())
}

/// Input watermark and all three lamp intents commit together. Reconnects and
/// invalid samples rebaseline; only a contiguous HA old/new edge can act.
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct InputSample {
    state: String,
    changed: String,
    #[serde(default)]
    acted_at: Option<i64>,
}
fn input_sample(
    entity: Option<&crate::integrations::homeassistant::Entity>,
    id: &str,
) -> Option<InputSample> {
    let e = entity?;
    if e.entity_id != id
        || !["on", "off"].contains(&e.state.as_str())
        || e.attributes.get("restored") == Some(&json!(true))
    {
        return None;
    }
    let raw = e.last_changed.as_deref()?;
    if !(raw.ends_with('Z') || raw.ends_with("+00:00")) {
        return None;
    }
    let time = chrono::DateTime::parse_from_rfc3339(raw).ok()?;
    if time.timestamp_subsec_nanos() % 1000 != 0 {
        return None;
    }
    Some(InputSample {
        state: e.state.clone(),
        changed: time
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Micros, true),
        acted_at: None,
    })
}
#[derive(Default)]
pub struct BedroomInput {
    previous: Option<InputSample>,
}
impl BedroomInput {
    pub async fn sample(
        &mut self,
        s: &AppState,
        id: &str,
        current: Option<&crate::integrations::homeassistant::Entity>,
        snapshot: bool,
        old: Option<&crate::integrations::homeassistant::Entity>,
    ) -> Result<()> {
        let Some(next) = input_sample(current, id) else {
            self.previous = None;
            return Ok(());
        };
        let _gate = s.light_gate.lock().await;
        let mut tx = s.db.begin().await?;
        let saved: Option<String> =
            sqlx::query_scalar("SELECT value FROM input_checkpoint WHERE entity_id=?")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        let saved = saved
            .map(|v| serde_json::from_str::<InputSample>(&v))
            .transpose()
            .map_err(|_| unavailable())?;
        if saved.as_ref().is_some_and(|v| next.changed <= v.changed) {
            if self
                .previous
                .as_ref()
                .is_none_or(|v| next.changed > v.changed)
            {
                self.previous = Some(next);
            }
            return Ok(());
        }
        let old = input_sample(old, id);
        let edge = !snapshot
            && self
                .previous
                .as_ref()
                .zip(old.as_ref())
                .is_some_and(|(before, old)| {
                    before.changed == old.changed
                        && before.state == old.state
                        && before.state != next.state
                        && before.changed < next.changed
                });
        let changed = chrono::DateTime::parse_from_rfc3339(&next.changed)
            .map_err(|_| unavailable())?
            .timestamp_millis();
        let mut next = next;
        next.acted_at = saved.as_ref().and_then(|v| v.acted_at);
        if edge && next.acted_at.is_none_or(|at| changed - at >= 150) {
            let mut values = vec![];
            for e in LIGHTS.iter().filter(|e| e.bedroom && e.lamp) {
                let raw: Option<String> =
                    sqlx::query_scalar("SELECT desired_state FROM device_state WHERE entity_id=?")
                        .bind(e.entity)
                        .fetch_optional(&mut *tx)
                        .await?
                        .flatten();
                if let Some(v) = raw.and_then(|v| serde_json::from_str::<Light>(&v).ok()) {
                    values.push((e.entity, v));
                }
            }
            if values.len() == 3 {
                let on = !values.iter().any(|(_, v)| v.on);
                let stamp = now();
                let until = (Utc::now() + chrono::Duration::seconds(10))
                    .to_rfc3339_opts(SecondsFormat::Micros, true);
                for (entity, mut value) in values {
                    value.on = on;
                    sqlx::query("UPDATE device_state SET desired_state=?,desired_at_utc=?,desired_until_utc=?,updated_at_utc=? WHERE entity_id=?").bind(serde_json::to_string(&value).map_err(|_|unavailable())?).bind(&stamp).bind(&until).bind(&stamp).bind(entity).execute(&mut *tx).await?;
                }
                next.acted_at = Some(changed);
            }
        }
        sqlx::query("INSERT INTO input_checkpoint(entity_id,value) VALUES(?,?) ON CONFLICT(entity_id) DO UPDATE SET value=excluded.value").bind(id).bind(serde_json::to_string(&next).map_err(|_|unavailable())?).execute(&mut *tx).await?;
        tx.commit().await?;
        self.previous = Some(next);
        Ok(())
    }
}

fn reported_light(entity: &crate::integrations::homeassistant::Entity) -> Light {
    let a = &entity.attributes;
    let color = if a.get("color_mode").and_then(Value::as_str) == Some("color_temp") {
        a.get("color_temp_kelvin").map(|k| json!({"kelvin":k}))
    } else {
        a.get("xy_color")
            .map(|v| json!({"xy":v}))
            .or_else(|| a.get("rgb_color").map(|v| json!({"rgb":v})))
    };
    Light {
        on: entity.state == "on",
        brightness: a.get("brightness").and_then(Value::as_f64),
        color,
        transition_seconds: None,
    }
}

/// Alarm lighting shares command ordering with manual controls/input, while
/// releasing the SQLite writer before any Home Assistant call.
pub async fn alarm_lights(s: &AppState, target: &str) -> Result<()> {
    if !super::alarms::valid_target(target) {
        return Err(ApiError::bad("Invalid alarm light target"));
    }
    let _gate = s.light_gate.lock().await;
    let ha = s.config.ha.as_ref().ok_or_else(unavailable)?;
    let scene = target.starts_with("scene.");
    let values: Vec<(String, Light)> = if scene {
        let all = ha.states().await.map_err(|_| unavailable())?;
        let members = all
            .iter()
            .find(|e| e.entity_id == target)
            .and_then(|e| e.attributes.get("entity_id"))
            .and_then(Value::as_array)
            .filter(|a| a.iter().all(Value::is_string))
            .ok_or_else(unavailable)?;
        let members: Vec<_> = members
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        ha.call("scene", "turn_on", json!({"entity_id":target}))
            .await
            .map_err(|_| unavailable())?;
        let all = ha.states().await.map_err(|_| unavailable())?;
        let mut values = vec![];
        for id in members {
            if LIGHTS.iter().any(|e| e.entity == id) {
                let entity = all
                    .iter()
                    .find(|e| e.entity_id == id && ["on", "off"].contains(&e.state.as_str()))
                    .ok_or_else(unavailable)?;
                values.push((id, reported_light(entity)));
            }
        }
        values
    } else {
        let old = rows(s).await?;
        let mut values = vec![];
        for entity in target.split(',') {
            if let Some(entry) = LIGHTS.iter().find(|e| e.entity == entity) {
                let mut value = old
                    .iter()
                    .find(|r| r.entity_id == entity)
                    .map(effective)
                    .transpose()?
                    .unwrap_or_default();
                value.on = true;
                if entry.lamp && value.brightness.unwrap_or(0.0) <= 0.0 {
                    value.brightness = Some(180.0)
                }
                values.push((entity.to_owned(), value));
            }
        }
        values
    };
    let mut tx = s.db.begin().await?;
    let stamp = now();
    let until =
        (Utc::now() + chrono::Duration::seconds(10)).to_rfc3339_opts(SecondsFormat::Micros, true);
    for (entity, value) in values {
        let entry = LIGHTS
            .iter()
            .find(|e| e.entity == entity)
            .ok_or_else(unavailable)?;
        sqlx::query("INSERT INTO device_state(id,kind,entity_id,domain,label,desired_state,desired_at_utc,desired_until_utc,created_at_utc,updated_at_utc) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_id) DO UPDATE SET desired_state=excluded.desired_state,desired_at_utc=excluded.desired_at_utc,desired_until_utc=excluded.desired_until_utc,updated_at_utc=excluded.updated_at_utc")
            .bind(entry.id).bind(if entry.lamp{"light"}else{"switch"}).bind(&entity).bind(if entry.lamp{"light"}else{"switch"}).bind(entry.name).bind(serde_json::to_string(&value).map_err(|_|unavailable())?).bind(&stamp).bind(&until).bind(&stamp).bind(&stamp).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    if !scene {
        for entity in target.split(',') {
            let domain = entity.split_once('.').ok_or_else(unavailable)?.0;
            ha.call(domain, "turn_on", json!({"entity_id":entity}))
                .await
                .map_err(|_| unavailable())?;
        }
    }
    Ok(())
}
