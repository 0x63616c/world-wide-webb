//! Verified recovery backups. Secret values never become arguments or diagnostics.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Unlock 1Password and allow this CLI to access the configured vault, then retry.")]
    Access,
    #[error("The saved identity does not match this setup. Existing backups were preserved.")]
    Conflict,
    #[error(
        "Backup creation could not be confirmed. Retry verification; another backup will not be created blindly."
    )]
    Unconfirmed,
    #[error(
        "The local identity or backup receipt is unsafe or unavailable. Preserve existing files."
    )]
    State,
}

pub struct Backup<'a> {
    pub repository: &'a str,
    pub role: &'a str,
    pub recipient: &'a str,
    pub identity: &'a str,
}

impl Backup<'_> {
    fn tag(&self) -> String {
        let digest = Sha256::digest(format!("{}\n{}", self.repository, self.role));
        let suffix: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        format!("homelab-backup-{suffix}")
    }
}

pub struct Item {
    pub id: String,
    pub vault: String,
    pub repository: String,
    pub role: String,
    pub recipient: String,
    pub identity: String,
}

pub trait Store {
    fn find(&self, vault: &str, tag: &str) -> Result<Vec<String>, Error>;
    fn read(&self, vault: &str, item: &str) -> Result<Item, Error>;
    fn create(&self, vault: &str, backup: &Backup<'_>, tag: &str) -> Result<String, Error>;
}

/// Discover by repository/role before generating keys on a replacement client.
/// The caller holds the provisioning lock; existing local identities are never replaced.
pub fn restore(
    store: &dyn Store,
    vault: &str,
    repository: &str,
    role: &str,
    destination: &Path,
    age_keygen: &Path,
) -> Result<bool, Error> {
    let tag = Backup {
        repository,
        role,
        recipient: "",
        identity: "",
    }
    .tag();
    let matches = store.find(vault, &tag)?;
    if matches.len() > 1 {
        return Err(Error::Conflict);
    }
    let Some(id) = matches.first() else {
        return Ok(false);
    };
    if !identifier(id) || !identifier(vault) {
        return Err(Error::State);
    }
    let item = store.read(vault, id)?;
    if item.id != *id
        || item.vault != vault
        || item.repository != repository
        || item.role != role
        || item.identity.len() > 8192
    {
        return Err(Error::Conflict);
    }
    let parent = destination.parent().ok_or(Error::State)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| Error::State)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::State);
    }
    let mut snapshot = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
    snapshot
        .write_all(item.identity.as_bytes())
        .map_err(|_| Error::State)?;
    let mut command = Command::new(age_keygen);
    command
        .arg("-y")
        .arg(snapshot.path())
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::null());
    let output = crate::process::capture(&mut command, Duration::from_secs(10))
        .map_err(|_| Error::Conflict)?;
    if !output.status.success()
        || std::str::from_utf8(&output.stdout).map(str::trim).ok() != Some(item.recipient.as_str())
    {
        return Err(Error::Conflict);
    }
    match fs::symlink_metadata(destination) {
        Ok(_) => {
            if read_private(destination)? != item.identity.as_bytes() {
                return Err(Error::Conflict);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            snapshot.as_file().sync_all().map_err(|_| Error::State)?;
            snapshot
                .persist_noclobber(destination)
                .map_err(|_| Error::State)?;
            File::open(parent)
                .and_then(|file| file.sync_all())
                .map_err(|_| Error::State)?;
        }
        Err(_) => return Err(Error::State),
    }
    Ok(true)
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema: u8,
    vault: String,
    tag: String,
    item: Option<String>,
}

/// Read the existing destination before any restore or backup can mutate state.
pub(crate) fn recorded_vault(
    receipt: &Path,
    repository: &str,
    role: &str,
    require_verified: bool,
) -> Result<Option<String>, Error> {
    match fs::symlink_metadata(receipt) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::State),
        Ok(_) => {}
    }
    let saved: Receipt =
        serde_json::from_slice(&read_private(receipt)?).map_err(|_| Error::State)?;
    let tag = Backup {
        repository,
        role,
        recipient: "",
        identity: "",
    }
    .tag();
    if saved.schema != 1
        || saved.tag != tag
        || !identifier(&saved.vault)
        || saved.item.as_ref().is_some_and(|item| !identifier(item))
    {
        return Err(Error::Conflict);
    }
    if require_verified && saved.item.is_none() {
        return Err(Error::Unconfirmed);
    }
    Ok(Some(saved.vault))
}

