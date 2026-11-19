//! Wall switch behaviour chosen in Settings: per-switch mode, multi-flip gestures,
//! context ("smart") rules and the recent-flip log used to tune timing.
use crate::{
    AppState,
    http::{ApiError, Result},
    now,
};
use axum::{Json, extract::State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

/// The front door Shelly drives the overhead relay itself (flip mode); Control Center only listens.
pub const FRONT_DOOR_INPUT: &str = "binary_sensor.overhead_lights_input_0";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Switch {
    Bedroom,
    FrontDoor,
}
impl Switch {
    pub fn id(self) -> &'static str {
        match self {
            Self::Bedroom => "bedroom",
            Self::FrontDoor => "frontDoor",
        }
    }
    pub fn worker(self) -> &'static str {
        match self {
            Self::Bedroom => "bedroom-switch-input",
            Self::FrontDoor => "front-door-switch-input",
        }
    }
    fn name(self) -> &'static str {
        match self {
            Self::Bedroom => "Bedroom",
            Self::FrontDoor => "Front door",
        }
    }
}

/// Cumulative: each mode includes everything the previous one does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Off,
    Room,
    Gestures,
    Smart,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DoubleAction {
    None,
    ApartmentToggle,
    AllOff,
    AllOn,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TripleAction {
    None,
    Party,
    White,
    Red,
    Blue,
    Mood,
}

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Settings {
    pub bedroom_mode: Mode,
    pub front_door_mode: Mode,
    pub gesture_window_ms: i64,
    pub bounce_ms: i64,
    pub double_action: DoubleAction,
    pub include_relays: bool,
    pub triple_action: TripleAction,
    pub confirm_blink: bool,
    pub smart_alarm: bool,
    pub smart_party: bool,
    pub smart_night: bool,
    pub night_start: String,
    pub night_end: String,
    pub night_brightness: i64,
    pub night_kelvin: i64,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            bedroom_mode: Mode::Room,
            front_door_mode: Mode::Off,
            gesture_window_ms: 600,
            bounce_ms: 150,
            double_action: DoubleAction::ApartmentToggle,
            include_relays: true,
            triple_action: TripleAction::Party,
            confirm_blink: false,
            smart_alarm: true,
            smart_party: true,
            smart_night: true,
            night_start: "22:00".into(),
            night_end: "07:00".into(),
            night_brightness: 15,
            night_kelvin: 2200,
        }
    }
}
fn minutes(raw: &str) -> Option<u32> {
    let (h, m) = raw.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}
impl Settings {
    pub fn mode(&self, switch: Switch) -> Mode {
        match switch {
            Switch::Bedroom => self.bedroom_mode,
            Switch::FrontDoor => self.front_door_mode,
        }
    }
    fn validate(&self) -> Result<()> {
        if !(0..=2000).contains(&self.gesture_window_ms) {
            return Err(ApiError::bad("Gesture window must be 0–2000 ms"));
        }
        if !(0..=500).contains(&self.bounce_ms) {
            return Err(ApiError::bad("Bounce filter must be 0–500 ms"));
        }
        if minutes(&self.night_start).is_none() || minutes(&self.night_end).is_none() {
            return Err(ApiError::bad("Night times must be HH:MM"));
        }
        if !(1..=100).contains(&self.night_brightness) {
            return Err(ApiError::bad("Night brightness must be 1–100%"));
        }
        if !(2000..=6500).contains(&self.night_kelvin) {
            return Err(ApiError::bad("Night colour must be 2000–6500 K"));
        }
        Ok(())
    }
    /// Whether `minute` (minutes after local midnight) falls in the night window, which may wrap midnight.
    pub fn is_night(&self, minute: u32) -> bool {
        let (Some(start), Some(end)) = (minutes(&self.night_start), minutes(&self.night_end))
        else {
            return false;
        };
        if start <= end {
            (start..end).contains(&minute)
        } else {
            minute >= start || minute < end
        }
    }
}

pub async fn load(conn: &mut sqlx::SqliteConnection) -> Result<Settings> {
    let raw: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE id='wallSwitches'")
            .fetch_optional(&mut *conn)
            .await?;
    // A stored value from an older shape falls back to defaults rather than disabling the switches.
    Ok(raw
        .and_then(|v| serde_json::from_str(&v).ok())
        .unwrap_or_default())
}

/// What one accepted edge means, given the switch's gesture state before it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Gesture {
    Bounce,
    Flip(u8),
}
/// `gap` is the time since the last accepted edge; `count` how many flips that gesture had.
pub fn classify(settings: &Settings, mode: Mode, gap: Option<i64>, count: u8) -> Gesture {
    if gap.is_some_and(|g| g < settings.bounce_ms) {
        return Gesture::Bounce;
    }
    let continues = mode >= Mode::Gestures
        && settings.gesture_window_ms > 0
        && (1..3).contains(&count)
        && gap.is_some_and(|g| g <= settings.gesture_window_ms);
    Gesture::Flip(if continues { count + 1 } else { 1 })
}

