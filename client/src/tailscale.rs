use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::time::Duration;

use serde::Deserialize;
use thiserror::Error;

use crate::process;

#[derive(Debug, Error)]
pub enum EnrollmentError {
    #[error("The hostname must be a DNS label of at most 63 characters.")]
    InvalidHostname,
    #[error("Tailscale did not return a usable status. Check its daemon and retry.")]
    StatusUnavailable,
    #[error("Tailscale is not ready for enrollment. Check its daemon and tailnet approval status.")]
    NotReady,
    #[error("Provision a nonempty, owner-only auth-key file through SOPS before enrolling.")]
    MissingAuthKey,
    #[error("Tailscale could not apply the host settings. Check the daemon and tailnet policy.")]
    ApplyFailed,
    #[error(
        "Tailscale has not reached Running. Check connectivity and device approval before retrying."
    )]
    NotRunning,
}

#[derive(Deserialize)]
struct Status {
    #[serde(rename = "BackendState")]
    state: BackendState,
}

#[derive(Deserialize, PartialEq, Eq)]
enum BackendState {
    Running,
    NeedsLogin,
    #[serde(other)]
    Unavailable,
}

fn status(executable: &Path) -> Result<Status, EnrollmentError> {
    // Peer inventories are irrelevant to enrollment and can exceed the output bound.
    let result = process::run(
        executable,
        &["status", "--json", "--peers=false"],
        Duration::from_secs(15),
    )
    .map_err(|_| EnrollmentError::StatusUnavailable)?;
    if !result.status.success() {
        return Err(EnrollmentError::StatusUnavailable);
    }
    serde_json::from_slice(&result.stdout).map_err(|_| EnrollmentError::StatusUnavailable)
}

pub fn reconcile(
    executable: &Path,
    hostname: &str,
    auth_key: &Path,
) -> Result<(), EnrollmentError> {
    if hostname.is_empty()
        || hostname.len() > 63
        || hostname.starts_with('-')
        || hostname.ends_with('-')
        || !hostname
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        return Err(EnrollmentError::InvalidHostname);
    }

    let state = status(executable)?;
    let hostname_argument = format!("--hostname={hostname}");
    let mut arguments = vec![
        "set",
        &hostname_argument,
        "--advertise-tags=tag:homelab",
        "--ssh",
    ];
    let auth_argument;

    match state.state {
        BackendState::Running => {}
        BackendState::NeedsLogin => {
            // SOPS exposes symlinks into its generation directory. Follow them,
            // but require a private file owned by the executing service account.
            let metadata = fs::metadata(auth_key).map_err(|_| EnrollmentError::MissingAuthKey)?;
            if !metadata.is_file()
                || metadata.len() == 0
                || metadata.mode() & 0o077 != 0
                || metadata.uid() != rustix::process::geteuid().as_raw()
            {
                return Err(EnrollmentError::MissingAuthKey);
            }
            let path = auth_key.to_str().ok_or(EnrollmentError::MissingAuthKey)?;
            // Only the path reaches argv; Tailscale reads the credential itself.
            auth_argument = format!("--auth-key=file:{path}");
            arguments[0] = "up";
            arguments.push(&auth_argument);
            arguments.push("--timeout=30s");
        }
        BackendState::Unavailable => return Err(EnrollmentError::NotReady),
    }

    let result = process::run(executable, &arguments, Duration::from_secs(40))
        .map_err(|_| EnrollmentError::ApplyFailed)?;
    if !result.status.success() {
        return Err(EnrollmentError::ApplyFailed);
    }
    if status(executable)?.state != BackendState::Running {
        return Err(EnrollmentError::NotRunning);
    }
    Ok(())
}
