use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use thiserror::Error;

use crate::process;

const MAX_KEY_BYTES: u64 = 64 * 1024;
const MAX_CIPHERTEXT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum SecretError {
    #[error(
        "Use absolute paths to nonempty regular files and a current-user-owned age key with mode 0400 or 0600."
    )]
    InvalidInputs,
    #[error(
        "The encrypted host file exceeds 16 MiB. Check that you selected the host secrets file."
    )]
    CiphertextTooLarge,
    #[error("The isolated host identity check could not run.")]
    Unavailable,
    #[error("The supplied host identity could not decrypt this host's secrets.")]
    VerificationFailed,
}

impl SecretError {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidInputs => "invalid-secret-inputs",
            Self::CiphertextTooLarge => "ciphertext-too-large",
            Self::Unavailable => "secret-check-unavailable",
            Self::VerificationFailed => "host-identity-unverified",
        }
    }
}

fn regular_input(path: &Path) -> Result<File, SecretError> {
    if !path.is_absolute() {
        return Err(SecretError::InvalidInputs);
    }
    // Inspect the opened descriptor so a pathname replacement cannot bypass checks.
    // NONBLOCK also prevents a selected FIFO from hanging before its type is checked.
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| SecretError::InvalidInputs)?,
    );
    let metadata = file.metadata().map_err(|_| SecretError::InvalidInputs)?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err(SecretError::InvalidInputs);
    }
    Ok(file)
}

fn private_copy(mut input: impl Read, path: &Path) -> Result<u64, SecretError> {
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| SecretError::Unavailable)?;
    io::copy(&mut input, &mut output).map_err(|_| SecretError::Unavailable)
}

/// Prove that this host's supplied identity works without ambient recovery credentials.
pub fn verify_host_identity(key: &Path, ciphertext: &Path, sops: &Path) -> Result<(), SecretError> {
    let key = regular_input(key)?;
    let metadata = key.metadata().map_err(|_| SecretError::InvalidInputs)?;
    if metadata.uid() != rustix::process::getuid().as_raw()
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
        || metadata.len() > MAX_KEY_BYTES
    {
        return Err(SecretError::InvalidInputs);
    }
    let ciphertext = regular_input(ciphertext)?;
    if ciphertext
        .metadata()
        .map_err(|_| SecretError::InvalidInputs)?
        .len()
        > MAX_CIPHERTEXT_BYTES
    {
        return Err(SecretError::CiphertextTooLarge);
    }
    if !sops.is_absolute()
        || !fs::metadata(sops)
            .is_ok_and(|metadata| metadata.is_file() && metadata.mode() & 0o111 != 0)
    {
        return Err(SecretError::InvalidInputs);
    }

    let isolated = tempfile::tempdir().map_err(|_| SecretError::Unavailable)?;
    fs::set_permissions(isolated.path(), fs::Permissions::from_mode(0o700))
        .map_err(|_| SecretError::Unavailable)?;
    let home = isolated.path();
    let key_copy = home.join("host.age");
    let ciphertext_copy = home.join("host.sops.yaml");
    let key_size = private_copy(key.take(MAX_KEY_BYTES + 1), &key_copy)?;
    if key_size == 0 || key_size > MAX_KEY_BYTES {
        return Err(SecretError::InvalidInputs);
    }
    let ciphertext_size =
        private_copy(ciphertext.take(MAX_CIPHERTEXT_BYTES + 1), &ciphertext_copy)?;
    if ciphertext_size > MAX_CIPHERTEXT_BYTES {
        return Err(SecretError::CiphertextTooLarge);
    }
    if ciphertext_size == 0 {
        return Err(SecretError::InvalidInputs);
    }
    for directory in ["config", "gnupg"] {
        fs::create_dir(home.join(directory)).map_err(|_| SecretError::Unavailable)?;
        fs::set_permissions(home.join(directory), fs::Permissions::from_mode(0o700))
            .map_err(|_| SecretError::Unavailable)?;
    }
    let mut command = Command::new(sops);
    command
        .args(["--decrypt", "--input-type", "yaml", "--output-type", "yaml"])
        .arg(&ciphertext_copy)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home.join("config"))
        .env("GNUPGHOME", home.join("gnupg"))
        .env("SOPS_GPG_EXEC", "/usr/bin/false")
        .env("AWS_EC2_METADATA_DISABLED", "true")
        .env("SOPS_AGE_KEY_FILE", &key_copy)
        .stdin(Stdio::null());
    // Decrypted plaintext must go straight to /dev/null, never into a capture buffer.
    let status = process::run_silent(&mut command, Duration::from_secs(30))
        .map_err(|_| SecretError::Unavailable)?;
    if status.success() {
        Ok(())
    } else {
        Err(SecretError::VerificationFailed)
    }
}