fn read_private(path: &Path) -> Result<Vec<u8>, Error> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
        .map_err(|_| Error::State)?;
    let metadata = file.metadata().map_err(|_| Error::State)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o077 != 0
        || metadata.len() > 8192
    {
        return Err(Error::State);
    }
    let mut bytes = Vec::new();
    file.take(8193)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::State)?;
    if bytes.len() > 8192 {
        return Err(Error::State);
    }
    Ok(bytes)
}

fn save(path: &Path, receipt: &Receipt, first: bool) -> Result<(), Error> {
    let parent = path.parent().ok_or(Error::State)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| Error::State)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::State);
    }
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
    serde_json::to_writer(&mut temp, receipt).map_err(|_| Error::State)?;
    temp.as_file().sync_all().map_err(|_| Error::State)?;
    if first {
        temp.persist_noclobber(path).map_err(|_| Error::State)?;
    } else {
        temp.persist(path).map_err(|_| Error::State)?;
    }
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::State)
}

/// The provisioning session holds the directory lock throughout this operation.
pub fn ensure(
    store: &impl Store,
    vault: &str,
    backup: &Backup<'_>,
    receipt: &Path,
) -> Result<String, Error> {
    if !identifier(vault)
        || !crate::config::valid_repository(backup.repository)
        || backup.role.is_empty()
        || backup.role.len() > 80
        || backup.recipient.len() > 128
        || !backup.recipient.starts_with("age1")
        || backup.identity.len() > 8192
        || !backup
            .identity
            .lines()
            .any(|line| line.starts_with("AGE-SECRET-KEY-1"))
    {
        return Err(Error::State);
    }
    let tag = backup.tag();
    let previous: Option<Receipt> = match fs::symlink_metadata(receipt) {
        Ok(_) => Some(serde_json::from_slice(&read_private(receipt)?).map_err(|_| Error::State)?),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(Error::State),
    };
    if previous
        .as_ref()
        .is_some_and(|saved| saved.schema != 1 || saved.vault != vault || saved.tag != tag)
    {
        return Err(Error::Conflict);
    }
    let matches = store.find(vault, &tag)?;
    if matches.len() > 1 {
        return Err(Error::Conflict);
    }
    let id = if let Some(id) = matches.first() {
        if previous
            .as_ref()
            .and_then(|saved| saved.item.as_ref())
            .is_some_and(|saved| saved != id)
        {
            return Err(Error::Conflict);
        }
        id.clone()
    } else {
        if previous.is_some() {
            return Err(Error::Unconfirmed);
        }
        save(
            receipt,
            &Receipt {
                schema: 1,
                vault: vault.into(),
                tag: tag.clone(),
                item: None,
            },
            true,
        )?;
        store
            .create(vault, backup, &tag)
            .map_err(|_| Error::Unconfirmed)?
    };
    if !identifier(&id) {
        return Err(Error::Unconfirmed);
    }
    let saved = store.read(vault, &id)?;
    if saved.id != id
        || saved.vault != vault
        || saved.repository != backup.repository
        || saved.role != backup.role
        || saved.recipient != backup.recipient
        || saved.identity != backup.identity
    {
        return Err(Error::Conflict);
    }
    save(
        receipt,
        &Receipt {
            schema: 1,
            vault: vault.into(),
            tag,
            item: Some(id.clone()),
        },
        fs::symlink_metadata(receipt).is_err(),
    )?;
    Ok(id)
}

pub fn backup_file(
    store: &impl Store,
    vault: &str,
    repository: &str,
    role: &str,
    recipient: &str,
    identity: &Path,
    receipt: &Path,
) -> Result<String, Error> {
    let bytes = read_private(identity)?;
    let identity = std::str::from_utf8(&bytes).map_err(|_| Error::State)?;
    ensure(
        store,
        vault,
        &Backup {
            repository,
            role,
            recipient,
            identity,
        },
        receipt,
    )
}

fn identifier(value: &str) -> bool {
    value.len() == 26
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
}

pub struct OnePassword {
    pub executable: PathBuf,
}

