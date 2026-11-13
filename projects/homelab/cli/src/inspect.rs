use std::io::{Seek, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::Serialize;
use thiserror::Error;

use crate::inventory::HostProfile;
use crate::process::{self, ProcessError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InspectionState {
    Ready,
    Blocked,
}

#[derive(Clone, Debug, Serialize)]
pub struct Inspection {
    pub schema: u8,
    pub host: String,
    pub state: InspectionState,
    #[serde(rename = "macOS")]
    pub mac_os: String,
    pub architecture: String,
    pub user: String,
    pub uid: u64,
    #[serde(rename = "freeGiB")]
    pub free_gib: f64,
    #[serde(rename = "totalGB")]
    pub total_gb: f64,
    #[serde(rename = "usedGB")]
    pub used_gb: f64,
    pub message: &'static str,
    #[serde(rename = "nextAction")]
    pub next_action: &'static str,
}

impl Inspection {
    pub fn is_ready(&self) -> bool {
        self.state == InspectionState::Ready
    }

    pub fn storage_label(&self) -> String {
        format!("{:.0} / {:.0} GB used", self.used_gb, self.total_gb)
    }

    pub fn lines(&self) -> Vec<String> {
        vec![
            format!(
                "{}: {}",
                self.host,
                if self.is_ready() { "ready" } else { "blocked" }
            ),
            format!("macOS {} / {}", self.mac_os, self.architecture),
            format!("Account: {} (UID {})", self.user, self.uid),
            format!("Storage: {}", self.storage_label()),
            self.message.into(),
            self.next_action.into(),
        ]
    }
}

#[derive(Clone, Debug, Error, Serialize)]
#[error("{message}")]
pub struct InspectionError {
    code: &'static str,
    message: &'static str,
    #[serde(rename = "nextAction")]
    next_action: &'static str,
}

impl InspectionError {
    pub fn code(&self) -> &'static str {
        self.code
    }

    pub fn next_action(&self) -> &'static str {
        self.next_action
    }
}

const CONNECTION: InspectionError = InspectionError {
    code: "connection-unavailable",
    message: "The host could not be inspected.",
    next_action: "Check power, networking, Tailscale or local-LAN reachability, then retry.",
};

const UNEXPECTED: InspectionError = InspectionError {
    code: "unexpected-host-response",
    message: "The host returned unexpected inspection data.",
    next_action: "Verify the target identity and login-shell configuration before continuing.",
};

/// Inspect through the same read-only operation used by the CLI and interactive UI.
pub fn inspect(host: &HostProfile, ssh: &Path) -> Result<Inspection, InspectionError> {
    // Library callers can construct profiles without loading an inventory first.
    crate::inventory::validate_profile(host).map_err(|_| InspectionError {
        code: "invalid-host-profile",
        message: "The host connection profile is invalid.",
        next_action: "Use plain host/profile/login names from a reviewed private inventory.",
    })?;
    // A fixed stdin program prevents inventory values from becoming shell code.
    // An anonymous file avoids blocking on a child that never consumes its stdin.
    let mut input = tempfile::tempfile().map_err(|_| CONNECTION)?;
    input
        .write_all(include_bytes!("probe.sh"))
        .map_err(|_| CONNECTION)?;
    input.rewind().map_err(|_| CONNECTION)?;
    let mut command = Command::new(ssh);
    let _identity = crate::ssh_identity::configure(&mut command, host.identity.as_ref())
        .map_err(|_| CONNECTION)?;
    command
        .arg("-T")
        .args(crate::ssh::OPTIONS)
        .args(["-l", &host.user, &host.address, "/bin/sh -s"])
        .stdin(Stdio::from(input));
    // Keep the operator's environment, including SSH_AUTH_SOCK, for local authentication.
    // An agent may require the operator to approve this specific client.
    let timeout = if host.identity.is_some() { 90 } else { 25 };
    let output = crate::provider_diagnostics::observe(
        crate::provider_diagnostics::Operation::SshInspect,
        process::capture(&mut command, Duration::from_secs(timeout)),
    )
    .map_err(|error| match error {
        ProcessError::ExcessiveOutput => InspectionError {
            code: "excessive-host-output",
            message: "The host produced excessive inspection output.",
            next_action: "Inspect the SSH endpoint and login configuration before retrying.",
        },
        _ => CONNECTION,
    })?;
    if !output.status.success() {
        // Remote banners and authentication failures can contain credentials.
        return Err(InspectionError {
            code: "ssh-check-failed",
            message: "SSH access or a read-only host check failed.",
            next_action: "Verify Remote Login, the administrator SSH key and the saved host fingerprint. The client will not accept a new fingerprint automatically.",
        });
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| UNEXPECTED)?;
    let fields: Vec<_> = text.lines().collect();
    if fields.len() != 6 || fields.iter().any(|field| field.len() > 256) {
        return Err(UNEXPECTED);
    }
    let version: Vec<_> = fields[0].split('.').collect();
    let decimal = |value: &str| !value.is_empty() && value.bytes().all(|b| b.is_ascii_digit());
    if !(2..=3).contains(&version.len())
        || !version.iter().all(|part| decimal(part))
        || !matches!(fields[1], "arm64" | "x86_64")
        || fields[2] != host.user
        || !decimal(fields[3])
        || !decimal(fields[4])
        || !decimal(fields[5])
    {
        return Err(UNEXPECTED);
    }
    let uid = fields[3].parse().map_err(|_| UNEXPECTED)?;
    let free_kib: u64 = fields[4].parse().map_err(|_| UNEXPECTED)?;
    let total_kib: u64 = fields[5].parse().map_err(|_| UNEXPECTED)?;
    if total_kib == 0 || free_kib > total_kib {
        return Err(UNEXPECTED);
    }
    // APFS volumes share capacity; total minus available includes the whole shared allocation.
    let used_kib = total_kib - free_kib;
    Ok(Inspection {
        schema: 1,
        host: host.name.clone(),
        state: if fields[1] == "arm64" {
            InspectionState::Ready
        } else {
            InspectionState::Blocked
        },
        mac_os: fields[0].into(),
        architecture: fields[1].into(),
        user: fields[2].into(),
        uid,
        free_gib: (free_kib as f64 / 1_048_576.0 * 10.0).round() / 10.0,
        total_gb: total_kib as f64 * 1024.0 / 1_000_000_000.0,
        used_gb: used_kib as f64 * 1024.0 / 1_000_000_000.0,
        message: "SSH inspection complete. No settings changed.",
        next_action: "Review host readiness before setup. This does not validate services, backups or runner isolation.",
    })
}
