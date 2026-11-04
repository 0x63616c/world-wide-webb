//! Explicit first-use trust and public-key installation through the system SSH client.
use std::fs::File;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use thiserror::Error;

use crate::{
    inventory::{HostProfile, validate_profile},
    process,
};

pub struct Tools {
    pub ssh: PathBuf,
    pub ssh_keygen: PathBuf,
}

#[derive(Clone, Copy)]
pub enum Trust {
    Strict,
    /// Only after the operator explicitly accepts trust on first use.
    AcceptNew,
}

pub struct PublicKey {
    line: String,
    fingerprint: String,
}

impl PublicKey {
    pub fn fingerprint(&self) -> &str {
        &self.fingerprint
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("The host profile or system executable path is invalid.")]
    InvalidProfile,
    #[error("A fresh SSH connection using the configured keys could not be established.")]
    Connection,
    #[error("This address has no trusted SSH host key saved yet.")]
    HostUnknown,
    #[error("The target's SSH host key differs from its saved identity.")]
    HostChanged,
    #[error("SSH reported that authentication with the available public keys was denied.")]
    AuthenticationDenied,
    #[error("The target refused the SSH connection.")]
    ConnectionRefused,
    #[error("The SSH connection did not respond before its deadline.")]
    ConnectionTimeout,
    #[error("SSH could not resolve the target hostname.")]
    NameResolution,
    #[error("Public-key file not found.")]
    PublicKeyMissing,
    #[error("Choose a regular OpenSSH public-key file containing exactly one key.")]
    InvalidKey,
    #[error("The public-key installation did not report success.")]
    Installation,
    #[error("Public-key installation may have been interrupted; its outcome is unknown.")]
    UnknownOutcome,
    #[error(
        "The key was installed, but a fresh connection using the configured identities failed."
    )]
    Verification,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidProfile => "invalid-first-access-input",
            Self::Connection => "first-access-unavailable",
            Self::HostUnknown => "ssh-host-unknown",
            Self::HostChanged => "ssh-host-changed",
            Self::AuthenticationDenied => "ssh-authentication-denied",
            Self::ConnectionRefused => "ssh-connection-refused",
            Self::ConnectionTimeout => "ssh-connection-timeout",
            Self::NameResolution => "ssh-name-resolution-failed",
            Self::PublicKeyMissing => "public-key-file-missing",
            Self::InvalidKey => "invalid-public-key",
            Self::Installation => "public-key-installation-failed",
            Self::UnknownOutcome => "public-key-installation-unknown",
            Self::Verification => "installed-key-not-verified",
        }
    }

    pub fn next_action(&self) -> &'static str {
        match self {
            Self::InvalidProfile => {
                "Check the saved address/login and use absolute system tool paths."
            }
            Self::Connection => {
                "Check Remote Login, address, networking and the saved host identity. If password login works, you may install an existing public key. A failed connection does not prove a key is missing."
            }
            Self::HostUnknown => {
                "Confirm this is the target address from local setup, then explicitly approve first-use trust or verify its fingerprint locally."
            }
            Self::HostChanged => {
                "Check the target identity locally. Do not remove saved host keys or approve first-use trust to bypass this mismatch."
            }
            Self::AuthenticationDenied => {
                "Confirm the administrator username and that your matching private identity is available through SSH configuration or your agent. If password login works, review and install its public key."
            }
            Self::ConnectionRefused => {
                "Enable Remote Login on the target Mac for this administrator and check its address and SSH port."
            }
            Self::ConnectionTimeout => {
                "Check that the target is powered on and reachable through the selected LAN or Tailscale route, then retry."
            }
            Self::NameResolution => {
                "Check the saved hostname and local DNS or Tailscale name resolution, or use the address shown on the target."
            }
            Self::PublicKeyMissing => {
                "Choose an existing public .pub file, not its private key. The suggested filename may not exist on this Mac."
            }
            Self::InvalidKey => {
                "Choose the public .pub file, never its private key. Its matching private identity must already be available through your SSH agent or SSH configuration."
            }
            Self::Installation | Self::UnknownOutcome => {
                "Check the target's authorized_keys locally before retrying. Existing keys are preserved; do not delete saved host fingerprints to bypass an identity mismatch."
            }
            Self::Verification => {
                "Make the matching private identity available through your SSH agent or existing SSH configuration, then inspect again. No local SSH configuration was changed."
            }
        }
    }
}

