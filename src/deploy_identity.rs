//! Target-local Git identity. Only the public half is returned to enrollment.
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PreparedIdentity {
    pub path: PathBuf,
    pub public_key: String,
    pub bootstrap_started: bool,
    pub activated_revision: Option<String>,
}

pub fn repository_directory(repository: &str) -> String {
    let digest: String = Sha256::digest(repository.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!(".homelab-git-{digest}")
}

pub fn prepare_for_repository(
    home: &Path,
    repository: &str,
    keygen: &Path,
) -> Result<PreparedIdentity, Error> {
    if !crate::config::valid_repository(repository) || !home.is_absolute() {
        return Err(Error::UnsafeIdentity);
    }
    let metadata = fs::symlink_metadata(home).map_err(|_| Error::UnsafeIdentity)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o022 != 0
    {
        return Err(Error::UnsafeIdentity);
    }
    let bootstrap_started =
        crate::bootstrap_state::has_started(home).map_err(|_| Error::UnsafeIdentity)?;
    // Repository binding prevents reusing one deploy identity across repositories.
    // Keeping this under the administrator's home lets SSH interruption resume
    // without retaining a helper or private key in temporary staging.
    let directory = home.join(repository_directory(repository));
    let marker = directory.join("public-key");
    let expected = match fs::symlink_metadata(&marker) {
        Ok(_) => {
            let saved = snapshot(&marker, rustix::process::geteuid().as_raw())?;
            let text = fs::read_to_string(saved.path()).map_err(|_| Error::UnsafeIdentity)?;
            let key = crate::ssh_identity::canonical_key(&text).ok_or(Error::UnsafeIdentity)?;
            if public_key(
                &directory.join("key.txt"),
                rustix::process::geteuid().as_raw(),
                keygen,
            )? != key
            {
                return Err(Error::UnsafeIdentity);
            }
            Some(key)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(Error::UnsafeIdentity),
    };
    let public_key = prepare(&directory, keygen)?;
    if expected.is_none() {
        let mut file =
            tempfile::NamedTempFile::new_in(&directory).map_err(|_| Error::Installation)?;
        file.write_all(public_key.as_bytes())
            .map_err(|_| Error::Installation)?;
        file.as_file().sync_all().map_err(|_| Error::Installation)?;
        file.persist_noclobber(&marker)
            .map_err(|_| Error::Installation)?;
        File::open(&directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| Error::Installation)?;
    }
    Ok(PreparedIdentity {
        path: directory.join("key.txt"),
        public_key,
        bootstrap_started,
        activated_revision: None,
    })
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("The Git identity must be a private regular file owned by the expected user.")]
    UnsafeIdentity,
    #[error("The Git identity could not be generated or verified.")]
    Key,
    #[error(
        "Git identity installation could not be confirmed. Preserve its state before retrying."
    )]
    Installation,
}

pub(crate) fn snapshot(path: &Path, owner: u32) -> Result<tempfile::NamedTempFile, Error> {
    let source = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::UnsafeIdentity)?,
    );
    let metadata = source.metadata().map_err(|_| Error::UnsafeIdentity)?;
    if !metadata.is_file()
        || metadata.uid() != owner
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
        || metadata.len() == 0
        || metadata.len() > 16384
    {
        return Err(Error::UnsafeIdentity);
    }
    let mut bytes = Vec::new();
    source
        .take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::UnsafeIdentity)?;
    if bytes.len() > 16384 {
        return Err(Error::UnsafeIdentity);
    }
    let mut temporary = tempfile::NamedTempFile::new().map_err(|_| Error::Key)?;
    temporary.write_all(&bytes).map_err(|_| Error::Key)?;
    Ok(temporary)
}

fn public_from_snapshot(path: &Path, keygen: &Path) -> Result<String, Error> {
    let mut command = Command::new(keygen);
    command
        .args(["-y", "-P", "", "-f"])
        .arg(path)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    let output =
        crate::process::capture(&mut command, Duration::from_secs(10)).map_err(|_| Error::Key)?;
    if !output.status.success() {
        return Err(Error::Key);
    }
    let text = std::str::from_utf8(&output.stdout).map_err(|_| Error::Key)?;
    crate::ssh_identity::canonical_key(text)
        .filter(|key| key.starts_with("ssh-ed25519 "))
        .ok_or(Error::Key)
}

pub fn public_key(path: &Path, owner: u32, keygen: &Path) -> Result<String, Error> {
    let snapshot = snapshot(path, owner)?;
    public_from_snapshot(snapshot.path(), keygen)
}

/// `directory` is a repository-bound target state directory; its parent must exist.
/// Publication reuses the no-overwrite, durable host-key installer.
pub fn prepare(directory: &Path, keygen: &Path) -> Result<String, Error> {
    match fs::symlink_metadata(directory) {
        Ok(metadata)
            if metadata.is_dir()
                && metadata.uid() == rustix::process::geteuid().as_raw()
                && metadata.mode() & 0o7777 == 0o700 => {}
        Ok(_) => return Err(Error::UnsafeIdentity),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(Error::UnsafeIdentity),
    }
    let destination = directory.join("key.txt");
    match fs::symlink_metadata(&destination) {
        Ok(_) => return public_key(&destination, rustix::process::geteuid().as_raw(), keygen),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(Error::UnsafeIdentity),
    }
    let temporary = tempfile::tempdir().map_err(|_| Error::Key)?;
    let generated = temporary.path().join("key");
    let mut command = Command::new(keygen);
    command
        .args([
            "-q",
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            "homelab-deploy",
            "-f",
        ])
        .arg(&generated)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    let status = crate::process::run_silent(&mut command, Duration::from_secs(15))
        .map_err(|_| Error::Key)?;
    if !status.success() {
        return Err(Error::Key);
    }
    let expected = public_key(&generated, rustix::process::geteuid().as_raw(), keygen)?;
    crate::host_key::install(&generated, directory, rustix::process::geteuid().as_raw())
        .map_err(|_| Error::Installation)?;
    let installed = public_key(&destination, rustix::process::geteuid().as_raw(), keygen)?;
    if expected != installed {
        return Err(Error::Installation);
    }
    Ok(installed)
}

