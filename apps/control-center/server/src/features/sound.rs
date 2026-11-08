//! Sonos uses Home Assistant as its sole control plane. Read topology fresh;
//! never retry ambiguous physical writes.
use crate::{
    AppState,
    http::{ApiError, Result},
    integrations::homeassistant::Entity,
};
use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::BTreeMap;

fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Sound system unavailable",
    }
}
fn attr<'a>(e: &'a Entity, key: &str) -> Option<&'a str> {
    e.attributes.get(key)?.as_str().filter(|s| !s.is_empty())
}
fn members(e: &Entity) -> Vec<String> {
    e.attributes
        .get("group_members")
        .and_then(Value::as_array)
        .filter(|a| a.iter().all(Value::is_string))
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}
fn is_room(e: &Entity) -> bool {
    e.entity_id.starts_with("media_player.") && !members(e).is_empty()
}
async fn entities(s: &AppState) -> Result<Vec<Entity>> {
    s.config
        .ha
        .as_ref()
        .ok_or_else(unavailable)?
        .states()
        .await
        .map_err(|_| unavailable())
}
async fn baselines(s: &AppState) -> Result<BTreeMap<String, i64>> {
    Ok(
        sqlx::query("SELECT room_id,baseline FROM sound_calibration")
            .fetch_all(&s.db)
            .await?
            .into_iter()
            .map(|r| (r.get("room_id"), r.get("baseline")))
            .collect(),
    )
}
fn room(e: &Entity, all: &[Entity], calibration: &BTreeMap<String, i64>) -> Value {
    let group = members(e);
    let coordinator = &group[0];
    let playback = all
        .iter()
        .find(|p| &p.entity_id == coordinator)
        .unwrap_or(e);
    let source = attr(playback, "source");
    let lower = source.unwrap_or("").to_lowercase();
    let (kind, label) = if lower.is_empty() || lower == "idle" {
        ("idle", None)
    } else if lower.contains("line") {
        ("line-in", Some("Line-In"))
    } else if lower.contains("tv") {
        ("tv", Some("TV"))
    } else if lower.contains("spotify") {
        ("spotify", Some("Spotify"))
    } else if lower.contains("airplay") {
        ("airplay", Some("AirPlay"))
    } else {
        ("other", source)
    };
    let transport = match playback.state.as_str() {
        "playing" => "PLAYING",
        "paused" => "PAUSED_PLAYBACK",
        "unavailable" => "UNAVAILABLE",
        "unknown" => "UNKNOWN",
        _ => "STOPPED",
    };
    let availability = match e.state.as_str() {
        "unavailable" => "unavailable",
        "unknown" => "unknown",
        _ => "available",
    };
    let own = coordinator == &e.entity_id;
    let mut result = json!({
        "name":attr(e,"friendly_name").unwrap_or(e.entity_id.trim_start_matches("media_player.")),
        "uuid":e.entity_id,"deviceIp":e.entity_id,"coordinatorUuid":coordinator,"memberUuids":group,"isCoordinator":own,
        "volume":e.attributes.get("volume_level").and_then(Value::as_f64).map(|v|(v*100.0).round() as i64).unwrap_or(0),
        "baseline":calibration.get(&e.entity_id),"muted":e.attributes.get("is_volume_muted").and_then(Value::as_bool).unwrap_or(false),
        "transportState":transport,"sourceLabel":label,"sourceKind":kind,
        "trackTitle":attr(playback,"media_title"),"trackArtist":attr(playback,"media_artist"),"albumArtUri":attr(playback,"entity_picture"),
        "availability":availability,"groupStatus":if own { "Standalone".to_owned() } else { format!("Following {}",coordinator.trim_start_matches("media_player.")) }
    });
    if !["unavailable", "unknown", "off"].contains(&e.state.as_str())
        && !["unavailable", "unknown", "off"].contains(&playback.state.as_str())
    {
        for (key, out) in [
            ("media_position", "position"),
            ("media_duration", "duration"),
        ] {
            if let Some(n) = playback
                .attributes
                .get(key)
                .and_then(Value::as_f64)
                .filter(|n| n.is_finite() && *n >= 0.0)
            {
                result[out] = json!(n);
            }
        }
        if result.get("position").is_some() {
            if let Some(t) = attr(playback, "media_position_updated_at")
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            {
                result["positionAt"] = json!(t.with_timezone(&chrono::Utc).to_rfc3339());
            }
        }
    }
    result
}
pub async fn get(State(s): State<AppState>) -> Result<Json<Value>> {
    let all = entities(&s).await?;
    let calibration = baselines(&s).await?;
    let mut rooms: Vec<_> = all
        .iter()
        .filter(|e| is_room(e))
        .map(|e| room(e, &all, &calibration))
        .collect();
    let order = ["Living Room", "Desk", "Bedroom", "Bathroom", "Kitchen"];
    rooms.sort_by_key(|r| {
        let name = r["name"].as_str().unwrap_or("");
        (
            order.iter().position(|n| *n == name).unwrap_or(order.len()),
            name.to_owned(),
        )
    });
    Ok(Json(
        json!({"diagnostics":{"controlPlane":"home-assistant","queriedAt":chrono::Utc::now().to_rfc3339(),"message":format!("{} Sonos rooms reported by Home Assistant", rooms.len())},"rooms":rooms}),
    ))
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum Command {
    Volume {
        room: String,
        volume: u8,
    },
    Mute {
        room: String,
        muted: bool,
    },
    Transport {
        room: String,
        command: Transport,
    },
    Seek {
        room: String,
        #[serde(rename = "positionSeconds")]
        position_seconds: f64,
    },
    Join {
        coordinator: String,
        members: Vec<String>,
    },
    Leave {
        room: String,
    },
    Source {
        room: String,
        source: Source,
    },
    Tv {
        room: String,
        members: Vec<String>,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Transport {
    Play,
    Pause,
    Next,
    Previous,
}
#[derive(Deserialize)]
pub enum Source {
    #[serde(rename = "Line-in")]
    LineIn,
    TV,
}
async fn send(s: &AppState, service: &str, data: Value) -> Result<()> {
    s.config
        .ha
        .as_ref()
        .ok_or_else(unavailable)?
        .call("media_player", service, data)
        .await
        .map_err(|_| unavailable())
}
pub async fn command(State(s): State<AppState>, Json(cmd): Json<Command>) -> Result<Json<Value>> {
    // Validate every target against one fresh topology before the first physical write.
    let all = entities(&s).await?;
    let valid = |id: &str| -> Result<()> {
        if !id.starts_with("media_player.")
            || !id[13..]
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
            || id.len() == 13
        {
            return Err(ApiError::bad("Invalid room"));
        }
        if !all.iter().any(|e| {
            e.entity_id == id
                && is_room(e)
                && !["unknown", "unavailable"].contains(&e.state.as_str())
        }) {
            return Err(unavailable());
        }
        Ok(())
    };
    let group = |leader: &str, targets: &[String]| -> Result<()> {
        valid(leader)?;
        if targets.len() > 64 {
            return Err(ApiError::bad("Too many group members"));
        }
        let mut seen = std::collections::BTreeSet::new();
        for id in targets {
            valid(id)?;
            if id == leader || !seen.insert(id) {
                return Err(ApiError::bad("Invalid group members"));
            }
        }
        Ok(())
    };
    match cmd {
        Command::Volume { room, volume } => {
            valid(&room)?;
            if volume > 100 {
                return Err(ApiError::bad("Volume must be 0–100"));
            }
            send(
                &s,
                "volume_set",
                json!({"entity_id":room,"volume_level":f64::from(volume)/100.0}),
            )
            .await?;
        }
        Command::Mute { room, muted } => {
            valid(&room)?;
            send(
                &s,
                "volume_mute",
                json!({"entity_id":room,"is_volume_muted":muted}),
            )
            .await?;
        }
        Command::Transport { room, command } => {
            valid(&room)?;
            let service = match command {
                Transport::Play => "media_play",
                Transport::Pause => "media_pause",
                Transport::Next => "media_next_track",
                Transport::Previous => "media_previous_track",
            };
            send(&s, service, json!({"entity_id":room})).await?;
        }
        Command::Seek {
            room,
            position_seconds,
        } => {
            valid(&room)?;
            if !position_seconds.is_finite() || position_seconds < 0.0 {
                return Err(ApiError::bad("Invalid seek position"));
            }
            send(
                &s,
                "media_seek",
                json!({"entity_id":room,"seek_position":position_seconds}),
            )
            .await?;
        }
        Command::Join {
            coordinator,
            members,
        } => {
            group(&coordinator, &members)?;
            if members.is_empty() {
                return Err(ApiError::bad("Members required"));
            }
            send(
                &s,
                "join",
                json!({"entity_id":coordinator,"group_members":members}),
            )
            .await?;
        }
        Command::Leave { room } => {
            valid(&room)?;
            send(&s, "unjoin", json!({"entity_id":room})).await?;
        }
        Command::Source { room, source } => {
            valid(&room)?;
            let source = match source {
                Source::LineIn => "Line-in",
                Source::TV => "TV",
            };
            send(
                &s,
                "select_source",
                json!({"entity_id":room,"source":source}),
            )
            .await?;
        }
        Command::Tv { room, members } => {
            group(&room, &members)?;
            send(&s, "select_source", json!({"entity_id":room,"source":"TV"})).await?;
            if !members.is_empty() {
                send(
                    &s,
                    "join",
                    json!({"entity_id":room,"group_members":members}),
                )
                .await?;
            }
        }
    }
    Ok(Json(Value::Null))
}
pub async fn calibrate(State(s): State<AppState>) -> Result<Json<Value>> {
    let all = entities(&s).await?;
    let mut next = BTreeMap::new();
    for e in all
        .iter()
        .filter(|e| is_room(e) && !["unknown", "unavailable"].contains(&e.state.as_str()))
    {
        if let Some(v) = e
            .attributes
            .get("volume_level")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v > 0.0 && *v <= 1.0)
        {
            let baseline = (v * 100.0).round() as i64 * 2;
            if baseline > 0 {
                next.insert(e.entity_id.clone(), baseline);
            }
        }
    }
    let mut tx = s.db.begin().await?;
    let now = chrono::Utc::now().to_rfc3339();
    for (id, value) in &next {
        sqlx::query("INSERT INTO sound_calibration(room_id,baseline,updated_at_utc) VALUES(?,?,?) ON CONFLICT(room_id) DO UPDATE SET baseline=excluded.baseline,updated_at_utc=excluded.updated_at_utc").bind(id).bind(value).bind(&now).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(Json(json!(next)))
}
pub async fn clear(State(s): State<AppState>) -> Result<Json<Value>> {
    sqlx::query("DELETE FROM sound_calibration")
        .execute(&s.db)
        .await?;
    Ok(Json(Value::Null))
}

pub async fn artwork(
    State(s): State<AppState>,
    axum::extract::Path(room): axum::extract::Path<String>,
) -> Result<impl axum::response::IntoResponse> {
    let (mime, bytes) = s
        .config
        .ha
        .as_ref()
        .ok_or_else(unavailable)?
        .artwork(&room)
        .await
        .map_err(|_| unavailable())?;
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, mime),
            (axum::http::header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
            (
                axum::http::header::CACHE_CONTROL,
                "private, no-store".into(),
            ),
        ],
        bytes,
    ))
}