fn ssh(host: &HostProfile, tools: &Tools, trust: Trust, batch: bool) -> Result<Command, Error> {
    validate_profile(host).map_err(|_| Error::InvalidProfile)?;
    if !tools.ssh.is_absolute() || !tools.ssh_keygen.is_absolute() {
        return Err(Error::InvalidProfile);
    }
    let mut command = Command::new(&tools.ssh);
    command.env("LC_ALL", "C");
    // A cached master connection would bypass both a new handshake and key testing.
    command.args([
        "-T",
        "-o",
        "ControlMaster=no",
        "-o",
        "ControlPath=none",
        "-o",
        "ControlPersist=no",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
    ]);
    command.args([
        "-o",
        match trust {
            Trust::Strict => "StrictHostKeyChecking=yes",
            Trust::AcceptNew => "StrictHostKeyChecking=accept-new",
        },
    ]);
    command.args([
        "-o",
        if batch {
            "BatchMode=yes"
        } else {
            "BatchMode=no"
        },
        "-o",
        "NumberOfPasswordPrompts=3",
    ]);
    if batch {
        command.args(["-o", "PreferredAuthentications=publickey"]);
    } else {
        // Installation explicitly uses the target account's password. Agent
        // keys must not exhaust the server's authentication attempts first.
        command.args([
            "-o",
            "PreferredAuthentications=keyboard-interactive,password",
            "-o",
            "PubkeyAuthentication=no",
            "-o",
            "PasswordAuthentication=yes",
            "-o",
            "KbdInteractiveAuthentication=yes",
        ]);
    }
    command
        .arg("--")
        .arg(format!("{}@{}", host.user, host.address));
    Ok(command)
}

pub fn check_key_access(host: &HostProfile, tools: &Tools, trust: Trust) -> Result<(), Error> {
    let mut command = ssh(host, tools, trust, true)?;
    command.arg("/usr/bin/true").stdin(Stdio::null());
    let output =
        process::capture(&mut command, Duration::from_secs(25)).map_err(|error| match error {
            process::ProcessError::Timeout => Error::ConnectionTimeout,
            _ => Error::Connection,
        })?;
    if output.status.success() {
        Ok(())
    } else {
        Err(connection_error(&output.stderr))
    }
}

fn connection_error(stderr: &[u8]) -> Error {
    let Ok(text) = std::str::from_utf8(stderr) else {
        return Error::Connection;
    };
    // These are diagnostic hints, not identity evidence: remote banners can
    // contain similar text. Never weaken host checking or install a key here.
    let lines: Vec<_> = text.lines().map(str::trim).collect();
    if lines
        .iter()
        .any(|line| line.contains("WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!"))
    {
        return Error::HostChanged;
    }
    if lines.iter().any(|line| {
        [
            "No ED25519 host key is known for ",
            "No RSA host key is known for ",
            "No ECDSA host key is known for ",
        ]
        .iter()
        .any(|prefix| line.starts_with(prefix))
            && line.ends_with(" and you have requested strict checking.")
    }) {
        return Error::HostUnknown;
    }
    // A generic host-verification failure is not evidence that the key is new.
    if lines.contains(&"Host key verification failed.") {
        return Error::Connection;
    }
    if lines
        .iter()
        .any(|line| line.starts_with("ssh: Could not resolve hostname "))
    {
        return Error::NameResolution;
    }
    if lines.iter().any(|line| {
        line.starts_with("ssh: connect to host ") && line.ends_with(": Connection refused")
    }) {
        return Error::ConnectionRefused;
    }
    if lines.iter().any(|line| {
        (line.starts_with("ssh: connect to host ")
            && (line.ends_with(": Connection timed out")
                || line.ends_with(": Operation timed out")))
            || (line.starts_with("Timeout, server ") && line.ends_with(" not responding."))
    }) {
        return Error::ConnectionTimeout;
    }
    if lines.iter().any(|line| {
        let Some((target, methods)) = line.split_once(": Permission denied (") else {
            return false;
        };
        !target.is_empty()
            && methods.strip_suffix(").").is_some_and(|methods| {
                !methods.is_empty()
                    && methods
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b",-@.".contains(&byte))
            })
    }) {
        return Error::AuthenticationDenied;
    }
    Error::Connection
}

