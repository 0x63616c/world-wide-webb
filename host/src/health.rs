//! Read-only deployment health gate; no probe changes service configuration.

use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::net::IpAddr;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rustix::fs::{Mode, OFlags, open};
use serde::Deserialize;
use thiserror::Error;

use crate::process;

const SERVICES: &str = "unix:///var/lib/_containers/.colima/services/docker.sock";
const HOME_ASSISTANT: &str = "unix:///var/lib/_containers/.colima-ha/ha/docker.sock";
// Project only the required fields: Docker health logs can contain application
// payloads and exceed the bounded capture even when a container is healthy.
const CONTAINER_FACTS: &str = r#"{"running":{{json .State.Running}},"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}},"image":{{json .Config.Image}}}"#;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "kebab-case")]
pub enum Service {
    ControlCenter,
    Bambuddy,
    Hindsight,
    Cloudflared,
    HomeAssistant,
    Penpot,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Config {
    pub services: Vec<Service>,
    pub workers_enabled: bool,
    pub docker_path: PathBuf,
    pub release_path: PathBuf,
    #[serde(default = "default_curl")]
    pub curl_path: PathBuf,
    #[serde(default = "default_port")]
    pub control_center_port: u16,
    #[serde(default = "default_penpot_port")]
    pub penpot_port: u16,
}

fn default_curl() -> PathBuf {
    PathBuf::from("/usr/bin/curl")
}
fn default_penpot_port() -> u16 {
    9001
}
fn default_port() -> u16 {
    4202
}

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum HealthError {
    #[error("The health configuration is invalid.")]
    InvalidConfig,
    #[error("The Control Center release identity is invalid or unavailable.")]
    InvalidRelease,
    #[error("A configured service health probe could not complete.")]
    ProbeUnavailable,
    #[error("Container {0} is not running with its required healthy status.")]
    UnhealthyContainer(&'static str),
    #[error(
        "Control Center image, source, database, lifecycle or worker ownership differs from its release."
    )]
    ControlCenterMismatch,
    #[error("The configured Cloudflare tunnel is not ready.")]
    TunnelNotReady,
    #[error("The Bambuddy Tailscale node is not online and healthy.")]
    TailscaleNotReady,
    #[error("Configured service health checks did not pass within the shared deadline.")]
    Deadline,
}

impl HealthError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidConfig => "health-invalid-config",
            Self::InvalidRelease => "health-invalid-release",
            Self::ProbeUnavailable => "health-probe-unavailable",
            Self::UnhealthyContainer(_) => "health-container-unhealthy",
            Self::ControlCenterMismatch => "health-control-center-mismatch",
            Self::TunnelNotReady => "health-tunnel-not-ready",
            Self::TailscaleNotReady => "health-tailscale-not-ready",
            Self::Deadline => "health-deadline",
        }
    }
}

#[derive(Deserialize)]
struct ContainerFacts {
    running: bool,
    health: Option<String>,
    image: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Release {
    schema_version: u8,
    source_repository: String,
    source_revision: String,
    image: String,
    database_engine: String,
}

#[derive(Deserialize)]
struct ControlCenterFacts {
    database: String,
    status: String,
    backend: String,
    build: String,
    cycles: Cycles,
}
#[derive(Deserialize)]
struct Cycles {
    enabled: bool,
}

#[derive(Deserialize)]
struct TailscaleFacts {
    #[serde(rename = "BackendState")]
    backend_state: String,
    #[serde(rename = "Self")]
    local_node: LocalNode,
    #[serde(rename = "TailscaleIPs")]
    addresses: Vec<IpAddr>,
    #[serde(rename = "Health")]
    health: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct LocalNode {
    #[serde(rename = "Online")]
    online: bool,
}

impl Config {
    fn validate(&self) -> Result<(), HealthError> {
        if !self.curl_path.is_absolute()
            || self.control_center_port == 0
            || self.penpot_port == 0
            || !self.docker_path.is_absolute()
            || !self.release_path.is_absolute()
            || self.services.iter().copied().collect::<HashSet<_>>().len() != self.services.len()
        {
            return Err(HealthError::InvalidConfig);
        }
        Ok(())
    }
}

fn remaining(deadline: Instant, maximum: Duration) -> Result<Duration, HealthError> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        Err(HealthError::Deadline)
    } else {
        Ok(remaining.min(maximum))
    }
}

