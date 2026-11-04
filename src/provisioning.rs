//! Local base-host secret preparation. This module never publishes or deploys.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use serde_json::{Value, json};
use thiserror::Error;

use crate::{process, secrets};

#[derive(Clone)]
pub struct Tools {
    pub age_keygen: PathBuf,
    pub sops: PathBuf,
}

impl Tools {
    pub fn discover() -> Result<Self, Error> {
        let mut directories = Vec::new();
        if let Ok(executable) = std::env::current_exe()
            && let Some(parent) = executable.parent()
        {
            directories.push(parent.to_path_buf());
        }
        directories.extend([
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
        ]);
        if let Some(path) = std::env::var_os("PATH") {
            directories.extend(std::env::split_paths(&path));
        }
        let find = |name| {
            directories
                .iter()
                .filter(|path| path.is_absolute())
                .map(|path| path.join(name))
                .find(|path| {
                    fs::metadata(path)
                        .is_ok_and(|metadata| metadata.is_file() && metadata.mode() & 0o111 != 0)
                })
                .ok_or(Error::ToolsUnavailable)
        };
        Ok(Self {
            age_keygen: find("age-keygen")?,
            sops: find("sops")?,
        })
    }
}

pub struct BaseTokens {
    pub github_read: String,
    pub tailscale_auth: String,
}

#[derive(Clone, Debug)]
pub struct Details {
    pub host: String,
    pub host_recipient: String,
    pub recovery_recipient: String,
    pub host_key_path: PathBuf,
    pub recovery_key_path: PathBuf,
    pub github_token_path: PathBuf,
    pub ciphertext_path: PathBuf,
    pub review_directory: PathBuf,
    pub completed: bool,
}

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Install the age and sops command-line tools before preparing secrets.")]
    ToolsUnavailable,
    #[error("Choose a configured host and a private absolute state directory.")]
    InvalidInput,
    #[error("Provisioning state is not a private, safely owned regular file or directory.")]
    UnsafeState,
    #[error("Another provisioning session is open.")]
    Busy,
    #[error("These private identities belong to another repository.")]
    RepositoryMismatch,
    #[error(
        "An interrupted preparation needs inspection. Existing keys and tokens were preserved."
    )]
    Interrupted,
    #[error("Age identity generation or validation failed. Existing identities were preserved.")]
    Identity,
    #[error("Enter each token without spaces or line breaks, using at most 4096 ASCII characters.")]
    InvalidToken,
    #[error("Secret encryption or independent recovery verification failed.")]
    Encryption,
    #[error("This host already has completed secret preparation; its tokens were not replaced.")]
    AlreadyCompleted,
    #[error("Private provisioning state could not be saved durably. Inspect it before retrying.")]
    Save,
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::ToolsUnavailable => "provisioning-tools-missing",
            Self::InvalidInput => "provisioning-invalid-input",
            Self::UnsafeState => "provisioning-unsafe-state",
            Self::Busy => "provisioning-busy",
            Self::RepositoryMismatch => "provisioning-repository-mismatch",
            Self::Interrupted => "provisioning-interrupted",
            Self::Identity => "provisioning-identity-failed",
            Self::InvalidToken => "provisioning-invalid-token",
            Self::Encryption => "provisioning-encryption-failed",
            Self::AlreadyCompleted => "provisioning-already-complete",
            Self::Save => "provisioning-save-failed",
        }
    }
    pub fn next_action(&self) -> &'static str {
        match self {
            Self::ToolsUnavailable => {
                "Use Homebrew to install age and sops, then reopen preparation."
            }
            Self::Busy => "Finish or close the other provisioning session before retrying.",
            Self::RepositoryMismatch => {
                "Preserve the existing identities and use their attached repository. Do not reuse them for another repository."
            }
            Self::InvalidToken => {
                "Paste the issued token into this local hidden field, never into chat."
            }
            Self::AlreadyCompleted => {
                "Resume using the saved files. Token rotation is a separate reviewed operation."
            }
            Self::Interrupted | Self::Save => {
                "Inspect the private state directory and retain recovery copies. Do not delete it or regenerate identities blindly."
            }
            Self::Identity | Self::Encryption => {
                "Check the local age/SOPS tools and private state. No target or repository was changed."
            }
            _ => {
                "Use the designated operator-owned private provisioning directory; do not select a repository or shared directory."
            }
        }
    }
}

