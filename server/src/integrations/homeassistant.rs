use reqwest::{Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

#[derive(Clone)]
pub struct HomeAssistant {
    client: Client,
    base: Url,
    token: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Entity {
    pub entity_id: String,
    pub state: String,
    pub attributes: serde_json::Map<String, Value>,
    pub last_changed: Option<String>,
    pub last_updated: Option<String>,
}
#[derive(Debug, thiserror::Error)]
#[error("Home Assistant unavailable or returned invalid data")]
pub struct Error;
impl HomeAssistant {
    pub fn new(origin: &str, token: String) -> Result<Self, Error> {
        let mut base = Url::parse(origin).map_err(|_| Error)?;
        if !["http", "https"].contains(&base.scheme())
            || base.host_str().is_none()
            || !base.username().is_empty()
            || base.password().is_some()
            || base.query().is_some()
            || base.fragment().is_some()
            || token.is_empty()
        {
            return Err(Error);
        }
        if !base.path().ends_with('/') {
            base.set_path(&(base.path().to_owned() + "/"));
        }
        let client = Client::builder()
            .timeout(Duration::from_secs(8))
            .connect_timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error)?;
        Ok(Self {
            client,
            base,
            token,
        })
    }
    fn url(&self, path: &str) -> Result<Url, Error> {
        self.base.join(path).map_err(|_| Error)
    }
    pub async fn states(&self) -> Result<Vec<Entity>, Error> {
        self.client
            .get(self.url("api/states")?)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| Error)?
            .error_for_status()
            .map_err(|_| Error)?
            .json()
            .await
            .map_err(|_| Error)
    }
    pub async fn call(&self, domain: &str, service: &str, data: Value) -> Result<(), Error> {
        if [domain, service]
            .iter()
            .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_lowercase() || b == b'_'))
        {
            return Err(Error);
        }
        // No retries: an ambiguous response must not replay a physical action.
        self.client
            .post(self.url(&format!("api/services/{domain}/{service}"))?)
            .bearer_auth(&self.token)
            .json(&data)
            .send()
            .await
            .map_err(|_| Error)?
            .error_for_status()
            .map_err(|_| Error)?;
        Ok(())
    }
}