fn docker(
    config: &Config,
    socket: &str,
    arguments: &[&str],
    deadline: Instant,
    maximum: Duration,
) -> Result<Vec<u8>, HealthError> {
    let timeout = remaining(deadline, maximum)?;
    let mut command = Command::new(&config.docker_path);
    command
        .args(["--host", socket])
        .args(arguments)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", "/var/empty")
        .stdin(Stdio::null());
    let result = process::capture(&mut command, timeout).map_err(|_| {
        if Instant::now() >= deadline {
            HealthError::Deadline
        } else {
            HealthError::ProbeUnavailable
        }
    })?;
    if Instant::now() >= deadline {
        return Err(HealthError::Deadline);
    }
    if !result.status.success() {
        return Err(HealthError::ProbeUnavailable);
    }
    Ok(result.stdout)
}

fn lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn pinned_image(value: &str) -> bool {
    value
        .split_once("@sha256:")
        .is_some_and(|(repository, digest)| {
            !repository.is_empty()
                && repository
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"./_-:".contains(&byte))
                && lower_hex(digest, 64)
        })
}

fn release(path: &Path) -> Result<Release, HealthError> {
    // Nix-managed files are symlinks; follow them, but do not block on a FIFO.
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| HealthError::InvalidRelease)?,
    );
    if !file.metadata().is_ok_and(|metadata| metadata.is_file()) {
        return Err(HealthError::InvalidRelease);
    }
    let mut bytes = Vec::new();
    file.take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|_| HealthError::InvalidRelease)?;
    if bytes.len() > 65_536 {
        return Err(HealthError::InvalidRelease);
    }
    let release: Release =
        serde_json::from_slice(&bytes).map_err(|_| HealthError::InvalidRelease)?;
    if release.schema_version != 2
        || release.source_repository != "0x63616c/world-wide-webb"
        || !lower_hex(&release.source_revision, 40)
        || !pinned_image(&release.image)
        || release.database_engine != "sqlite"
    {
        return Err(HealthError::InvalidRelease);
    }
    Ok(release)
}

