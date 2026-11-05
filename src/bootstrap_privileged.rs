//! Narrow elevated steps; the caller owns bootstrap approval and recovery state.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

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
    #[error("Activation requires an immutable, root-owned built system in the Nix store.")]
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

/// Switch the already reviewed build without evaluating its operator-owned checkout as root.
pub fn activate(system: &Path) -> Result<(), Error> {
    activate_built(
        system,
        Path::new("/nix/var/nix/profiles/default/bin/nix-env"),
        Path::new("/nix/var/nix/profiles/system"),
        Path::new("/nix/store"),
        0,
    )
}

fn trusted_store_path(path: &Path, store: &Path, owner: u32) -> Result<std::path::PathBuf, Error> {
    if !path.is_absolute() {
        return Err(Error::InvalidActivation);
    }
    let canonical = path.canonicalize().map_err(|_| Error::InvalidActivation)?;
    if canonical == store || !canonical.starts_with(store) {
        return Err(Error::InvalidActivation);
    }
    // The store itself may be group-writable; individual store objects must not be.
    for component in canonical
        .ancestors()
        .take_while(|component| *component != store)
    {
        let metadata = fs::symlink_metadata(component).map_err(|_| Error::InvalidActivation)?;
        if metadata.uid() != owner || metadata.mode() & 0o222 != 0 {
            return Err(Error::InvalidActivation);
        }
    }
    Ok(canonical)
}

fn activate_built(
    system: &Path,
    nix_env: &Path,
    profile: &Path,
    store: &Path,
    owner: u32,
) -> Result<(), Error> {
    let system = trusted_store_path(system, store, owner)?;
    if system.parent() != Some(store) || !system.is_dir() {
        return Err(Error::InvalidActivation);
    }
    let rebuild = system.join("sw/bin/darwin-rebuild");
    for executable in [&rebuild, nix_env] {
        let resolved = trusted_store_path(executable, store, owner)?;
        let metadata = fs::metadata(resolved).map_err(|_| Error::InvalidActivation)?;
        if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
            return Err(Error::InvalidActivation);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(30 * 60);
    let mut set_profile = Command::new(nix_env);
    set_profile.arg("-p").arg(profile).arg("--set").arg(&system);
    let mut activate = Command::new(rebuild);
    activate.args(["activate", "--no-flake"]);
    // Match nix-darwin's switch order. After the profile changes, any failure requires
    // inspection; automatic rollback could hide partially applied configuration.
    for command in [&mut set_profile, &mut activate] {
        command
            .env_clear()
            .env("PATH", SYSTEM_PATH)
            .env("HOME", "/var/root")
            .env("LC_ALL", "C")
            .env("NIX_REMOTE", "daemon")
            .current_dir("/")
            .stdin(Stdio::null());
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(Error::ActivationUnconfirmed)?;
        let status =
            process::run_silent(command, remaining).map_err(|_| Error::ActivationUnconfirmed)?;
        if !status.success() {
            return Err(Error::ActivationUnconfirmed);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    struct ActivationFixture {
        directory: tempfile::TempDir,
        system: PathBuf,
        nix_env: PathBuf,
        marker: PathBuf,
    }

    impl ActivationFixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path().canonicalize().unwrap();
            let store = root.join("store");
            let system = store.join("system");
            let bin = system.join("sw/bin");
            fs::create_dir_all(&bin).unwrap();
            let marker = root.join("events");
            let nix_env = store.join("nix-env");
            let output = Command::new("rustc")
                .args(["--edition=2024", "-o"])
                .arg(&nix_env)
                .arg(
                    Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("tests/fixtures/bootstrap_privileged.rs"),
                )
                .env("HOMELAB_FIXTURE_MARKER", &marker)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            fs::copy(&nix_env, bin.join("darwin-rebuild")).unwrap();
            for path in [
                &nix_env,
                &bin.join("darwin-rebuild"),
                &bin,
                &system.join("sw"),
                &system,
            ] {
                fs::set_permissions(path, fs::Permissions::from_mode(0o555)).unwrap();
            }
            Self {
                directory,
                system,
                nix_env,
                marker,
            }
        }

        fn run(&self) -> Result<(), Error> {
            activate_built(
                &self.system,
                &self.nix_env,
                Path::new("/nix/var/nix/profiles/system"),
                &self.directory.path().join("store").canonicalize().unwrap(),
                rustix::process::geteuid().as_raw(),
            )
        }
    }

    impl Drop for ActivationFixture {
        fn drop(&mut self) {
            // Restore only fixture directory permissions so TempDir can remove its files.
            for path in [
                &self.system,
                &self.system.join("sw"),
                &self.system.join("sw/bin"),
            ] {
                let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
            }
        }
    }

    #[test]
    fn prebuilt_switch_sets_profile_then_activates_without_checkout() {
        let fixture = ActivationFixture::new();
        fixture.run().unwrap();
        assert_eq!(
            fs::read_to_string(&fixture.marker).unwrap(),
            "nix-env\ndarwin-rebuild\n"
        );
    }

    #[test]
    fn profile_or_activation_failure_requires_inspection() {
        let fixture = ActivationFixture::new();
        for (failure, events) in [
            ("nix-env", "nix-env\n"),
            ("darwin-rebuild", "nix-env\ndarwin-rebuild\n"),
        ] {
            let flag = fixture.marker.with_extension(failure);
            fs::write(&flag, "").unwrap();
            assert_eq!(fixture.run(), Err(Error::ActivationUnconfirmed));
            assert_eq!(fs::read_to_string(&fixture.marker).unwrap(), events);
            fs::remove_file(flag).unwrap();
            fs::remove_file(&fixture.marker).unwrap();
        }
    }

    #[test]
    fn mutable_or_foreign_owned_store_objects_never_execute() {
        let fixture = ActivationFixture::new();
        let store = fixture
            .directory
            .path()
            .join("store")
            .canonicalize()
            .unwrap();
        assert_eq!(
            trusted_store_path(
                &fixture.system,
                &store,
                rustix::process::geteuid().as_raw().wrapping_add(1)
            ),
            Err(Error::InvalidActivation)
        );
        for path in [
            &fixture.system,
            &fixture.nix_env,
            &fixture.system.join("sw/bin/darwin-rebuild"),
        ] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(fixture.run(), Err(Error::InvalidActivation));
            fs::set_permissions(path, fs::Permissions::from_mode(0o555)).unwrap();
        }
        assert!(!fixture.marker.exists());
    }
}
