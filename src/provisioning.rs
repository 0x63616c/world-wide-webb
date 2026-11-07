//! Local base-host secret preparation. This module never publishes or deploys.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
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
    pub tailscale_auth: String,
}

#[derive(Clone, Debug)]
pub struct Details {
    pub host: String,
    pub host_recipient: String,
    pub recovery_recipient: String,
    pub host_key_path: PathBuf,
    pub recovery_key_path: PathBuf,
    pub ciphertext_path: PathBuf,
    pub review_directory: PathBuf,
    pub completed: bool,
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct EnrollmentReceipt {
    schema: u8,
    repository: String,
    host: String,
    key_id: String,
    expires_at: i64,
    ciphertext_sha256: String,
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
    #[error(
        "The password-manager identity could not be restored or matched. Unlock the vault and preserve local keys before retrying."
    )]
    Backup,
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
            Self::Backup => "provisioning-backup-failed",
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
    repository: String,
    details: Details,
    tools: Tools,
    directory: PathBuf,
    _lock: StateLock,
}

struct StateLock(File);

impl Drop for StateLock {
    fn drop(&mut self) {
        // A concurrently spawned child can retain this open-file description
        // until exec; closing our descriptor alone would prolong its BSD lock.
        let _ = flock(&self.0, FlockOperation::Unlock);
    }
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

fn copy_identity_file(source: &Path, destination: &Path) -> Result<(), Error> {
    let bytes = read_private(source, 4096)?;
    match fs::symlink_metadata(destination) {
        Ok(_) if read_private(destination, 4096)? == bytes => Ok(()),
        Ok(_) => Err(Error::Identity),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            write_new(destination, &bytes)
        }
        Err(_) => Err(Error::UnsafeState),
    }
}

/// Renewal retires attempts, not identities. The separate durable copy also
/// survives interruption between moving the old attempt and opening its successor.
fn preserve_identity(root: &Path, host: &str, directory: &Path) -> Result<(), Error> {
    let identities = root.join("identities");
    private_directory(&identities)?;
    let saved = identities.join(host);
    private_directory(&saved)?;
    for name in ["host-age-key.txt", "identity.json"] {
        copy_identity_file(&directory.join(name), &saved.join(name))?;
    }
    Ok(())
}

fn restore_preserved_identity(root: &Path, host: &str, directory: &Path) -> Result<(), Error> {
    let identities = root.join("identities");
    match fs::symlink_metadata(&identities) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(Error::UnsafeState),
        Ok(_) => private_directory(&identities)?,
    }
    let saved = identities.join(host);
    match fs::symlink_metadata(&saved) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(Error::UnsafeState),
        Ok(_) => private_directory(&saved)?,
    }
    // Read both before writing either: incomplete preservation must not be
    // mistaken for permission to generate a new identity.
    for name in ["host-age-key.txt", "identity.json"] {
        read_private(&saved.join(name), 4096)?;
    }
    for name in ["host-age-key.txt", "identity.json"] {
        copy_identity_file(&saved.join(name), &directory.join(name))?;
    }
    Ok(())
}

fn token_valid(token: &str) -> bool {
    !token.is_empty() && token.len() <= 4096 && token.bytes().all(|byte| byte.is_ascii_graphic())
}

fn validate_ciphertext(bytes: &[u8], details: &Details) -> Result<(), Error> {
    validate_ciphertext_for(bytes, &details.host_recipient, &details.recovery_recipient)
}

fn base64(text: &str) -> bool {
    !text.is_empty()
        && text
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"+/=".contains(&byte))
}

fn encrypted_value(text: &str) -> bool {
    let Some(body) = text
        .strip_prefix("ENC[AES256_GCM,")
        .and_then(|text| text.strip_suffix(']'))
    else {
        return false;
    };
    let parts: Vec<_> = body.split(',').collect();
    parts.len() == 4
        && ["data:", "iv:", "tag:"]
            .iter()
            .enumerate()
            .all(|(index, prefix)| parts[index].strip_prefix(prefix).is_some_and(base64))
        && parts[3] == "type:str"
}

