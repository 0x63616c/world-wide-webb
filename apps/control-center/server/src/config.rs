use crate::integrations::homeassistant::HomeAssistant;
use std::{env, fs, path::PathBuf};

// Deliberately not Debug/Serialize: configuration contains credentials and home coordinates.
#[derive(Clone)]
pub struct Config {
    pub release_token: Option<String>,
    pub workers_enabled: bool,
    pub ha: Option<HomeAssistant>,
    pub climate_entity: Option<String>,
    pub bedroom_input: Option<String>,
    pub tesla_entities: Option<std::collections::BTreeMap<String, String>>,
    pub weather: Option<(f64, f64)>,
    pub wifi_qr: Option<String>,
    pub alarm_snooze_minutes: i64,
    pub alarm_light_target: String,
}
fn value(key: &str) -> Result<Option<String>, Box<dyn std::error::Error>> {
    if let Ok(path) = env::var(format!("{key}_FILE")) {
        return Ok(Some(fs::read_to_string(path)?.trim().to_owned()));
    }
    if let Ok(v) = env::var(key) {
        return Ok(Some(v));
    }
    if let Ok(dir) = env::var("WWW_SECRETS_DIR") {
        let p = PathBuf::from(dir).join(key);
        if p.is_file() {
            return Ok(Some(fs::read_to_string(p)?.trim().to_owned()));
        }
    }
    Ok(None)
}
impl Config {
    pub fn load() -> Result<Self, Box<dyn std::error::Error>> {
        let workers_enabled = match value("WORKER_CYCLES")?.as_deref().unwrap_or("on") {
            "on" => true,
            "off" => false,
            _ => return Err("WORKER_CYCLES must be on or off".into()),
        };
        let ha = match (value("HA_URL")?, value("HA_TOKEN")?) {
            (Some(url), Some(token)) => Some(HomeAssistant::new(&url, token)?),
            (None, None) => None,
            _ => return Err("Home Assistant configuration incomplete".into()),
        };
        let weather = match (value("HOME_LAT")?, value("HOME_LON")?) {
            (Some(a), Some(b)) => {
                let lat: f64 = a.parse().map_err(|_| "Invalid latitude")?;
                let lon: f64 = b.parse().map_err(|_| "Invalid longitude")?;
                if !lat.is_finite()
                    || !lon.is_finite()
                    || !(-90.0..=90.0).contains(&lat)
                    || !(-180.0..=180.0).contains(&lon)
                {
                    return Err("Invalid coordinates".into());
                }
                Some((lat, lon))
            }
            (None, None) => None,
            _ => return Err("Weather configuration incomplete".into()),
        };
        let bedroom_input = match (
            value("BEDROOM_SWITCH_INPUT_ENABLED")?,
            value("BEDROOM_SWITCH_INPUT_VERIFIED")?,
            value("BEDROOM_SWITCH_INPUT_ENTITY_ID")?,
        ) {
            (Some(enabled), Some(verified), Some(id))
                if enabled == "true" && verified == "true" =>
            {
                let valid = id.strip_prefix("binary_sensor.").is_some_and(|v| {
                    !v.is_empty()
                        && v.bytes()
                            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
                });
                if !valid {
                    return Err("Invalid bedroom switch input entity".into());
                }
                Some(id)
            }
            _ => None,
        };
        let tesla_entities = value("TESLA_ENTITIES")?
            .map(|raw| {
                let ids =
                    serde_json::from_str(&raw).map_err(|_| "Invalid Tesla entity configuration")?;
                if !crate::features::tesla::validate_ids(&ids) {
                    return Err("Invalid Tesla entity configuration");
                }
                Ok(ids)
            })
            .transpose()?;
        let wifi_qr = value("WIFI_GUEST_SSID")?
            .filter(|s| !s.is_empty())
            .map(|ssid| {
                let password = value("WIFI_GUEST_PASSWORD")?.unwrap_or_default();
                Ok::<_, Box<dyn std::error::Error>>(wifi_payload(&ssid, &password))
            })
            .transpose()?;
        let alarm_snooze_minutes = value("ALARM_SNOOZE_MINUTES")?
            .map(|v| v.parse::<i64>())
            .transpose()
            .map_err(|_| "Invalid alarm snooze minutes")?
            .unwrap_or(9);
        let alarm_light_target = value("ALARM_LIGHT_TARGET")?
            .unwrap_or_else(|| "light.bed_lamp_left,light.bed_lamp_right".into());
        if !(1..=60).contains(&alarm_snooze_minutes)
            || !crate::features::alarms::valid_target(&alarm_light_target)
        {
            return Err("Invalid alarm defaults".into());
        }
        Ok(Self {
            release_token: value("ALARM_API_TOKEN")?,
            workers_enabled,
            ha,
            weather,
            wifi_qr,
            climate_entity: value("CLIMATE_ENTITY_ID")?,
            tesla_entities,
            bedroom_input,
            alarm_snooze_minutes,
            alarm_light_target,
        })
    }
}
pub fn wifi_payload(ssid: &str, password: &str) -> String {
    fn escape(s: &str) -> String {
        s.chars()
            .flat_map(|c| {
                if "\\;,:\"".contains(c) {
                    vec!['\\', c]
                } else {
                    vec![c]
                }
            })
            .collect()
    }
    if password.is_empty() {
        format!("WIFI:T:nopass;S:{};;", escape(ssid))
    } else {
        format!("WIFI:T:WPA;S:{};P:{};;", escape(ssid), escape(password))
    }
}
impl Default for Config {
    fn default() -> Self {
        Self {
            release_token: None,
            workers_enabled: true,
            ha: None,
            climate_entity: None,
            bedroom_input: None,
            tesla_entities: None,
            weather: None,
            wifi_qr: None,
            alarm_snooze_minutes: 9,
            alarm_light_target: "light.bed_lamp_left,light.bed_lamp_right".into(),
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn qr_escapes_structural_characters() {
        assert_eq!(
            super::wifi_payload("guest;wifi", "a:b"),
            "WIFI:T:WPA;S:guest\\;wifi;P:a\\:b;;"
        );
    }
}