fn containers(service: Service) -> (&'static str, &'static [(&'static str, bool)]) {
    match service {
        Service::ControlCenter => (SERVICES, &[("www-control-center-www-1", true)]),
        // Bambuddy's pinned image declares an inherited Docker healthcheck.
        Service::Bambuddy => (
            SERVICES,
            &[
                ("bambuddy", true),
                ("bambu-studio-api", true),
                ("bambuddy-tailscale", false),
            ],
        ),
        Service::Hindsight => (SERVICES, &[("hindsight", true)]),
        Service::Cloudflared => (SERVICES, &[("www-tunnel-cloudflared-1", false)]),
        Service::Penpot => (
            SERVICES,
            &[
                ("penpot-penpot-frontend-1", false),
                ("penpot-penpot-backend-1", false),
                ("penpot-penpot-exporter-1", false),
                ("penpot-penpot-admin-console-1", false),
                ("penpot-penpot-mcp-1", false),
                ("penpot-penpot-postgres-1", true),
                ("penpot-penpot-valkey-1", true),
            ],
        ),
        Service::HomeAssistant => (
            HOME_ASSISTANT,
            &[("www-home-assistant-home-assistant-1", true)],
        ),
    }
}

/// Check only configured services, under a caller-supplied shared deadline.
pub fn check_once(config: &Config, deadline: Instant) -> Result<(), HealthError> {
    remaining(deadline, Duration::from_secs(10))?;
    config.validate()?;
    let release = config
        .services
        .contains(&Service::ControlCenter)
        .then(|| release(&config.release_path))
        .transpose()?;
    for &service in &config.services {
        let (socket, names) = containers(service);
        for &(name, requires_health) in names {
            let bytes = docker(
                config,
                socket,
                &["inspect", "--format", CONTAINER_FACTS, name],
                deadline,
                Duration::from_secs(10),
            )?;
            let facts: ContainerFacts = serde_json::from_slice(&bytes)
                .map_err(|_| HealthError::UnhealthyContainer(name))?;
            if !facts.running
                || (requires_health && facts.health.as_deref() != Some("healthy"))
                || facts
                    .health
                    .as_deref()
                    .is_some_and(|health| health != "healthy")
            {
                return Err(HealthError::UnhealthyContainer(name));
            }
            if let Some(release) = &release {
                let expected = match name {
                    "www-control-center-www-1" => Some(&release.image),
                    _ => None,
                };
                if expected.is_some_and(|image| &facts.image != image) {
                    return Err(HealthError::ControlCenterMismatch);
                }
            }
        }
        match service {
            Service::ControlCenter => {
                let timeout = remaining(deadline, Duration::from_secs(10))?;
                let mut command = Command::new(&config.curl_path);
                command
                    .args([
                        "--fail",
                        "--silent",
                        "--show-error",
                        "--max-time",
                        "10",
                        "--noproxy",
                        "*",
                    ])
                    .arg(format!(
                        "http://127.0.0.1:{}/healthz",
                        config.control_center_port
                    ))
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin")
                    .stdin(Stdio::null());
                let result = process::capture(&mut command, timeout)
                    .map_err(|_| HealthError::ProbeUnavailable)?;
                if Instant::now() >= deadline {
                    return Err(HealthError::Deadline);
                }
                if !result.status.success() {
                    return Err(HealthError::ControlCenterMismatch);
                }
                let bytes = result.stdout;
                let facts: ControlCenterFacts = serde_json::from_slice(&bytes)
                    .map_err(|_| HealthError::ControlCenterMismatch)?;
                let release = release.as_ref().ok_or(HealthError::InvalidRelease)?;
                if facts.database != "ok"
                    || facts.status != "ok"
                    || facts.backend != "rust"
                    || facts.cycles.enabled != config.workers_enabled
                    || facts.build != release.source_revision
                {
                    return Err(HealthError::ControlCenterMismatch);
                }
            }
            Service::Cloudflared => {
                docker(
                    config,
                    SERVICES,
                    &[
                        "exec",
                        "www-tunnel-cloudflared-1",
                        "/usr/local/bin/cloudflared",
                        "tunnel",
                        "--metrics",
                        "127.0.0.1:20241",
                        "ready",
                    ],
                    deadline,
                    Duration::from_secs(10),
                )
                .map_err(|error| {
                    if error == HealthError::Deadline {
                        error
                    } else {
                        HealthError::TunnelNotReady
                    }
                })?;
            }
            Service::Bambuddy => {
                let bytes = docker(
                    config,
                    SERVICES,
                    &[
                        "exec",
                        "bambuddy-tailscale",
                        "/usr/local/bin/tailscale",
                        "status",
                        "--json",
                        "--peers=false",
                    ],
                    deadline,
                    Duration::from_secs(10),
                )?;
                let facts: TailscaleFacts =
                    serde_json::from_slice(&bytes).map_err(|_| HealthError::TailscaleNotReady)?;
                if facts.backend_state != "Running"
                    || !facts.local_node.online
                    || facts.addresses.is_empty()
                    || facts.health.is_some_and(|health| !health.is_empty())
                {
                    return Err(HealthError::TailscaleNotReady);
                }
            }
            Service::Penpot => {
                let timeout = remaining(deadline, Duration::from_secs(10))?;
                let mut command = Command::new(&config.curl_path);
                command
                    .args([
                        "--fail",
                        "--silent",
                        "--show-error",
                        "--max-time",
                        "10",
                        "--noproxy",
                        "*",
                        "--output",
                        "/dev/null",
                    ])
                    .arg(format!("http://127.0.0.1:{}/readyz", config.penpot_port))
                    .env_clear()
                    .env("PATH", "/usr/bin:/bin")
                    .stdin(Stdio::null());
                let result = process::capture(&mut command, timeout)
                    .map_err(|_| HealthError::ProbeUnavailable)?;
                if Instant::now() >= deadline {
                    return Err(HealthError::Deadline);
                }
                if !result.status.success() {
                    return Err(HealthError::UnhealthyContainer("penpot-penpot-frontend-1"));
                }
                for (name, role) in [
                    ("penpot-penpot-exporter-1", "exporter"),
                    ("penpot-penpot-admin-console-1", "admin"),
                    ("penpot-penpot-mcp-1", "mcp"),
                ] {
                    docker(
                        config,
                        SERVICES,
                        &[
                            "exec",
                            name,
                            "node",
                            "--input-type=module",
                            "-e",
                            include_str!("probes/penpot-services.mjs"),
                            role,
                        ],
                        deadline,
                        Duration::from_secs(20),
                    )
                    .map_err(|error| {
                        if error == HealthError::Deadline {
                            error
                        } else {
                            HealthError::UnhealthyContainer(name)
                        }
                    })?;
                }
            }
            Service::Hindsight | Service::HomeAssistant => {}
        }
    }
    Ok(())
}

/// Retry within one budget; neither individual probes nor sleeps reset it.
pub fn wait_healthy(config: &Config, timeout: Duration) -> Result<(), HealthError> {
    config.validate()?;
    let deadline = Instant::now()
        .checked_add(timeout)
        .ok_or(HealthError::InvalidConfig)?;
    let mut last_failure = HealthError::Deadline;
    loop {
        match check_once(config, deadline) {
            Ok(()) => return Ok(()),
            Err(error @ (HealthError::InvalidConfig | HealthError::InvalidRelease)) => {
                return Err(error);
            }
            Err(HealthError::Deadline) => return Err(last_failure),
            Err(error) => last_failure = error,
        }
        let delay = match remaining(deadline, Duration::from_secs(3)) {
            Ok(delay) => delay,
            Err(_) => return Err(last_failure),
        };
        thread::sleep(delay);
    }
}