pub fn validate_ciphertext_for(
    bytes: &[u8],
    host_recipient: &str,
    recovery_recipient: &str,
) -> Result<(), Error> {
    let value: Value = serde_json::from_slice(bytes).map_err(|_| Error::Encryption)?;
    let object = value.as_object().ok_or(Error::Encryption)?;
    let fields: &[&str] = if object.contains_key("github-read-token") {
        &["tailscale-auth-key", "github-read-token"]
    } else {
        &["tailscale-auth-key"]
    };
    if object.len() != fields.len() + 1
        || !fields.iter().all(|key| {
            object
                .get(*key)
                .and_then(Value::as_str)
                .is_some_and(encrypted_value)
        })
    {
        return Err(Error::Encryption);
    }
    let sops = object.get("sops").ok_or(Error::Encryption)?;
    let metadata = sops.as_object().ok_or(Error::Encryption)?;
    if metadata.keys().any(|key| {
        ![
            "age",
            "mac",
            "lastmodified",
            "version",
            "unencrypted_suffix",
            "kms",
            "gcp_kms",
            "azure_kv",
            "hc_vault",
            "pgp",
            "key_groups",
        ]
        .contains(&key.as_str())
    }) || !sops
        .get("version")
        .and_then(Value::as_str)
        .is_some_and(|text| {
            !text.is_empty() && text.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        })
        || !sops
            .get("lastmodified")
            .and_then(Value::as_str)
            .is_some_and(|text| {
                !text.is_empty()
                    && text
                        .bytes()
                        .all(|b| b.is_ascii_digit() || b"TZ:.-+".contains(&b))
            })
        || sops
            .get("unencrypted_suffix")
            .is_some_and(|value| value.as_str() != Some("_unencrypted"))
    {
        return Err(Error::Encryption);
    }
    let age = sops
        .get("age")
        .and_then(Value::as_array)
        .ok_or(Error::Encryption)?;
    for entry in age {
        if entry.as_object().is_none_or(|entry| {
            entry.len() != 2 || !entry.contains_key("recipient") || !entry.contains_key("enc")
        }) {
            return Err(Error::Encryption);
        }
        let armor = entry["enc"].as_str().ok_or(Error::Encryption)?;
        let payload = armor
            .trim()
            .strip_prefix("-----BEGIN AGE ENCRYPTED FILE-----\n")
            .and_then(|text| text.strip_suffix("\n-----END AGE ENCRYPTED FILE-----"))
            .ok_or(Error::Encryption)?;
        if !payload.lines().all(base64) || payload.is_empty() {
            return Err(Error::Encryption);
        }
    }
    let mut recipients: Vec<_> = age
        .iter()
        .filter_map(|entry| entry.get("recipient").and_then(Value::as_str))
        .collect();
    recipients.sort_unstable();
    let mut expected = vec![host_recipient, recovery_recipient];
    expected.sort_unstable();
    if age.len() != 2
        || recipients != expected
        || !sops
            .get("mac")
            .and_then(Value::as_str)
            .is_some_and(encrypted_value)
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

fn lock_state(directory: &Path) -> Result<StateLock, Error> {
    lock_named(directory, ".lock")
}

pub struct EnrollmentLock {
    _lock: StateLock,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ApprovedInstallation {
    schema: u8,
    pub repository: String,
    pub host: String,
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair: Option<crate::setup_repair::Selection>,
}

pub fn approved_installation(
    root: &Path,
    host: &str,
) -> Result<Option<ApprovedInstallation>, Error> {
    if !crate::config::valid_host(host) {
        return Err(Error::InvalidInput);
    }
    let directory = root.join("installations");
    for path in [root, directory.as_path()] {
        match fs::symlink_metadata(path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Error::UnsafeState),
            Ok(_) => private_directory(path)?,
        }
    }
    let path = directory.join(format!("{host}.json"));
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::UnsafeState),
        Ok(_) => {}
    }
    let saved: ApprovedInstallation =
        serde_json::from_slice(&read_private(&path, 4096)?).map_err(|_| Error::UnsafeState)?;
    if saved.schema != 1
        || saved.host != host
        || crate::config::setup_binding(&saved.repository, host, &saved.revision).is_none()
    {
        return Err(Error::UnsafeState);
    }
    if saved
        .repair
        .as_ref()
        .is_some_and(|repair| !repair.matches(&saved.repository, host, &saved.revision))
    {
        return Err(Error::UnsafeState);
    }
    let binding: Value =
        serde_json::from_slice(&read_private(&root.join("repository.json"), 4096)?)
            .map_err(|_| Error::UnsafeState)?;
    if binding != json!({"schema":1,"repository":saved.repository}) {
        return Err(Error::RepositoryMismatch);
    }
    Ok(Some(saved))
}