pub fn prepare_public_key(path: &Path, tools: &Tools) -> Result<PublicKey, Error> {
    if !path.is_absolute() || !tools.ssh_keygen.is_absolute() {
        return Err(Error::InvalidKey);
    }
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|error| {
            if error == rustix::io::Errno::NOENT {
                Error::PublicKeyMissing
            } else {
                Error::InvalidKey
            }
        })?,
    );
    if !file.metadata().map_err(|_| Error::InvalidKey)?.is_file() {
        return Err(Error::InvalidKey);
    }
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::InvalidKey)?;
    if bytes.len() > 16384 {
        return Err(Error::InvalidKey);
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| Error::InvalidKey)?
        .trim();
    if text.contains(['\n', '\r']) {
        return Err(Error::InvalidKey);
    }
    let mut fields = text.split_whitespace();
    let kind = fields.next().ok_or(Error::InvalidKey)?;
    let encoded = fields.next().ok_or(Error::InvalidKey)?;
    if ![
        "ssh-ed25519",
        "ssh-rsa",
        "ecdsa-sha2-nistp256",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp521",
        "sk-ssh-ed25519@openssh.com",
        "sk-ecdsa-sha2-nistp256@openssh.com",
    ]
    .contains(&kind)
        || !encoded
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
    {
        return Err(Error::InvalidKey);
    }
    // Discard comments: only the validated public identity is transferred.
    let line = format!("{kind} {encoded}\n");
    let mut snapshot = tempfile::NamedTempFile::new().map_err(|_| Error::InvalidKey)?;
    snapshot
        .write_all(line.as_bytes())
        .map_err(|_| Error::InvalidKey)?;
    let mut command = Command::new(&tools.ssh_keygen);
    command
        .args(["-l", "-E", "sha256", "-f"])
        .arg(snapshot.path())
        .stdin(Stdio::null());
    let output =
        process::capture(&mut command, Duration::from_secs(5)).map_err(|_| Error::InvalidKey)?;
    if !output.status.success() {
        return Err(Error::InvalidKey);
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| Error::InvalidKey)?;
    let fingerprint = text.split_whitespace().nth(1).ok_or(Error::InvalidKey)?;
    if !fingerprint.starts_with("SHA256:")
        || fingerprint.len() > 100
        || !fingerprint[7..]
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b))
    {
        return Err(Error::InvalidKey);
    }
    Ok(PublicKey {
        line,
        fingerprint: fingerprint.into(),
    })
}

/// Call with the terminal in normal mode. SSH reads passwords from its controlling
/// terminal; stdin carries only the public key. The caller approves the fingerprint.
pub fn install_public_key(host: &HostProfile, tools: &Tools, key: &PublicKey) -> Result<(), Error> {
    let mut command = ssh(host, tools, Trust::Strict, false)?;
    let script = include_str!("first-access/install-key.sh");
    let quoted = script.replace('\'', "'\\''");
    command.arg(format!("/bin/sh -c '{quoted}'"));
    let mut input = tempfile::tempfile().map_err(|_| Error::Installation)?;
    input
        .write_all(key.line.as_bytes())
        .map_err(|_| Error::Installation)?;
    input.rewind().map_err(|_| Error::Installation)?;
    // Native SSH owns the prompt; never read or store the operator's password.
    let status = command
        .stdin(Stdio::from(input))
        .stdout(Stdio::null())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|_| Error::UnknownOutcome)?;
    match status.code() {
        Some(0) => check_key_access(host, tools, Trust::Strict).map_err(|_| Error::Verification),
        None | Some(128..) => Err(Error::UnknownOutcome),
        _ => Err(Error::Installation),
    }
}