pub struct Session {
    details: Details,
    tools: Tools,
    directory: PathBuf,
    _lock: File,
}

fn private_directory(path: &Path) -> Result<(), Error> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o077 != 0
        {
            return Err(Error::UnsafeState);
        }
        return Ok(());
    }
    let parent = path.parent().ok_or(Error::UnsafeState)?;
    if !parent.exists() {
        private_directory(parent)?;
    }
    fs::DirBuilder::new()
        .mode(0o700)
        .create(path)
        .map_err(|_| Error::UnsafeState)?;
    sync_directory(parent)
}

fn sync_directory(path: &Path) -> Result<(), Error> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| Error::Save)
}

fn private_file(path: &Path) -> Result<File, Error> {
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::UnsafeState)?,
    );
    let metadata = file.metadata().map_err(|_| Error::UnsafeState)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o777 != 0o600
    {
        return Err(Error::UnsafeState);
    }
    Ok(file)
}

fn read_private(path: &Path, limit: u64) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    private_file(path)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::UnsafeState)?;
    if bytes.len() as u64 > limit {
        return Err(Error::UnsafeState);
    }
    Ok(bytes)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), Error> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| Error::Save)?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|_| Error::Save)?;
    sync_directory(path.parent().ok_or(Error::Save)?)
}

fn isolated(executable: &Path, home: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home)
        .env("GNUPGHOME", home)
        .env("SOPS_GPG_EXEC", "/usr/bin/false")
        .env("AWS_EC2_METADATA_DISABLED", "true")
        .current_dir(home)
        .stdin(Stdio::null());
    command
}

fn recipient(key: &Path, tools: &Tools, home: &Path) -> Result<String, Error> {
    let bytes = read_private(key, 65536)?;
    if bytes.is_empty() {
        return Err(Error::Identity);
    }
    let mut command = isolated(&tools.age_keygen, home);
    command.arg("-y").arg(key);
    let output =
        process::capture(&mut command, Duration::from_secs(10)).map_err(|_| Error::Identity)?;
    if !output.status.success() {
        return Err(Error::Identity);
    }
    let recipient = std::str::from_utf8(&output.stdout)
        .map_err(|_| Error::Identity)?
        .trim();
    if recipient.len() != 62
        || !recipient.starts_with("age1")
        || !recipient
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    {
        return Err(Error::Identity);
    }
    Ok(recipient.into())
}

fn ensure_identity(path: &Path, tools: &Tools, home: &Path) -> Result<String, Error> {
    let marker = path.with_extension("creating");
    if fs::symlink_metadata(&marker).is_ok() {
        return Err(Error::Interrupted);
    }
    if fs::symlink_metadata(path).is_ok() {
        return recipient(path, tools, home);
    }
    write_new(
        &marker,
        b"Identity generation in progress. Do not regenerate without inspection.\n",
    )?;
    let mut command = isolated(&tools.age_keygen, home);
    command.arg("-o").arg(path);
    let status =
        process::run_silent(&mut command, Duration::from_secs(10)).map_err(|_| Error::Identity)?;
    if !status.success() {
        return Err(Error::Identity);
    }
    let result = recipient(path, tools, home)?;
    private_file(path)?.sync_all().map_err(|_| Error::Save)?;
    sync_directory(path.parent().ok_or(Error::Save)?)?;
    fs::remove_file(marker).map_err(|_| Error::Save)?;
    sync_directory(path.parent().ok_or(Error::Save)?)?;
    Ok(result)
}

fn token_valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= 4096 && token.bytes().all(|byte| byte.is_ascii_graphic())
}