/// Keep the approved commit before the first target mutation. Later changes on
/// main must not change which configuration a disconnected setup resumes.
pub fn save_approved_installation(
    root: &Path,
    repository: &str,
    host: &str,
    revision: &str,
) -> Result<(), Error> {
    if crate::config::setup_binding(repository, host, revision).is_none() {
        return Err(Error::InvalidInput);
    }
    let _lock = lock_state(root)?;
    bind_locked(root, repository)?;
    let directory = root.join("installations");
    private_directory(&directory)?;
    let previous = approved_installation(root, host)?;
    if previous
        .as_ref()
        .is_some_and(|saved| saved.repair.is_some() && saved.revision != revision)
    {
        return Err(Error::UnsafeState);
    }
    let repair = previous.and_then(|saved| {
        (saved.revision == revision)
            .then_some(saved.repair)
            .flatten()
    });
    let saved = ApprovedInstallation {
        schema: 1,
        repository: repository.into(),
        host: host.into(),
        revision: revision.into(),
        repair,
    };
    let mut file = tempfile::NamedTempFile::new_in(&directory).map_err(|_| Error::Save)?;
    serde_json::to_writer(&mut file, &saved).map_err(|_| Error::Save)?;
    file.as_file().sync_all().map_err(|_| Error::Save)?;
    file.persist(directory.join(format!("{host}.json")))
        .map_err(|_| Error::Save)?;
    sync_directory(&directory)
}

/// Freeze repair selection without changing the original approval or credentials.
pub fn save_installation_repair(
    root: &Path,
    host: &str,
    selection: &crate::setup_repair::Selection,
) -> Result<(), Error> {
    let _lock = lock_state(root)?;
    let mut saved = approved_installation(root, host)?.ok_or(Error::UnsafeState)?;
    if !selection.matches(&saved.repository, host, &saved.revision)
        || saved
            .repair
            .as_ref()
            .is_some_and(|existing| existing != selection)
    {
        return Err(Error::UnsafeState);
    }
    saved.repair = Some(selection.clone());
    let directory = root.join("installations");
    let mut file = tempfile::NamedTempFile::new_in(&directory).map_err(|_| Error::Save)?;
    serde_json::to_writer(&mut file, &saved).map_err(|_| Error::Save)?;
    file.as_file().sync_all().map_err(|_| Error::Save)?;
    file.persist(directory.join(format!("{host}.json")))
        .map_err(|_| Error::Save)?;
    sync_directory(&directory)
}

/// Keep this guard for the entire interactive journey, including merge waits
/// and installation. Individual credential sessions use a separate short lock.
pub fn lock_enrollment(directory: &Path) -> Result<EnrollmentLock, Error> {
    Ok(EnrollmentLock {
        _lock: lock_named(directory, ".enrollment-lock")?,
    })
}

pub fn enrollment_attempt(
    root: &Path,
    repository: &str,
    host: &str,
) -> Result<crate::enrollment_reservation::Attempt, Error> {
    if !crate::config::valid_host(host) {
        return Err(Error::InvalidInput);
    }
    let _lock = lock_state(root)?;
    bind_locked(root, repository)?;
    let directory = root.join("attempts");
    private_directory(&directory)?;
    let path = directory.join(format!("{host}.json"));
    match fs::symlink_metadata(&path) {
        Ok(_) => {
            let attempt: crate::enrollment_reservation::Attempt =
                serde_json::from_slice(&read_private(&path, 4096)?)
                    .map_err(|_| Error::UnsafeState)?;
            if !crate::enrollment_reservation::valid_attempt(&attempt)
                || attempt.repository != repository
                || attempt.host != host
            {
                return Err(Error::UnsafeState);
            }
            Ok(attempt)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut random = [0_u8; 32];
            File::open("/dev/urandom")
                .and_then(|mut file| file.read_exact(&mut random))
                .map_err(|_| Error::Save)?;
            let attempt = crate::enrollment_reservation::Attempt {
                id: random.iter().map(|byte| format!("{byte:02x}")).collect(),
                repository: repository.into(),
                host: host.into(),
            };
            write_new(
                &path,
                &serde_json::to_vec(&attempt).map_err(|_| Error::Save)?,
            )?;
            Ok(attempt)
        }
        Err(_) => Err(Error::UnsafeState),
    }
}

