//! Operator-only OAuth exchange. Credentials never enter argv, files, or diagnostics.
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::OAuthReference;
use crate::process;

const TOKEN_URL: &str = "https://api.tailscale.com/api/v2/oauth/token";
const KEYS_URL: &str = "https://api.tailscale.com/api/v2/tailnet/-/keys";
const BODY_LIMIT: u64 = 16 * 1024;
pub const KEY_LIFETIME_SECONDS: u32 = 86_400;

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("The local 1Password CLI is unavailable.")]
    MissingCli,
    #[error("The Tailscale OAuth item could not be read from 1Password.")]
    ItemUnavailable,
    #[error("The 1Password item needs one client-id and one concealed client-secret field.")]
    InvalidItem,
    #[error("Tailscale OAuth authorization failed. No enrollment key was requested.")]
    Authorization,
    #[error("Enrollment-key creation could not be confirmed. A key may have been issued.")]
    IssuanceUnknown,
    #[error("The issued enrollment key could not be revoked.")]
    Revocation,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::MissingCli => "tailscale_oauth_missing_cli",
            Self::ItemUnavailable => "tailscale_oauth_item_unavailable",
            Self::InvalidItem => "tailscale_oauth_invalid_item",
            Self::Authorization => "tailscale_oauth_authorization",
            Self::IssuanceUnknown => "tailscale_oauth_issuance_unknown",
            Self::Revocation => "tailscale_oauth_revocation",
        }
    }
    pub fn next_action(&self) -> &'static str {
        match self {
            Self::MissingCli => {
                "Install the 1Password CLI on this Mac and enable its desktop integration, or paste a manual auth key."
            }
            Self::ItemUnavailable | Self::InvalidItem => {
                "Unlock 1Password and check the configured vault/item and its client-id/client-secret fields."
            }
            Self::Authorization => {
                "Check the saved OAuth client grants auth_keys for the configured tag, then explicitly retry or use a manual auth key."
            }
            Self::IssuanceUnknown => {
                "Inspect auth keys in the Tailscale admin console before retrying. No automatic retry was made."
            }
            Self::Revocation => {
                "Revoke this attempt's key in the Tailscale admin console. Treat any partially saved ciphertext as unusable and inspect local preparation state."
            }
        }
    }
}

pub fn discover_op() -> Result<PathBuf, Error> {
    let mut paths = vec![
        PathBuf::from("/opt/homebrew/bin/op"),
        PathBuf::from("/usr/local/bin/op"),
    ];
    if let Some(path) = std::env::var_os("PATH") {
        paths.extend(
            std::env::split_paths(&path)
                .filter(|directory| directory.is_absolute())
                .map(|directory| directory.join("op")),
        );
    }
    paths
        .into_iter()
        .find(|path| {
            path.metadata().is_ok_and(|metadata| {
                metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
            })
        })
        .ok_or(Error::MissingCli)
}

#[derive(Deserialize)]
struct Item {
    title: String,
    vault: Vault,
    fields: Vec<Field>,
}
#[derive(Deserialize)]
struct Vault {
    name: String,
}
#[derive(Deserialize)]
struct Field {
    #[serde(default)]
    label: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    value: String,
}
pub struct Credentials {
    pub client_id: String,
    pub client_secret: String,
}

pub trait CredentialSource {
    fn load(&self, reference: &OAuthReference) -> Result<Credentials, Error>;
}

pub struct OnePassword<'a> {
    pub executable: &'a Path,
}
impl CredentialSource for OnePassword<'_> {
    fn load(&self, reference: &OAuthReference) -> Result<Credentials, Error> {
        read_credentials(self.executable, reference)
    }
}

fn token_value(value: &str) -> bool {
    !value.is_empty() && value.len() <= 4096 && value.bytes().all(|byte| byte.is_ascii_graphic())
}

fn read_credentials(op: &Path, reference: &OAuthReference) -> Result<Credentials, Error> {
    let mut command = Command::new(op);
    // Desktop integration needs the operator environment. No credential is exported to it.
    command
        .args([
            "item",
            "get",
            &reference.item,
            "--vault",
            &reference.vault,
            "--format",
            "json",
        ])
        .stdin(Stdio::null());
    let output = process::capture(&mut command, Duration::from_secs(90))
        .map_err(|_| Error::ItemUnavailable)?;
    if !output.status.success() {
        return Err(Error::ItemUnavailable);
    }
    let item: Item = serde_json::from_slice(&output.stdout).map_err(|_| Error::InvalidItem)?;
    if item.title != reference.item || item.vault.name != reference.vault {
        return Err(Error::InvalidItem);
    }
    let field = |label: &str| {
        let mut matches = item.fields.iter().filter(|field| field.label == label);
        let field = matches.next().ok_or(Error::InvalidItem)?;
        if matches.next().is_some() || !token_value(&field.value) {
            return Err(Error::InvalidItem);
        }
        Ok(field)
    };
    let id = field("client-id")?;
    let secret = field("client-secret")?;
    if secret.kind != "CONCEALED" || !secret.value.starts_with("tskey-client-") {
        return Err(Error::InvalidItem);
    }
    Ok(Credentials {
        client_id: id.value.clone(),
        client_secret: secret.value.clone(),
    })
}