fn validate_ciphertext(bytes: &[u8], details: &Details) -> Result<(), Error> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Error::Encryption)?;
    let object = value.as_object().ok_or(Error::Encryption)?;
    if object.len() != 3
        || !["tailscale-auth-key", "github-read-token"]
            .iter()
            .all(|key| {
                object
                    .get(*key)
                    .and_then(Value::as_str)
                    .is_some_and(|value| {
                        value.starts_with("ENC[AES256_GCM,") && value.ends_with(']')
                    })
            })
    {
        return Err(Error::Encryption);
    }
    let sops = object.get("sops").ok_or(Error::Encryption)?;
    let age = sops
        .get("age")
        .and_then(Value::as_array)
        .ok_or(Error::Encryption)?;
    let mut recipients: Vec<_> = age
        .iter()
        .filter_map(|entry| entry.get("recipient").and_then(Value::as_str))
        .collect();
    recipients.sort_unstable();
    let mut expected = vec![
        details.host_recipient.as_str(),
        details.recovery_recipient.as_str(),
    ];
    expected.sort_unstable();
    if age.len() != 2
        || recipients != expected
        || !sops
            .get("mac")
            .and_then(Value::as_str)
            .is_some_and(|mac| mac.starts_with("ENC[AES256_GCM,"))
    {
        return Err(Error::Encryption);
    }
    for provider in [
        "kms",
        "gcp_kms",
        "azure_kv",
        "hc_vault",
        "pgp",
        "key_groups",
    ] {
        if sops
            .get(provider)
            .is_some_and(|value| !value.is_null() && !value.as_array().is_some_and(Vec::is_empty))
        {
            return Err(Error::Encryption);
        }
    }
    Ok(())
}

fn verify(details: &Details, tools: &Tools) -> Result<(), Error> {
    let ciphertext = read_private(&details.ciphertext_path, 16384)?;
    validate_ciphertext(&ciphertext, details)?;
    for key in [&details.host_key_path, &details.recovery_key_path] {
        secrets::verify_host_identity(key, &details.ciphertext_path, &tools.sops)
            .map_err(|_| Error::Encryption)?;
    }
    Ok(())
}

fn lock_state(directory: &Path) -> Result<File, Error> {
    private_directory(directory)?;
    let path = directory.join(".lock");
    if !path.exists() {
        match write_new(&path, b"") {
            Ok(()) => {}
            Err(_) if path.exists() => {}
            Err(error) => return Err(error),
        }
    }
    let lock = private_file(&path)?;
    flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|_| Error::Busy)?;
    Ok(lock)
}

fn bind_locked(directory: &Path, repository: &str) -> Result<(), Error> {
    if !crate::config::valid_repository(repository) {
        return Err(Error::InvalidInput);
    }
    let path = directory.join("repository.json");
    let expected = json!({"schema":1,"repository":repository});
    if fs::symlink_metadata(&path).is_ok() {
        let saved: Value =
            serde_json::from_slice(&read_private(&path, 4096)?).map_err(|_| Error::UnsafeState)?;
        if saved != expected {
            return Err(Error::RepositoryMismatch);
        }
        Ok(())
    } else {
        write_new(
            &path,
            &serde_json::to_vec(&expected).map_err(|_| Error::Save)?,
        )
    }
}

/// This binding is shared by all inventories that use these private identities.
pub fn bind_repository(directory: &Path, repository: &str) -> Result<(), Error> {
    if !directory.is_absolute() || !crate::config::valid_repository(repository) {
        return Err(Error::InvalidInput);
    }
    let _lock = lock_state(directory)?;
    bind_locked(directory, repository)
}