fn lock_named(directory: &Path, name: &str) -> Result<StateLock, Error> {
    private_directory(directory)?;
    let path = directory.join(name);
    if !path.exists() {
        match write_new(&path, b"") {
            Ok(()) => {}
            Err(_) if path.exists() => {}
            Err(error) => return Err(error),
        }
    }
    let lock = private_file(&path)?;
    flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|_| Error::Busy)?;
    Ok(StateLock(lock))
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

fn existing_private_directory(path: &Path) -> Result<bool, Error> {
    match fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err(Error::UnsafeState),
        Ok(metadata)
            if metadata.is_dir()
                && metadata.uid() == rustix::process::geteuid().as_raw()
                && metadata.mode() & 0o077 == 0 =>
        {
            Ok(true)
        }
        Ok(_) => Err(Error::UnsafeState),
    }
}

/// Detect resumable preparation without opening keys or creating state directories.
pub fn has_saved_preparation(root: &Path, repository: &str, host: &str) -> Result<bool, Error> {
    if !root.is_absolute()
        || !crate::config::valid_repository(repository)
        || !crate::config::valid_host(host)
    {
        return Err(Error::InvalidInput);
    }
    let hosts = root.join("hosts");
    let directory = hosts.join(host);
    for path in [root, hosts.as_path(), directory.as_path()] {
        if !existing_private_directory(path)? {
            return Ok(false);
        }
    }
    let binding: Value =
        serde_json::from_slice(&read_private(&root.join("repository.json"), 4096)?)
            .map_err(|_| Error::UnsafeState)?;
    if binding != json!({"schema":1,"repository":repository}) {
        return Err(Error::RepositoryMismatch);
    }
    let receipt = directory.join("identity.json");
    match fs::symlink_metadata(&receipt) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(_) => return Err(Error::UnsafeState),
        Ok(_) => {}
    }
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields, rename_all = "camelCase")]
    struct PreparedIdentity {
        schema: u8,
        host: String,
        host_recipient: String,
        recovery_recipient: String,
    }
    let identity: PreparedIdentity =
        serde_json::from_slice(&read_private(&receipt, 4096)?).map_err(|_| Error::UnsafeState)?;
    let valid_recipient = |value: &str| {
        value.starts_with("age1")
            && value.len() == 62
            && value
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
    };
    if identity.schema != 1
        || identity.host != host
        || !valid_recipient(&identity.host_recipient)
        || !valid_recipient(&identity.recovery_recipient)
        || identity.host_recipient == identity.recovery_recipient
    {
        return Err(Error::UnsafeState);
    }
    Ok(true)
}

/// The repository-wide recovery receipt pins the destination even if a backup
/// write was interrupted. Reading it must not create a new provisioning session.
pub fn recorded_backup_vault(root: &Path, repository: &str) -> Result<Option<String>, Error> {
    if !root.is_absolute() || !crate::config::valid_repository(repository) {
        return Err(Error::InvalidInput);
    }
    if !existing_private_directory(root)? {
        return Ok(None);
    }
    let path = root.join("repository.json");
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if ["recovery-backup.json", "hosts", "retired"]
                .iter()
                .any(|name| fs::symlink_metadata(root.join(name)).is_ok())
            {
                return Err(Error::UnsafeState);
            }
            return Ok(None);
        }
        Err(_) => return Err(Error::UnsafeState),
        Ok(_) => {}
    }
    let binding: Value =
        serde_json::from_slice(&read_private(&path, 4096)?).map_err(|_| Error::UnsafeState)?;
    if binding != json!({"schema":1,"repository":repository}) {
        return Err(Error::RepositoryMismatch);
    }
    let mut vault = crate::secret_store::recorded_vault(
        &root.join("recovery-backup.json"),
        repository,
        "recovery",
        false,
    )
    .map_err(|_| Error::Backup)?;
    // A missing recovery receipt must not allow other retained backups to move.
    let mut hosts = std::collections::BTreeSet::new();
    for parent in [root.join("hosts"), root.join("retired")] {
        if !existing_private_directory(&parent)? {
            continue;
        }
        for entry in fs::read_dir(parent).map_err(|_| Error::UnsafeState)? {
            let entry = entry.map_err(|_| Error::UnsafeState)?;
            let host = entry
                .file_name()
                .into_string()
                .map_err(|_| Error::UnsafeState)?;
            if !crate::config::valid_host(&host) || hosts.len() >= 128 {
                return Err(Error::UnsafeState);
            }
            hosts.insert(host);
        }
    }
    for host in hosts {
        for directory in backup_directories(root, &host)? {
            if let Some(saved) = crate::secret_store::recorded_vault(
                &directory.join("host-backup.json"),
                repository,
                &host,
                false,
            )
            .map_err(|_| Error::Backup)?
            {
                if vault.as_ref().is_some_and(|vault| *vault != saved) {
                    return Err(Error::Backup);
                }
                vault = Some(saved);
            }
        }
    }
    Ok(vault)
}

