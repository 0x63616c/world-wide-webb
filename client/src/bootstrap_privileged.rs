//! Narrow elevated steps; the caller owns bootstrap approval and recovery state.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::process;

const MAX_INSTALLER_BYTES: u64 = 100 * 1024 * 1024;
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Use a private, expected-owner installer file and its reviewed SHA256.")]
    InvalidInstaller,
    #[error("The private installer snapshot could not be prepared.")]
    PreparationFailed,
    #[error(
        "Nix installation could not be confirmed. Inspect the target before resuming bootstrap."
    )]
    InstallationUnconfirmed,
    #[error("Activation requires absolute system and checkout directories and a supported host.")]
    InvalidActivation,
    #[error(
        "System activation could not be confirmed. Inspect the target before resuming bootstrap."
    )]
    ActivationUnconfirmed,
}

/// Execute a verified private snapshot, so replacing the download cannot change it.
pub fn install_nix(installer: &Path, expected_sha256: &str, owner_uid: u32) -> Result<(), Error> {
    if !installer.is_absolute()
        || expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Error::InvalidInstaller);
    }
    let mut source = File::from(
        open(
            installer,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::InvalidInstaller)?,
    );
    let metadata = source.metadata().map_err(|_| Error::InvalidInstaller)?;
    if !metadata.is_file()
        || metadata.uid() != owner_uid
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600 | 0o700)
        || metadata.len() == 0
        || metadata.len() > MAX_INSTALLER_BYTES
    {
        return Err(Error::InvalidInstaller);
    }
    let directory = tempfile::tempdir().map_err(|_| Error::PreparationFailed)?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::PreparationFailed)?;
    let snapshot = directory.path().join("nix-installer");
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&snapshot)
        .map_err(|_| Error::PreparationFailed)?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|_| Error::InvalidInstaller)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_INSTALLER_BYTES {
            return Err(Error::InvalidInstaller);
        }
        digest.update(&buffer[..count]);
        destination
            .write_all(&buffer[..count])
            .map_err(|_| Error::PreparationFailed)?;
    }
    let actual_sha256: String = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if total == 0 || actual_sha256 != expected_sha256 {
        return Err(Error::InvalidInstaller);
    }
    destination
        .set_permissions(fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::PreparationFailed)?;
    // Close the writable descriptor before executing the verified snapshot.
    drop(destination);
    let mut command = Command::new(&snapshot);
    command
        .args(["install", "--no-confirm"])
        .env_clear()
        .env("PATH", SYSTEM_PATH)
        .env("HOME", "/var/root")
        .env("LC_ALL", "C")
        .current_dir(directory.path())
        .stdin(Stdio::null());
    let status = process::run_silent(&mut command, Duration::from_secs(20 * 60))
        .map_err(|_| Error::InstallationUnconfirmed)?;
    if !status.success() {
        return Err(Error::InstallationUnconfirmed);
    }
    Ok(())
}

/// Switch only the selected built system to the selected host's reviewed checkout.
pub fn activate(system: &Path, checkout: &Path, host: &str) -> Result<(), Error> {
    let checkout_text = checkout.to_str().ok_or(Error::InvalidActivation)?;
    if !system.is_absolute()
        || !checkout.is_absolute()
        || !system.is_dir()
        || !checkout.is_dir()
        || checkout_text.contains(['#', '?'])
        || !matches!(host, "homelab-macbook" | "homelab-mac-mini")
    {
        return Err(Error::InvalidActivation);
    }
    let bin = system.join("sw/bin");
    let path = std::env::join_paths([
        bin.as_path(),
        Path::new("/nix/var/nix/profiles/default/bin"),
        Path::new("/usr/bin"),
        Path::new("/bin"),
        Path::new("/usr/sbin"),
        Path::new("/sbin"),
    ])
    .map_err(|_| Error::InvalidActivation)?;
    let mut command = Command::new(bin.join("darwin-rebuild"));
    command
        .args(["switch", "--flake"])
        .arg(format!("{checkout_text}#{host}"))
        .arg("--no-update-lock-file")
        .env_clear()
        .env("PATH", path)
        .env("HOME", "/var/root")
        .env("LC_ALL", "C")
        .current_dir(checkout)
        .stdin(Stdio::null());
    let status = process::run_silent(&mut command, Duration::from_secs(30 * 60))
        .map_err(|_| Error::ActivationUnconfirmed)?;
    if !status.success() {
        return Err(Error::ActivationUnconfirmed);
    }
    Ok(())
}