impl OnePassword {
    fn run(&self, arguments: &[&str], input: Option<&Value>) -> Result<Value, Error> {
        let mut command = Command::new(&self.executable);
        command.args(arguments).stdin(Stdio::null());
        let template = if let Some(input) = input {
            let mut file = tempfile::NamedTempFile::new().map_err(|_| Error::State)?;
            serde_json::to_writer(&mut file, input).map_err(|_| Error::State)?;
            file.flush().map_err(|_| Error::State)?;
            command.arg("--template").arg(file.path());
            Some(file)
        } else {
            None
        };
        let output = crate::process::capture(&mut command, Duration::from_secs(90))
            .map_err(|_| Error::Access)?;
        drop(template);
        if !output.status.success() {
            return Err(Error::Access);
        }
        serde_json::from_slice(&output.stdout).map_err(|_| Error::Access)
    }

    pub fn vault_id(&self, name: &str) -> Result<String, Error> {
        if name.is_empty()
            || name.len() > 128
            || name.starts_with('-')
            || name.chars().any(char::is_control)
        {
            return Err(Error::State);
        }
        let value = self.run(&["vault", "get", name, "--format", "json"], None)?;
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| identifier(id))
            .ok_or(Error::Access)?;
        Ok(id.into())
    }
}

impl Store for OnePassword {
    fn find(&self, vault: &str, tag: &str) -> Result<Vec<String>, Error> {
        let value = self.run(
            &[
                "item", "list", "--vault", vault, "--tags", tag, "--format", "json",
            ],
            None,
        )?;
        value
            .as_array()
            .ok_or(Error::Access)?
            .iter()
            .map(|item| {
                if item.pointer("/vault/id").and_then(Value::as_str) != Some(vault)
                    || !item
                        .get("tags")
                        .and_then(Value::as_array)
                        .is_some_and(|tags| tags.iter().any(|value| value.as_str() == Some(tag)))
                {
                    return Err(Error::Conflict);
                }
                item.get("id")
                    .and_then(Value::as_str)
                    .filter(|id| identifier(id))
                    .map(str::to_owned)
                    .ok_or(Error::Access)
            })
            .collect()
    }

    fn read(&self, vault: &str, item: &str) -> Result<Item, Error> {
        let value = self.run(
            &["item", "get", item, "--vault", vault, "--format", "json"],
            None,
        )?;
        let fields = value
            .get("fields")
            .and_then(Value::as_array)
            .ok_or(Error::Conflict)?;
        let field = |name: &str, kind: &str| -> Result<String, Error> {
            let matches: Vec<_> = fields
                .iter()
                .filter(|field| field.get("id").and_then(Value::as_str) == Some(name))
                .collect();
            if matches.len() != 1 || matches[0].get("type").and_then(Value::as_str) != Some(kind) {
                return Err(Error::Conflict);
            }
            matches[0]
                .get("value")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .ok_or(Error::Conflict)
        };
        Ok(Item {
            id: value
                .get("id")
                .and_then(Value::as_str)
                .ok_or(Error::Conflict)?
                .into(),
            vault: value
                .pointer("/vault/id")
                .and_then(Value::as_str)
                .ok_or(Error::Conflict)?
                .into(),
            repository: field("repository", "STRING")?,
            role: field("role", "STRING")?,
            recipient: field("recipient", "STRING")?,
            identity: field("identity", "CONCEALED")?,
        })
    }

    fn create(&self, vault: &str, backup: &Backup<'_>, tag: &str) -> Result<String, Error> {
        let value = json!({"title":format!("Homelab {} — {}", backup.repository, backup.role),
        "category":"SECURE_NOTE", "tags":[tag], "fields":[
            {"id":"repository","label":"Repository","type":"STRING","value":backup.repository},
            {"id":"role","label":"Identity role","type":"STRING","value":backup.role},
            {"id":"recipient","label":"Public recipient","type":"STRING","value":backup.recipient},
            {"id":"identity","label":"Private age identity","type":"CONCEALED","value":backup.identity}
        ]});
        let result = self.run(
            &["item", "create", "--vault", vault, "--format", "json"],
            Some(&value),
        )?;
        result
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| identifier(id))
            .map(str::to_owned)
            .ok_or(Error::Unconfirmed)
    }
}