fn backup_directories(root: &Path, host: &str) -> Result<Vec<PathBuf>, Error> {
    let mut candidates = Vec::new();
    for parent in [root.join("hosts"), root.join("retired")] {
        if !existing_private_directory(&parent)? {
            continue;
        }
        let directory = parent.join(host);
        if !existing_private_directory(&directory)? {
            continue;
        }
        if parent == root.join("hosts") {
            candidates.push(directory);
        } else {
            for entry in fs::read_dir(directory).map_err(|_| Error::UnsafeState)? {
                let path = entry.map_err(|_| Error::UnsafeState)?.path();
                let name = path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .ok_or(Error::UnsafeState)?;
                if name.len() != 64
                    || !name.bytes().all(|byte| byte.is_ascii_hexdigit())
                    || !existing_private_directory(&path)?
                    || candidates.len() >= 128
                {
                    return Err(Error::UnsafeState);
                }
                candidates.push(path);
            }
        }
    }
    Ok(candidates)
}

/// Legacy eligibility requires both verified backup receipts and a host-bound
/// identity. A directory or an unfinished backup intent is not evidence of setup.
pub fn legacy_backup_vault(
    root: &Path,
    repository: &str,
    host: &str,
) -> Result<Option<String>, Error> {
    if !crate::config::valid_host(host) {
        return Err(Error::InvalidInput);
    }
    let Some(vault) = recorded_backup_vault(root, repository)? else {
        return Ok(None);
    };
    crate::secret_store::recorded_vault(
        &root.join("recovery-backup.json"),
        repository,
        "recovery",
        true,
    )
    .map_err(|_| Error::Backup)?
    .ok_or(Error::Backup)?;
    let candidates = backup_directories(root, host)?;
    let mut verified = false;
    for directory in candidates {
        let receipt = directory.join("identity.json");
        match fs::symlink_metadata(&receipt) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => return Err(Error::UnsafeState),
            Ok(_) => {}
        }
        let identity: Value = serde_json::from_slice(&read_private(&receipt, 4096)?)
            .map_err(|_| Error::UnsafeState)?;
        let host_recipient = identity
            .get("hostRecipient")
            .and_then(Value::as_str)
            .ok_or(Error::UnsafeState)?;
        let recovery = identity
            .get("recoveryRecipient")
            .and_then(Value::as_str)
            .ok_or(Error::UnsafeState)?;
        if host_recipient == recovery
            || !host_recipient.starts_with("age1")
            || !recovery.starts_with("age1")
            || identity
                != json!({"schema":1,"host":host,"hostRecipient":host_recipient,"recoveryRecipient":recovery})
        {
            return Err(Error::UnsafeState);
        }
        if let Some(saved) = crate::secret_store::recorded_vault(
            &directory.join("host-backup.json"),
            repository,
            host,
            true,
        )
        .map_err(|_| Error::Backup)?
        {
            if saved != vault {
                return Err(Error::Backup);
            }
            verified = true;
        }
    }
    Ok(verified.then_some(vault))
}

impl Session {
    pub fn open(
        host: &str,
        repository: &str,
        state_directory: &Path,
        tools: &Tools,
    ) -> Result<Self, Error> {
        Self::open_inner(host, repository, state_directory, tools, None)
    }