impl Session {
    pub fn open(
        host: &str,
        repository: &str,
        state_directory: &Path,
        tools: &Tools,
    ) -> Result<Self, Error> {
        if !crate::inventory::supported_configuration(host)
            || !state_directory.is_absolute()
            || !tools.age_keygen.is_absolute()
            || !tools.sops.is_absolute()
        {
            return Err(Error::InvalidInput);
        }
        let lock = lock_state(state_directory)?;
        bind_locked(state_directory, repository)?;
        let hosts = state_directory.join("hosts");
        private_directory(&hosts)?;
        let directory = hosts.join(host);
        private_directory(&directory)?;
        if [".encrypting", ".enrollment-attempt"]
            .iter()
            .any(|name| fs::symlink_metadata(directory.join(name)).is_ok())
        {
            return Err(Error::Interrupted);
        }
        let home = tempfile::tempdir().map_err(|_| Error::Save)?;
        let recovery_key_path = state_directory.join("recovery-age-key.txt");
        let host_key_path = directory.join("host-age-key.txt");
        // Existing state is evidence of an issued identity, even before tokens
        // were entered. A missing key is loss to inspect, never a reason to rotate.
        let meaningful = |path: &Path| -> Result<bool, Error> {
            Ok(fs::read_dir(path)
                .map_err(|_| Error::UnsafeState)?
                .next()
                .is_some())
        };
        if meaningful(&directory)? && (!host_key_path.exists() || !recovery_key_path.exists()) {
            return Err(Error::Interrupted);
        }
        if !recovery_key_path.exists() {
            for entry in fs::read_dir(&hosts).map_err(|_| Error::UnsafeState)? {
                let path = entry.map_err(|_| Error::UnsafeState)?.path();
                private_directory(&path)?;
                if meaningful(&path)? {
                    return Err(Error::Interrupted);
                }
            }
        }
        let recovery_recipient = ensure_identity(&recovery_key_path, tools, home.path())?;
        let host_recipient = ensure_identity(&host_key_path, tools, home.path())?;
        if recovery_recipient == host_recipient {
            return Err(Error::Identity);
        }
        let identity_receipt = directory.join("identity.json");
        let public_identity = json!({"schema":1,"host":host,"hostRecipient":host_recipient,"recoveryRecipient":recovery_recipient});
        if fs::symlink_metadata(&identity_receipt).is_ok() {
            let saved: Value = serde_json::from_slice(&read_private(&identity_receipt, 4096)?)
                .map_err(|_| Error::UnsafeState)?;
            if saved != public_identity {
                return Err(Error::UnsafeState);
            }
        } else {
            write_new(
                &identity_receipt,
                &serde_json::to_vec(&public_identity).map_err(|_| Error::Save)?,
            )?;
        }
        let review_directory = directory.join("review");
        let mut details = Details {
            host: host.into(),
            host_recipient,
            recovery_recipient,
            host_key_path,
            recovery_key_path,
            github_token_path: directory.join("github-read-token"),
            ciphertext_path: review_directory.join(format!("{host}.sops.yaml")),
            review_directory,
            completed: false,
        };
        let completed = directory.join("state.json");
        if fs::symlink_metadata(&completed).is_ok() {
            let state: Value = serde_json::from_slice(&read_private(&completed, 4096)?)
                .map_err(|_| Error::UnsafeState)?;
            if state
                != json!({"schema":1,"host":host,"hostRecipient":details.host_recipient,"recoveryRecipient":details.recovery_recipient})
            {
                return Err(Error::UnsafeState);
            }
            private_directory(&details.review_directory)?;
            verify(&details, tools)?;
            let token = read_private(&details.github_token_path, 4096)?;
            if !std::str::from_utf8(&token).is_ok_and(token_valid) {
                return Err(Error::UnsafeState);
            }
            details.completed = true;
        } else if fs::symlink_metadata(&details.github_token_path).is_ok()
            || fs::symlink_metadata(&details.review_directory).is_ok()
        {
            return Err(Error::Interrupted);
        }
        Ok(Self {
            details,
            tools: tools.clone(),
            directory,
            _lock: lock,
        })
    }

    pub fn details(&self) -> Details {
        self.details.clone()
    }

    /// Claim before issuer mutation; an unknown result must survive a restart.
    pub fn claim_enrollment(&self) -> Result<(), Error> {
        write_new(
            &self.directory.join(".enrollment-attempt"),
            b"Inspect the Tailscale admin console before retrying this enrollment-key attempt.\n",
        )
    }