#[derive(Deserialize)]
struct AccessToken {
    access_token: String,
    token_type: String,
    expires_in: u32,
    scope: Option<String>,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
struct DeviceCreation {
    reusable: bool,
    ephemeral: bool,
    preauthorized: bool,
    tags: Vec<String>,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
struct Devices {
    create: DeviceCreation,
}
#[derive(Serialize, Deserialize, PartialEq, Eq)]
struct Capabilities {
    devices: Devices,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyRequest {
    capabilities: Capabilities,
    expiry_seconds: u32,
    description: &'static str,
}
#[derive(Deserialize)]
struct KeyResponse {
    id: String,
    key: String,
    capabilities: Capabilities,
}

fn capabilities(tag: &str) -> Capabilities {
    Capabilities {
        devices: Devices {
            create: DeviceCreation {
                reusable: false,
                ephemeral: false,
                preauthorized: true,
                tags: vec![tag.into()],
            },
        },
    }
}

fn agent(https_only: bool, timeout: Duration) -> ureq::Agent {
    ureq::Agent::config_builder()
        .https_only(https_only)
        .proxy(None)
        .max_redirects(0)
        .max_redirects_will_error(true)
        .max_response_header_size(BODY_LIMIT as usize)
        .timeout_global(Some(timeout))
        .build()
        .into()
}

fn json_body<T: serde::de::DeserializeOwned>(
    mut response: ureq::http::Response<ureq::Body>,
) -> Result<T, ()> {
    if !response.status().is_success() {
        return Err(());
    }
    let mut bytes = Vec::new();
    response
        .body_mut()
        .as_reader()
        .take(BODY_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ())?;
    if bytes.len() > BODY_LIMIT as usize {
        return Err(());
    }
    serde_json::from_slice(&bytes).map_err(|_| ())
}

/// No Debug/Serialize: a caller must deliberately access the secret for encryption.
pub struct IssuedKey {
    secret: String,
    id: String,
    access_token: String,
    agent: ureq::Agent,
    keys_url: String,
}
impl IssuedKey {
    pub fn secret(&self) -> &str {
        &self.secret
    }
    pub fn id(&self) -> &str {
        &self.id
    }
    /// Explicit cleanup only. Dropping a successfully encrypted key must not revoke it.
    pub fn revoke(&self) -> Result<(), Error> {
        self.agent
            .delete(&format!("{}/{}", self.keys_url, self.id))
            .header("Authorization", &format!("Bearer {}", self.access_token))
            .call()
            .map_err(|_| Error::Revocation)
            .and_then(|response| {
                if response.status().is_success() {
                    Ok(())
                } else {
                    Err(Error::Revocation)
                }
            })
    }
}

pub fn create_auth_key(
    op: &Path,
    reference: &OAuthReference,
    tag: &str,
) -> Result<IssuedKey, Error> {
    create_auth_key_from(&OnePassword { executable: op }, reference, tag)
}

pub fn create_auth_key_from(
    source: &impl CredentialSource,
    reference: &OAuthReference,
    tag: &str,
) -> Result<IssuedKey, Error> {
    let credentials = source.load(reference)?;
    issue(
        credentials,
        agent(true, Duration::from_secs(30)),
        TOKEN_URL,
        KEYS_URL,
        tag,
    )
}

fn issue(
    credentials: Credentials,
    agent: ureq::Agent,
    token_url: &str,
    keys_url: &str,
    tag: &str,
) -> Result<IssuedKey, Error> {
    let response = agent
        .post(token_url)
        .send_form([
            ("grant_type", "client_credentials"),
            ("client_id", credentials.client_id.as_str()),
            ("client_secret", credentials.client_secret.as_str()),
            ("scope", "auth_keys"),
            ("tags", tag),
        ])
        .map_err(|_| Error::Authorization)?;
    let token: AccessToken = json_body(response).map_err(|_| Error::Authorization)?;
    // RFC 6749 permits omitted scope only when it equals the explicitly requested scope.
    if !token_value(&token.access_token)
        || !token.token_type.eq_ignore_ascii_case("bearer")
        || token.expires_in == 0
        || token
            .scope
            .as_deref()
            .is_some_and(|scope| scope != "auth_keys")
    {
        return Err(Error::Authorization);
    }
    let request = KeyRequest {
        capabilities: capabilities(tag),
        expiry_seconds: KEY_LIFETIME_SECONDS,
        description: "Homelab guided setup",
    };
    let body = serde_json::to_vec(&request).map_err(|_| Error::IssuanceUnknown)?;
    // Never retry this mutation: a lost response can hide successful key issuance.
    let response = agent
        .post(keys_url)
        .header("Authorization", &format!("Bearer {}", token.access_token))
        .header("Content-Type", "application/json")
        .send(body.as_slice())
        .map_err(|_| Error::IssuanceUnknown)?;
    let key: KeyResponse = json_body(response).map_err(|_| Error::IssuanceUnknown)?;
    if key.id.is_empty()
        || key.id.len() > 128
        || !key
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || !token_value(&key.key)
        || !key.key.starts_with("tskey-auth-")
        || key.capabilities != capabilities(tag)
    {
        return Err(Error::IssuanceUnknown);
    }
    Ok(IssuedKey {
        secret: key.key,
        id: key.id,
        access_token: token.access_token,
        agent,
        keys_url: keys_url.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpListener;
    use std::thread;

    fn reference() -> OAuthReference {
        OAuthReference {
            vault: "test-vault".into(),
            item: "Test OAuth".into(),
        }
    }
    const ACCESS: &str = r#"{"access_token":"synthetic-access","token_type":"Bearer","expires_in":3600,"scope":"auth_keys"}"#;
    const ITEM: &str = r#"{"title":"Test OAuth","vault":{"name":"test-vault"},"fields":[{"label":"client-id","type":"STRING","value":"synthetic-id"},{"label":"client-secret","type":"CONCEALED","value":"tskey-client-synthetic-secret"}]}"#;

    fn fake_op(directory: &Path, json: &str) -> PathBuf {
        let path = directory.join("op");
        let script = format!(
            "#!/bin/sh\n[ \"$*\" = 'item get Test OAuth --vault test-vault --format json' ] || exit 9\ncat <<'ITEM'\n{json}\nITEM\n"
        );
        std::fs::write(&path, script).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).unwrap();
        path
    }
    fn response(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }
    fn server(responses: Vec<String>) -> (String, thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let thread = thread::spawn(move || {
            let mut requests = Vec::new();
            for response in responses {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .unwrap();
                let mut bytes = Vec::new();
                let mut buffer = [0; 4096];
                loop {
                    let count = stream.read(&mut buffer).unwrap();
                    if count == 0 {
                        break;
                    }
                    bytes.extend_from_slice(&buffer[..count]);
                    let text = String::from_utf8_lossy(&bytes);
                    if let Some((headers, body)) = text.split_once("\r\n\r\n") {
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break;
                        }
                    }
                }
                requests.push(String::from_utf8(bytes).unwrap());
                stream.write_all(response.as_bytes()).unwrap();
            }
            requests
        });
        (url, thread)
    }
    fn credentials() -> Credentials {
        Credentials {
            client_id: "synthetic-id".into(),
            client_secret: "tskey-client-synthetic-secret".into(),
        }
    }
    fn issued_response(reusable: bool) -> String {
        serde_json::json!({"id":"synthetic-key-id","key":"tskey-auth-synthetic-key","capabilities":{"devices":{"create":{"reusable":reusable,"ephemeral":false,"preauthorized":true,"tags":["tag:lab"]}}}}).to_string()
    }

    #[test]
    fn local_item_exchange_issues_exact_key_and_explicit_cleanup_revokes_only_its_id() {
        let temporary = tempfile::tempdir().unwrap();
        let op = fake_op(temporary.path(), ITEM);
        let (base, thread) = server(vec![
            response("200 OK", ACCESS),
            response("200 OK", &issued_response(false)),
            response("204 No Content", ""),
        ]);
        let key = issue(
            OnePassword { executable: &op }.load(&reference()).unwrap(),
            agent(false, Duration::from_secs(2)),
            &format!("{base}/token"),
            &format!("{base}/keys"),
            "tag:lab",
        )
        .unwrap();
        assert_eq!(key.secret(), "tskey-auth-synthetic-key");
        assert_eq!(key.id(), "synthetic-key-id");
        key.revoke().unwrap();
        let requests = thread.join().unwrap();
        assert!(requests[0].starts_with("POST /token "));
        assert!(requests[0].contains("grant_type=client_credentials"));
        assert!(requests[0].contains("scope=auth_keys"));
        assert!(requests[0].contains("tags=tag%3Alab"));
        assert!(requests[1].starts_with("POST /keys "));
        let request: serde_json::Value =
            serde_json::from_str(requests[1].split_once("\r\n\r\n").unwrap().1).unwrap();
        assert_eq!(
            request["capabilities"]["devices"]["create"],
            serde_json::json!({"reusable":false,"ephemeral":false,"preauthorized":true,"tags":["tag:lab"]})
        );
        assert_eq!(request["expirySeconds"], 86_400);
        assert!(requests[2].starts_with("DELETE /keys/synthetic-key-id "));
        assert!(
            requests[1]
                .to_ascii_lowercase()
                .contains("authorization: bearer synthetic-access")
        );
        assert!(!requests[1].contains("synthetic-secret"));
        assert_eq!(
            std::fs::read_dir(temporary.path()).unwrap().count(),
            1,
            "only the synthetic op fixture exists; credentials were not written"
        );
    }

    #[test]
    fn a_fake_source_issues_without_accessing_a_password_manager() {
        struct Fake;
        impl CredentialSource for Fake {
            fn load(&self, reference: &OAuthReference) -> Result<Credentials, Error> {
                assert_eq!(reference.vault, "test-vault");
                Ok(credentials())
            }
        }
        let (base, thread) = server(vec![
            response("200 OK", ACCESS),
            response("200 OK", &issued_response(false)),
        ]);
        let key = issue(
            Fake.load(&reference()).unwrap(),
            agent(false, Duration::from_secs(1)),
            &format!("{base}/token"),
            &format!("{base}/keys"),
            "tag:lab",
        )
        .unwrap();
        assert_eq!(key.secret(), "tskey-auth-synthetic-key");
        assert_eq!(thread.join().unwrap().len(), 2);
    }

    #[test]
    fn wrong_vault_duplicate_or_visible_secret_fields_are_rejected_before_network() {
        let temporary = tempfile::tempdir().unwrap();
        for document in [ITEM.replace("\"name\":\"test-vault\"", "\"name\":\"other\""), ITEM.replace("CONCEALED", "STRING"), ITEM.replace("\"fields\":[", "\"fields\":[{\"label\":\"client-id\",\"type\":\"STRING\",\"value\":\"duplicate\"},")] {
            let op = fake_op(temporary.path(), &document);
            assert!(matches!(read_credentials(&op, &reference()), Err(Error::InvalidItem)));
        }
    }

    #[test]
    fn redirects_wrong_scopes_and_oversized_bodies_fail_without_issuing_a_key_or_leaking_response()
    {
        let responses = [
            "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:9/must-not-follow\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
            response("200 OK", &ACCESS.replace("auth_keys", "all")),
            response("200 OK", &"secret-response".repeat(2048)),
            response("401 Unauthorized", "secret-response"),
        ];
        for reply in responses {
            let (base, thread) = server(vec![reply]);
            let result = issue(
                credentials(),
                agent(false, Duration::from_secs(1)),
                &format!("{base}/token"),
                &format!("{base}/keys"),
                "tag:lab",
            );
            assert!(matches!(result, Err(Error::Authorization)));
            assert_eq!(thread.join().unwrap().len(), 1);
        }
        assert!(
            !format!("{:?} {}", Error::Authorization, Error::Authorization)
                .contains("secret-response")
        );
    }

    #[test]
    fn bad_key_capabilities_have_unknown_outcome_and_no_automatic_retry() {
        let (base, thread) = server(vec![
            response("200 OK", ACCESS),
            response("200 OK", &issued_response(true)),
        ]);
        let result = issue(
            credentials(),
            agent(false, Duration::from_secs(1)),
            &format!("{base}/token"),
            &format!("{base}/keys"),
            "tag:lab",
        );
        assert!(matches!(result, Err(Error::IssuanceUnknown)));
        assert_eq!(thread.join().unwrap().len(), 2);
    }
    #[test]
    fn a_stalled_issuer_is_bounded_and_never_retried() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let mut buffer = [0; 4096];
            assert!(stream.read(&mut buffer).unwrap() > 0);
            thread::sleep(Duration::from_millis(500));
        });
        let start = std::time::Instant::now();
        let result = issue(
            credentials(),
            agent(false, Duration::from_millis(40)),
            &format!("{base}/token"),
            &format!("{base}/keys"),
            "tag:lab",
        );
        assert!(matches!(result, Err(Error::Authorization)));
        assert!(start.elapsed() < Duration::from_millis(400));
        server.join().unwrap();
    }
}