/// The privileged caller chooses a fixed root destination and the authenticated
/// administrator UID. Snapshot once so validation and publication use identical bytes.
pub fn install(
    source: &Path,
    owner: u32,
    directory: &Path,
    expected: &str,
    keygen: &Path,
) -> Result<(), Error> {
    install_inner(source, owner, directory, expected, keygen, false)
}

pub fn ensure(
    source: &Path,
    owner: u32,
    directory: &Path,
    expected: &str,
    keygen: &Path,
) -> Result<(), Error> {
    install_inner(source, owner, directory, expected, keygen, true)
}

fn install_inner(
    source: &Path,
    owner: u32,
    directory: &Path,
    expected: &str,
    keygen: &Path,
    reuse_matching: bool,
) -> Result<(), Error> {
    let source = snapshot(source, owner)?;
    if public_from_snapshot(source.path(), keygen)? != expected {
        return Err(Error::UnsafeIdentity);
    }
    let publish = if reuse_matching {
        crate::host_key::ensure
    } else {
        crate::host_key::install
    };
    publish(
        source.path(),
        directory,
        rustix::process::geteuid().as_raw(),
    )
    .map_err(|_| Error::Installation)?;
    if public_key(
        &directory.join("key.txt"),
        rustix::process::geteuid().as_raw(),
        keygen,
    )? != expected
    {
        return Err(Error::Installation);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};
    const KEYGEN: &str = "/usr/bin/ssh-keygen";

    #[test]
    fn repository_binding_reuses_only_the_same_repository_identity() {
        let home = tempfile::tempdir().unwrap();
        fs::set_permissions(home.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let first =
            prepare_for_repository(home.path(), "example/config", Path::new(KEYGEN)).unwrap();
        let again =
            prepare_for_repository(home.path(), "example/config", Path::new(KEYGEN)).unwrap();
        let other =
            prepare_for_repository(home.path(), "example/other", Path::new(KEYGEN)).unwrap();
        assert_eq!(first.path, again.path);
        assert_eq!(first.public_key, again.public_key);
        assert_ne!(first.path, other.path);
        assert_ne!(first.public_key, other.public_key);
        let response = serde_json::to_string(&first).unwrap();
        assert!(!response.contains("PRIVATE KEY"));
        fs::remove_file(&first.path).unwrap();
        assert!(prepare_for_repository(home.path(), "example/config", Path::new(KEYGEN)).is_err());
        assert!(!first.path.exists());
    }

    #[test]
    fn reuse_returns_same_public_key_and_handoff_preserves_identity() {
        let root = tempfile::tempdir().unwrap();
        let state = root.path().join("bootstrap");
        let public = prepare(&state, Path::new(KEYGEN)).unwrap();
        assert_eq!(prepare(&state, Path::new(KEYGEN)).unwrap(), public);
        assert!(!public.contains("PRIVATE"));
        let installed = root.path().join("installed");
        install(
            &state.join("key.txt"),
            rustix::process::geteuid().as_raw(),
            &installed,
            &public,
            Path::new(KEYGEN),
        )
        .unwrap();
        assert_eq!(
            public_key(
                &installed.join("key.txt"),
                rustix::process::geteuid().as_raw(),
                Path::new(KEYGEN)
            )
            .unwrap(),
            public
        );
        assert_eq!(
            fs::metadata(installed.join("key.txt")).unwrap().mode() & 0o777,
            0o600
        );
        assert!(
            install(
                &state.join("key.txt"),
                rustix::process::geteuid().as_raw(),
                &installed,
                &public,
                Path::new(KEYGEN)
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_changed_identity_links_and_publicly_readable_keys() {
        let root = tempfile::tempdir().unwrap();
        let state = root.path().join("bootstrap");
        prepare(&state, Path::new(KEYGEN)).unwrap();
        let source = state.join("key.txt");
        let directory_link = root.path().join("directory-link");
        symlink(&state, &directory_link).unwrap();
        assert_eq!(
            prepare(&directory_link, Path::new(KEYGEN)),
            Err(Error::UnsafeIdentity)
        );
        let destination = root.path().join("installed");
        assert_eq!(
            install(
                &source,
                rustix::process::geteuid().as_raw(),
                &destination,
                "ssh-ed25519 wrong",
                Path::new(KEYGEN)
            ),
            Err(Error::UnsafeIdentity)
        );
        assert!(!destination.exists());
        let link = root.path().join("link");
        symlink(&source, &link).unwrap();
        assert_eq!(
            public_key(
                &link,
                rustix::process::geteuid().as_raw(),
                Path::new(KEYGEN)
            ),
            Err(Error::UnsafeIdentity)
        );
        fs::set_permissions(&source, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            prepare(&state, Path::new(KEYGEN)),
            Err(Error::UnsafeIdentity)
        );
    }
}
