use crate::integrations::homeassistant::HomeAssistant;
use std::{env, fs, path::PathBuf};

// Deliberately not Debug/Serialize: configuration contains credentials and home coordinates.
#[derive(Clone, Default)]
pub struct Config {
    pub ha: Option<HomeAssistant>,
    pub climate_entity: Option<String>,
    pub tesla_entities: Option<std::collections::BTreeMap<String, String>>,
    pub weather: Option<(f64, f64)>,
    pub wifi_qr: Option<String>,
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
        Ok(Self {
            ha,
            weather,
            wifi_qr,
            climate_entity: value("CLIMATE_ENTITY_ID")?,
            tesla_entities,
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