    pub fn open_with_store(
        host: &str,
        repository: &str,
        state_directory: &Path,
        tools: &Tools,
        store: &dyn crate::secret_store::Store,
        vault: &str,
    ) -> Result<Self, Error> {
        if recorded_backup_vault(state_directory, repository)?.is_some_and(|saved| saved != vault) {
            return Err(Error::Backup);
        }
        Self::open_inner(
            host,
            repository,
            state_directory,
            tools,
            Some((store, vault)),
        )
    }

    fn open_inner(
        host: &str,
        repository: &str,
        state_directory: &Path,
        tools: &Tools,
        backup: Option<(&dyn crate::secret_store::Store, &str)>,
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
        restore_preserved_identity(state_directory, host, &directory)?;
        if let Some((store, vault)) = backup {
            for (role, path) in [("recovery", &recovery_key_path), (host, &host_key_path)] {
                crate::secret_store::restore(
                    store,
                    vault,
                    repository,
                    role,
                    path,
                    &tools.age_keygen,
                )
                .map_err(|_| Error::Backup)?;
            }
        }
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
            // Legacy token files remain untouched; Git now uses a target-local deploy key.
            details.completed = true;
        } else if fs::symlink_metadata(directory.join("github-read-token")).is_ok()
            || fs::symlink_metadata(&details.review_directory).is_ok()
        {
            return Err(Error::Interrupted);
        }
        Ok(Self {
            repository: repository.into(),
            details,
            tools: tools.clone(),
            directory,
            _lock: lock,
        })
    }

    pub fn details(&self) -> Details {
        self.details.clone()
    }

    /// Keep resolved provider identity outside retired preparations so renewal
    /// cannot silently select a replacement item with the same display name.
    pub fn bind_issuer(
        &self,
        identity: &crate::tailscale_oauth::ResolvedIdentity,
    ) -> Result<(), Error> {
        if !identity.valid() {
            return Err(Error::UnsafeState);
        }
        let root = self
            .directory
            .parent()
            .and_then(Path::parent)
            .ok_or(Error::UnsafeState)?;
        let directory = root.join("issuers");
        private_directory(&directory)?;
        let path = directory.join(format!("{}.json", self.details.host));
        let expected = serde_json::to_vec(
            &json!({"schema":1,"repository":self.repository,"identity":identity}),
        )
        .map_err(|_| Error::UnsafeState)?;
        match fs::symlink_metadata(&path) {
            Ok(_) if read_private(&path, 4096)? == expected => Ok(()),
            Ok(_) => Err(Error::UnsafeState),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                write_new(&path, &expected)
            }
            Err(_) => Err(Error::UnsafeState),
        }
    }

    pub fn record_issuance(&self, key_id: &str, expires_at: i64) -> Result<(), Error> {
        if key_id.is_empty()
            || key_id.len() > 128
            || expires_at <= 0
            || !key_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err(Error::UnsafeState);
        }
        write_new(
            &self.directory.join("issuance.json"),
            &serde_json::to_vec(&json!({
                "schema":1,"repository":self.repository,"host":self.details.host,
                "keyId":key_id,"expiresAt":expires_at
            }))
            .map_err(|_| Error::Save)?,
        )
    }

    /// A failed revoke remains distinguishable from a confirmed revoke, and
    /// neither clears the unresolved issuance marker or makes ciphertext usable.
    pub fn record_revocation(
        &self,
        key_id: &str,
        expires_at: i64,
        confirmed: bool,
    ) -> Result<(), Error> {
        if key_id.is_empty()
            || key_id.len() > 128
            || expires_at <= 0
            || !key_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
        {
            return Err(Error::UnsafeState);
        }
        write_new(
            &self.directory.join("revocation.json"),
            &serde_json::to_vec(&json!({
                "schema":1,"repository":self.repository,"host":self.details.host,
                "keyId":key_id,"expiresAt":expires_at,"confirmed":confirmed
            }))
            .map_err(|_| Error::Save)?,
        )
    }

    pub fn bind_enrollment_config(
        &self,
        config: &crate::config::TailscaleConfig,
    ) -> Result<(), Error> {
        let path = self.directory.join("issuer.json");
        let expected = serde_json::to_vec(config).map_err(|_| Error::UnsafeState)?;
        match fs::symlink_metadata(&path) {
            Ok(_) if read_private(&path, 4096)? == expected => Ok(()),
            Ok(_) => Err(Error::UnsafeState),
            Err(error)
                if error.kind() == std::io::ErrorKind::NotFound && !self.details.completed =>
            {
                write_new(&path, &expected)
            }
            Err(_) => Err(Error::UnsafeState),
        }
    }

    pub fn backup(
        &self,
        store: &impl crate::secret_store::Store,
        vault: &str,
    ) -> Result<(), crate::secret_store::Error> {
        let details = &self.details;
        crate::secret_store::backup_file(
            store,
            vault,
            &self.repository,
            "recovery",
            &details.recovery_recipient,
            &details.recovery_key_path,
            &details
                .recovery_key_path
                .with_file_name("recovery-backup.json"),
        )?;
        crate::secret_store::backup_file(
            store,
            vault,
            &self.repository,
            &details.host,
            &details.host_recipient,
            &details.host_key_path,
            &self.directory.join("host-backup.json"),
        )?;
        Ok(())
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

    fn ciphertext_digest(&self) -> Result<String, Error> {
        if !self.details.completed {
            return Err(Error::UnsafeState);
        }
        let bytes = read_private(&self.details.ciphertext_path, 16384)?;
        Ok(Sha256::digest(bytes)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect())
    }

    pub fn record_enrollment(&self, key_id: &str, expires_at: i64) -> Result<(), Error> {
        if key_id.is_empty()
            || key_id.len() > 128
            || expires_at <= 0
            || !key_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
        {
            return Err(Error::UnsafeState);
        }
        let receipt = EnrollmentReceipt {
            schema: 1,
            repository: self.repository.clone(),
            host: self.details.host.clone(),
            key_id: key_id.into(),
            expires_at,
            ciphertext_sha256: self.ciphertext_digest()?,
        };
        let path = self.directory.join("enrollment.json");
        if fs::symlink_metadata(&path).is_ok() {
            let existing: EnrollmentReceipt = serde_json::from_slice(&read_private(&path, 4096)?)
                .map_err(|_| Error::UnsafeState)?;
            return if existing == receipt {
                Ok(())
            } else {
                Err(Error::UnsafeState)
            };
        }
        write_new(
            &path,
            &serde_json::to_vec(&receipt).map_err(|_| Error::Save)?,
        )
    }

    /// A preparation without issuer metadata cannot establish remaining lifetime.
    pub fn enrollment_valid_for(&self, now: i64, seconds: i64) -> Result<bool, Error> {
        if now <= 0 || seconds <= 0 {
            return Err(Error::UnsafeState);
        }
        let path = self.directory.join("enrollment.json");
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(Error::UnsafeState),
            Ok(_) => {}
        }
        let receipt: EnrollmentReceipt =
            serde_json::from_slice(&read_private(&path, 4096)?).map_err(|_| Error::UnsafeState)?;
        if receipt.schema != 1
            || receipt.repository != self.repository
            || receipt.host != self.details.host
            || receipt.ciphertext_sha256 != self.ciphertext_digest()?
        {
            return Err(Error::UnsafeState);
        }
        Ok(now
            .checked_add(seconds)
            .is_some_and(|deadline| receipt.expires_at > deadline))
    }

    /// Call only after checking that bootstrap has not started and resolving any
    /// open proposal. Keep the complete old preparation for recovery and for an
    /// exact comparison when replacing its ciphertext through a new PR.
    pub fn retire_for_renewal(self, now: i64, required_lifetime: i64) -> Result<PathBuf, Error> {
        if !self.details.completed || self.enrollment_valid_for(now, required_lifetime)? {
            return Err(Error::UnsafeState);
        }
        let root = self
            .directory
            .parent()
            .and_then(Path::parent)
            .ok_or(Error::UnsafeState)?;
        let parent = root.join("retired").join(&self.details.host);
        preserve_identity(root, &self.details.host, &self.directory)?;
        private_directory(&root.join("retired"))?;
        private_directory(&parent)?;
        let destination = parent.join(self.ciphertext_digest()?);
        match fs::symlink_metadata(&destination) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            _ => return Err(Error::UnsafeState),
        }
        fs::rename(&self.directory, &destination).map_err(|_| Error::Save)?;
        sync_directory(&parent)?;
        sync_directory(self.directory.parent().ok_or(Error::UnsafeState)?)?;
        Ok(destination)
    }

    pub fn matches_retired_ciphertext(&self, ciphertext: &[u8]) -> Result<bool, Error> {
        validate_ciphertext(ciphertext, &self.details)?;
        let digest: String = Sha256::digest(ciphertext)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        let root = self
            .directory
            .parent()
            .and_then(Path::parent)
            .ok_or(Error::UnsafeState)?;
        let directory = root.join("retired").join(&self.details.host).join(digest);
        match fs::symlink_metadata(&directory) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(Error::UnsafeState),
            Ok(_) => private_directory(&directory)?,
        }
        let path = directory
            .join("review")
            .join(format!("{}.sops.yaml", self.details.host));
        if read_private(&path, 16384)? != ciphertext {
            return Err(Error::UnsafeState);
        }
        let mut previous = self.details.clone();
        previous.ciphertext_path = path;
        verify(&previous, &self.tools)?;
        Ok(true)
    }

    pub fn encrypt(&mut self, tokens: BaseTokens) -> Result<Details, Error> {
        if self.details.completed {
            return Err(Error::AlreadyCompleted);
        }
        if !token_valid(&tokens.tailscale_auth) {
            return Err(Error::InvalidToken);
        }
        let home = tempfile::tempdir().map_err(|_| Error::Save)?;
        let config = home.path().join("sops.yaml");
        write_new(&config, b"creation_rules:\n  - path_regex: .*\n")?;
        let mut input = tempfile::tempfile().map_err(|_| Error::Save)?;
        serde_json::to_writer(
            &mut input,
            &json!({"tailscale-auth-key":tokens.tailscale_auth}),
        )
        .map_err(|_| Error::Save)?;
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
            "The enrollment wizard publishes {}.sops.yaml as secrets/{}.sops.yaml through a configuration PR.\nIt preserves other host rules and binds installation to the approved merge revision.\nOnly ciphertext and public metadata belong in Git. Adjacent private identity files must never be committed.\nResume the wizard to continue; no manual file copying or CI artifact selection is needed.\n",
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

#[cfg(test)]
mod lock_tests {
    use super::*;

    #[test]
    fn preparation_lookup_is_read_only_and_repository_bound() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("not-created");
        assert!(!has_saved_preparation(&root, "example/config", "test-mac").unwrap());
        assert!(!root.exists());

        let host = root.join("hosts/test-mac");
        private_directory(&host).unwrap();
        write_new(
            &root.join("repository.json"),
            br#"{"schema":1,"repository":"example/config"}"#,
        )
        .unwrap();
        let receipt = serde_json::to_vec(&json!({
            "schema":1, "host":"test-mac",
            "hostRecipient":format!("age1{}", "q".repeat(58)),
            "recoveryRecipient":format!("age1{}", "p".repeat(58))
        }))
        .unwrap();
        write_new(&host.join("identity.json"), &receipt).unwrap();
        assert!(has_saved_preparation(&root, "example/config", "test-mac").unwrap());
        assert!(!root.join(".lock").exists());
        assert!(matches!(
            has_saved_preparation(&root, "other/config", "test-mac"),
            Err(Error::RepositoryMismatch)
        ));
        assert!(!has_saved_preparation(&root, "example/config", "another-mac").unwrap());
        assert!(!root.join("hosts/another-mac").exists());
        fs::remove_file(host.join("identity.json")).unwrap();
        std::os::unix::fs::symlink(root.join("repository.json"), host.join("identity.json"))
            .unwrap();
        assert!(matches!(
            has_saved_preparation(&root, "example/config", "test-mac"),
            Err(Error::UnsafeState)
        ));
    }

    #[test]
    fn retained_descriptor_does_not_prolong_a_finished_session_lock() {
        let temporary = tempfile::tempdir().unwrap();
        let directory = temporary.path().join("state");
        private_directory(&directory).unwrap();
        let first = lock_state(&directory).unwrap();
        let inherited = first.0.try_clone().unwrap();
        assert!(matches!(lock_state(&directory), Err(Error::Busy)));
        drop(first);
        let second = lock_state(&directory).unwrap();
        assert!(matches!(lock_state(&directory), Err(Error::Busy)));
        drop(inherited);
        assert!(matches!(lock_state(&directory), Err(Error::Busy)));
        drop(second);
        assert!(lock_state(&directory).is_ok());
    }
}
