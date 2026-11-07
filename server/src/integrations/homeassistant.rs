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

pub type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;
impl HomeAssistant {
    pub async fn websocket(&self) -> Result<Socket, Error> {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::{Message, protocol::WebSocketConfig};
        let mut url = self.url("api/websocket")?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme).map_err(|_| Error)?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(8 * 1024 * 1024))
            .max_frame_size(Some(8 * 1024 * 1024));
        let authenticate = async {
            let (mut socket, _) =
                tokio_tungstenite::connect_async_with_config(url.as_str(), Some(config), false)
                    .await
                    .map_err(|_| Error)?;
            let read = socket.next().await.ok_or(Error)?.map_err(|_| Error)?;
            let value: Value =
                serde_json::from_str(read.to_text().map_err(|_| Error)?).map_err(|_| Error)?;
            if value["type"] != "auth_required" {
                return Err(Error);
            }
            socket
                .send(Message::Text(
                    serde_json::json!({"type":"auth","access_token":self.token})
                        .to_string()
                        .into(),
                ))
                .await
                .map_err(|_| Error)?;
            let read = socket.next().await.ok_or(Error)?.map_err(|_| Error)?;
            let value: Value =
                serde_json::from_str(read.to_text().map_err(|_| Error)?).map_err(|_| Error)?;
            if value["type"] != "auth_ok" {
                return Err(Error);
            }
            Ok(socket)
        };
        tokio::time::timeout(Duration::from_secs(15), authenticate)
            .await
            .map_err(|_| Error)?
    }
}

impl HomeAssistant {
    pub async fn artwork(&self, id: &str) -> Result<(String, Vec<u8>), Error> {
        let suffix = id.strip_prefix("media_player.").ok_or(Error)?;
        if suffix.is_empty()
            || suffix.len() > 242
            || !suffix
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
        {
            return Err(Error);
        }
        let mut response = self
            .client
            .get(self.url(&format!("api/media_player_proxy/{id}"))?)
            .bearer_auth(&self.token)
            .send()
            .await
            .map_err(|_| Error)?
            .error_for_status()
            .map_err(|_| Error)?;
        let mime = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.split(';').next())
            .map(|v| v.trim().to_lowercase())
            .filter(|v| ["image/jpeg", "image/png", "image/webp"].contains(&v.as_str()))
            .ok_or(Error)?;
        let limit = 10 * 1024 * 1024;
        if response.content_length().is_some_and(|n| n > limit) {
            return Err(Error);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response.chunk().await.map_err(|_| Error)? {
            if bytes.len() + chunk.len() > limit as usize {
                return Err(Error);
            }
            bytes.extend_from_slice(&chunk);
        }
        if bytes.is_empty() {
            return Err(Error);
        }
        Ok((mime, bytes))
    }
}
