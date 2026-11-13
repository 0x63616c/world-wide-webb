//! Direct, non-retrying vacuum commands. Entity and room assumptions are shared
//! with HA provisioning through config/vacuum.json, including room confirmation.
use crate::{
    AppState,
    http::{ApiError, Result},
};
use axum::{Json, extract::State, http::StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Deserialize)]
struct Inventory {
    entities: BTreeMap<String, String>,
    rooms: Vec<Room>,
    rooms_confirmed: bool,
}
#[derive(Clone, Deserialize, Serialize)]
struct Room {
    id: String,
    name: String,
    segment: u32,
}
fn inventory() -> Inventory {
    serde_json::from_str(include_str!("../../config/vacuum.json"))
        .expect("validated vacuum inventory")
}
fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        message: "Vacuum unavailable",
    }
}
#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Start {},
    Pause {},
    Stop {},
    Dock {},
    Room { room: String },
}
fn service(input: Command, config: &Inventory) -> Result<(&str, &str, Value)> {
    let entity = &config.entities["vacuum"];
    let service = match input {
        Command::Start {} => "start",
        Command::Pause {} => "pause",
        Command::Stop {} => "stop",
        Command::Dock {} => "return_to_base",
        Command::Room { room } => {
            if !config.rooms_confirmed || !config.rooms.iter().any(|r| r.id == room) {
                return Err(ApiError::bad(
                    "Confirm vacuum room IDs before cleaning a room",
                ));
            }
            // HA owns the same allowlist and segment mapping. Do not duplicate
            // physical-action retry or scheduling logic in this server.
            return Ok((
                "script",
                config.entities["clean_room"]
                    .strip_prefix("script.")
                    .ok_or_else(|| ApiError::bad("Invalid vacuum script configuration"))?,
                json!({"room": room}),
            ));
        }
    };
    Ok(("vacuum", service, json!({"entity_id": entity})))
}
pub async fn get(State(state): State<AppState>) -> Result<Json<Value>> {
    let ha = state.config.ha.as_ref().ok_or_else(unavailable)?;
    let config = inventory();
    let entities = ha.states().await.map_err(|_| unavailable())?;
    let vacuum = entities
        .iter()
        .find(|e| e.entity_id == config.entities["vacuum"])
        .filter(|e| !["unknown", "unavailable"].contains(&e.state.as_str()))
        .ok_or_else(unavailable)?;
    let battery = entities
        .iter()
        .find(|e| e.entity_id == config.entities["battery"])
        .and_then(|e| e.state.parse::<f64>().ok())
        .or_else(|| {
            vacuum
                .attributes
                .get("battery_level")
                .and_then(Value::as_f64)
        })
        .filter(|v| v.is_finite() && (0.0..=100.0).contains(v));
    Ok(Json(json!({"status": vacuum.state, "battery": battery,
        "rooms": if config.rooms_confirmed { config.rooms } else { vec![] }})))
}
pub async fn command(
    State(state): State<AppState>,
    Json(input): Json<Command>,
) -> Result<Json<Value>> {
    let config = inventory();
    let (domain, action, data) = service(input, &config)?;
    let ha = state.config.ha.as_ref().ok_or_else(unavailable)?;
    ha.call(domain, action, data)
        .await
        .map_err(|_| unavailable())?;
    Ok(Json(json!({"ok": true})))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_commands_use_only_reviewed_services_and_entities() {
        let config = inventory();
        for (command, expected) in [
            (Command::Start {}, "start"),
            (Command::Pause {}, "pause"),
            (Command::Stop {}, "stop"),
            (Command::Dock {}, "return_to_base"),
        ] {
            let (domain, action, data) = service(command, &config).unwrap();
            assert_eq!((domain, action), ("vacuum", expected));
            assert_eq!(data["entity_id"], config.entities["vacuum"]);
        }
        assert!(serde_json::from_value::<Command>(json!({"action":"send_command"})).is_err());
        assert!(
            serde_json::from_value::<Command>(json!({"action":"start","entity_id":"vacuum.other"}))
                .is_err()
        );
    }
    #[test]
    fn rooms_require_confirmation_and_an_allowlisted_name() {
        let mut config = inventory();
        let room = config.rooms[0].id.clone();
        assert!(service(Command::Room { room: room.clone() }, &config).is_err());
        config.rooms_confirmed = true;
        config
            .entities
            .insert("clean_room".into(), "script.confirmed_room".into());
        let (domain, action, data) =
            service(Command::Room { room: room.clone() }, &config).unwrap();
        assert_eq!((domain, action), ("script", "confirmed_room"));
        assert_eq!(data, json!({"room": room}));
        assert!(
            service(
                Command::Room {
                    room: "unknown".into()
                },
                &config
            )
            .is_err()
        );
    }
}