    pub fn finish_enrollment(&self) -> Result<(), Error> {
        fs::remove_file(self.directory.join(".enrollment-attempt")).map_err(|_| Error::Save)?;
        sync_directory(&self.directory)
    }

    pub fn encrypt(&mut self, tokens: BaseTokens) -> Result<Details, Error> {
        if self.details.completed {
            return Err(Error::AlreadyCompleted);
        }
        if !token_valid(&tokens.github_read) || !token_valid(&tokens.tailscale_auth) {
            return Err(Error::InvalidToken);
        }
        let home = tempfile::tempdir().map_err(|_| Error::Save)?;
        let config = home.path().join("sops.yaml");
        write_new(&config, b"creation_rules:\n  - path_regex: .*\n")?;
        let mut input = tempfile::tempfile().map_err(|_| Error::Save)?;
        serde_json::to_writer(&mut input, &json!({"tailscale-auth-key":tokens.tailscale_auth,"github-read-token":tokens.github_read})).map_err(|_| Error::Save)?;
        input.rewind().map_err(|_| Error::Save)?;
        let mut command = isolated(&self.tools.sops, home.path());
        command
            .args([
                "--encrypt",
                "--input-type",
                "json",
                "--output-type",
                "json",
                "--config",
            ])
            .arg(config)
            .arg("--age")
            .arg(format!(
                "{},{}",
                self.details.host_recipient, self.details.recovery_recipient
            ))
            .arg("/dev/stdin")
            .stdin(Stdio::from(input));
        let output = process::capture(&mut command, Duration::from_secs(30))
            .map_err(|_| Error::Encryption)?;
        if !output.status.success() {
            return Err(Error::Encryption);
        }
        validate_ciphertext(&output.stdout, &self.details)?;
        // JSON is a YAML subset: retaining it lets us inspect the encrypted
        // fields structurally without adding a second configuration parser.
        let staged = home.path().join("host.sops.yaml");
        write_new(&staged, &output.stdout)?;
        let mut staged_details = self.details.clone();
        staged_details.ciphertext_path = staged;
        verify(&staged_details, &self.tools)?;
        write_new(
            &self.directory.join(".encrypting"),
            b"Publishing verified preparation; inspect after interruption.\n",
        )?;
        write_new(
            &self.details.github_token_path,
            tokens.github_read.as_bytes(),
        )?;
        private_directory(&self.details.review_directory)?;
        write_new(&self.details.ciphertext_path, &output.stdout)?;
        let public = json!({"schema":1,"host":self.details.host,"hostRecipient":self.details.host_recipient,"recoveryRecipient":self.details.recovery_recipient});
        write_new(
            &self.details.review_directory.join("public.json"),
            &serde_json::to_vec_pretty(&public).map_err(|_| Error::Save)?,
        )?;
        let rule = format!(
            "creation_rules:\n  - path_regex: '^secrets/{}\\.sops\\.yaml$'\n    age: '{},{}'\n",
            self.details.host, self.details.host_recipient, self.details.recovery_recipient
        );
        write_new(
            &self.details.review_directory.join("sops-rule.yaml"),
            rule.as_bytes(),
        )?;
        let instructions = format!(
            "Only this review directory is suitable for repository review.\nAdd {}.sops.yaml to secrets/{}.sops.yaml. Merge the exact creation rule from sops-rule.yaml into .sops.yaml; preserve other host rules.\nReview the administrator SSH public key and host configuration separately. Never commit adjacent private keys or token files.\nDo not enable activation automatically. A reviewed commit and matching new CI artifact are required before bootstrap.\n",
            self.details.host, self.details.host
        );
        write_new(
            &self.details.review_directory.join("README.txt"),
            instructions.as_bytes(),
        )?;
        write_new(
            &self.directory.join("state.json"),
            &serde_json::to_vec(&public).map_err(|_| Error::Save)?,
        )?;
        fs::remove_file(self.directory.join(".encrypting")).map_err(|_| Error::Save)?;
        sync_directory(&self.directory)?;
        self.details.completed = true;
        Ok(self.details())
    }
}
