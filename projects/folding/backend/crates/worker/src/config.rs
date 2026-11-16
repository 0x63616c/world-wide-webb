//! Worker configuration loaded from environment bindings and secrets.
use crate::{secrets::KeyRing, support::Failure};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use worker::*;

pub(crate) struct Configuration {
    pub(crate) deployment: String,
    pub(crate) keys: KeyRing,
    pub(crate) network_key: [u8; 32],
    pub(crate) admin_participant_ids: Vec<String>,
}
impl Configuration {
    pub(crate) fn load(env: &Env) -> std::result::Result<Self, Failure> {
        let deployment = env
            .var("DEPLOYMENT")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        if deployment != "production" {
            return Err(Failure::unavailable());
        }
        let version = env
            .var("AUTH_ENCRYPTION_KEY_VERSION")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let encoded = env
            .secret("AUTH_ENCRYPTION_KEYS")
            .map_err(|_| Failure::unavailable())?
            .to_string();
        let keys =
            KeyRing::from_secret_json(&version, &encoded).map_err(|_| Failure::unavailable())?;
        let network_key = URL_SAFE_NO_PAD
            .decode(
                env.secret("AUTH_NETWORK_HMAC_KEY")
                    .map_err(|_| Failure::unavailable())?
                    .to_string(),
            )
            .map_err(|_| Failure::unavailable())?
            .try_into()
            .map_err(|_| Failure::unavailable())?;
        let admin_participant_ids = env
            .var("ADMIN_PARTICIPANT_IDS")
            .ok()
            .map(|value| {
                value
                    .to_string()
                    .split(',')
                    .map(|id| id.trim().to_ascii_lowercase())
                    .filter(|id| !id.is_empty())
                    .collect()
            })
            .unwrap_or_default();
        Ok(Self {
            deployment,
            keys,
            network_key,
            admin_participant_ids,
        })
    }
}