pub async fn log(
    conn: &mut sqlx::SqliteConnection,
    switch: Switch,
    state: &str,
    changed: &str,
    gap: Option<i64>,
    gesture: &str,
    action: &str,
) -> Result<()> {
    sqlx::query("INSERT INTO switch_flip(switch_id,state,changed_at_utc,gap_ms,gesture,action) VALUES(?,?,?,?,?,?)")
        .bind(switch.id()).bind(state).bind(changed).bind(gap).bind(gesture).bind(action)
        .execute(&mut *conn).await?;
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(30))
        .to_rfc3339_opts(chrono::SecondsFormat::Micros, true);
    sqlx::query("DELETE FROM switch_flip WHERE changed_at_utc<?")
        .bind(cutoff)
        .execute(&mut *conn)
        .await?;
    Ok(())
}

/// id, switch, state, changed at, gap since the previous accepted edge, gesture, action.
type FlipRow = (i64, String, String, String, Option<i64>, String, String);
async fn snapshot(s: &AppState) -> Result<Value> {
    let mut conn = s.db.acquire().await?;
    let settings = load(&mut conn).await?;
    let flips: Vec<FlipRow> = sqlx::query_as(
        "SELECT id,switch_id,state,changed_at_utc,gap_ms,gesture,action FROM switch_flip ORDER BY changed_at_utc DESC,id DESC LIMIT 100",
    )
    .fetch_all(&mut *conn)
    .await?;
    let workers = s.workers.read().expect("worker lock").clone();
    let switches: Vec<Value> = [
        (Switch::Bedroom, s.config.bedroom_input.clone()),
        (
            Switch::FrontDoor,
            s.config.ha.as_ref().map(|_| FRONT_DOOR_INPUT.to_owned()),
        ),
    ]
    .into_iter()
    .map(|(sw, entity)| {
        let health = workers.get(sw.worker());
        json!({"id":sw.id(),"name":sw.name(),"entity":entity,
            "connected":health.is_some_and(|h| h.consecutive_failures==0 && h.last_run_at.is_some())})
    })
    .collect();
    Ok(json!({
        "settings": settings,
        "switches": switches,
        "flips": flips.into_iter().map(|(id,sw,state,at,gap,gesture,action)| json!({"id":id,"switch":sw,"state":state,"at":at,"gapMs":gap,"gesture":gesture,"action":action})).collect::<Vec<_>>(),
    }))
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    Ok(Json(snapshot(&s).await?))
}
pub async fn update(State(s): State<AppState>, Json(v): Json<Settings>) -> Result<Json<Value>> {
    v.validate()?;
    sqlx::query("INSERT INTO settings(id,value,updated_at_utc) VALUES('wallSwitches',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at_utc=excluded.updated_at_utc")
        .bind(serde_json::to_string(&v).map_err(|_| ApiError::bad("Invalid settings"))?)
        .bind(now())
        .execute(&s.db)
        .await?;
    Ok(Json(snapshot(&s).await?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gestures_count_inside_the_window_and_reset_outside() {
        let s = Settings::default();
        assert_eq!(classify(&s, Mode::Gestures, None, 0), Gesture::Flip(1));
        assert_eq!(classify(&s, Mode::Gestures, Some(100), 1), Gesture::Bounce);
        assert_eq!(classify(&s, Mode::Gestures, Some(400), 1), Gesture::Flip(2));
        assert_eq!(classify(&s, Mode::Gestures, Some(600), 2), Gesture::Flip(3));
        assert_eq!(classify(&s, Mode::Gestures, Some(400), 3), Gesture::Flip(1));
        assert_eq!(classify(&s, Mode::Gestures, Some(601), 1), Gesture::Flip(1));
        assert_eq!(classify(&s, Mode::Room, Some(400), 1), Gesture::Flip(1));
        let off = Settings {
            gesture_window_ms: 0,
            ..Settings::default()
        };
        assert_eq!(classify(&off, Mode::Smart, Some(400), 1), Gesture::Flip(1));
    }
    #[test]
    fn night_window_wraps_midnight() {
        let s = Settings::default();
        assert!(s.is_night(23 * 60));
        assert!(s.is_night(60));
        assert!(!s.is_night(7 * 60));
        assert!(!s.is_night(12 * 60));
        let day = Settings {
            night_start: "01:00".into(),
            night_end: "05:00".into(),
            ..Settings::default()
        };
        assert!(day.is_night(2 * 60) && !day.is_night(23 * 60));
    }
    #[test]
    fn validation_rejects_out_of_range_values() {
        assert!(Settings::default().validate().is_ok());
        for bad in [
            Settings {
                gesture_window_ms: 2001,
                ..Settings::default()
            },
            Settings {
                bounce_ms: -1,
                ..Settings::default()
            },
            Settings {
                night_start: "25:00".into(),
                ..Settings::default()
            },
            Settings {
                night_brightness: 0,
                ..Settings::default()
            },
        ] {
            assert!(bad.validate().is_err());
        }
    }
}
