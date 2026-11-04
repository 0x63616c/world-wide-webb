use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const MAX_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AgentIdentity {
    pub public_key: String,
    pub agent_socket: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HostProfile {
    pub name: String,
    pub address: String,
    pub user: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identity: Option<AgentIdentity>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub configuration_host: Option<String>,
}

impl HostProfile {
    pub fn resolved_configuration(&self) -> Option<&str> {
        let host = self.configuration_host.as_deref().unwrap_or(&self.name);
        supported_configuration(host).then_some(host)
    }
}

fn supported_configuration(host: &str) -> bool {
    matches!(host, "homelab-macbook" | "homelab-mac-mini")
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InventoryError {
    #[error("No local host inventory exists yet.")]
    Missing,
    #[error("The inventory is not a valid schema-1 host list.")]
    Invalid,
    #[error("The inventory exceeds the 64 KiB limit.")]
    TooLarge,
    #[error("A host with that profile name already exists.")]
    DuplicateName,
    #[error("The inventory already contains the maximum of 32 hosts.")]
    Full,
    #[error("The inventory could not be read.")]
    ReadFailed,
    #[error("The inventory location or lock is not private and safely owned.")]
    UnsafeLocation,
    #[error("Another client is editing the inventory.")]
    Busy,
    #[error("The inventory save could not be completed and confirmed.")]
    SaveFailed,
    #[error("The saved connection changed while you were editing it.")]
    Changed,
}

impl InventoryError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Missing => "inventory-missing",
            Self::Invalid => "inventory-invalid",
            Self::TooLarge => "inventory-too-large",
            Self::DuplicateName => "duplicate-host-name",
            Self::Full => "inventory-full",
            Self::ReadFailed => "inventory-read-failed",
            Self::UnsafeLocation => "inventory-unsafe-location",
            Self::Busy => "inventory-busy",
            Self::SaveFailed => "inventory-save-failed",
            Self::Changed => "inventory-changed",
        }
    }

    pub fn next_action(&self) -> &'static str {
        match self {
            Self::Missing => "Add a local connection profile to get started.",
            Self::Invalid => {
                "Use schema 1 and plain host/profile/login names; preserve and inspect any existing file."
            }
            Self::TooLarge => "Use a reviewed inventory file no larger than 64 KiB.",
            Self::DuplicateName => "Choose a unique profile name or use the existing profile.",
            Self::Full => "Review the existing host list before adding another profile.",
            Self::ReadFailed => "Check the inventory path and your access permissions.",
            Self::UnsafeLocation => {
                "Use an owner-only directory and regular files; do not replace a symlink."
            }
            Self::Busy => "Let the other client finish, then retry.",
            Self::SaveFailed => {
                "Inspect the local inventory and available disk space before retrying."
            }
            Self::Changed => "Reopen the saved connection and review its current settings.",
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Inventory {
    schema: u8,
    hosts: Vec<HostProfile>,
}

fn valid_field(value: &str) -> bool {
    let bytes = value.as_bytes();
    (1..=253).contains(&bytes.len())
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(byte))
}

pub(crate) fn validate_profile(host: &HostProfile) -> Result<(), InventoryError> {
    if [&host.name, &host.address, &host.user]
        .into_iter()
        .all(|value| valid_field(value))
        && host
            .identity
            .as_ref()
            .is_none_or(crate::ssh_identity::validate_identity)
        && host
            .configuration_host
            .as_deref()
            .is_none_or(supported_configuration)
    {
        Ok(())
    } else {
        Err(InventoryError::Invalid)
    }
}

impl Inventory {
    fn validate(&self) -> Result<(), InventoryError> {
        if self.schema != 1 || !(1..=32).contains(&self.hosts.len()) {
            return Err(InventoryError::Invalid);
        }
        let mut names = BTreeSet::new();
        for host in &self.hosts {
            validate_profile(host)?;
            if !names.insert(&host.name) {
                return Err(InventoryError::DuplicateName);
            }
        }
        Ok(())
    }
}

pub fn load(path: &Path) -> Result<Vec<HostProfile>, InventoryError> {
    // Nonblocking open prevents an accidentally selected FIFO from hanging the UI.
    let descriptor = open(
        path,
        OFlags::RDONLY | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    )
    .map_err(|error| {
        if error == rustix::io::Errno::NOENT {
            match fs::symlink_metadata(path) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                    InventoryError::Missing
                }
                _ => InventoryError::Invalid,
            }
        } else {
            InventoryError::ReadFailed
        }
    })?;
    let file = File::from(descriptor);
    if !file
        .metadata()
        .map_err(|_| InventoryError::ReadFailed)?
        .is_file()
    {
        return Err(InventoryError::Invalid);
    }
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| InventoryError::ReadFailed)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(InventoryError::TooLarge);
    }
    let inventory: Inventory =
        serde_json::from_slice(&bytes).map_err(|_| InventoryError::Invalid)?;
    inventory.validate()?;
    Ok(inventory.hosts)
}

pub fn add(path: &Path, host: HostProfile) -> Result<Vec<HostProfile>, InventoryError> {
    validate_profile(&host)?;
    save(path, Change::Add(host))
}

pub fn set_identity(
    path: &Path,
    expected: &HostProfile,
    identity: Option<AgentIdentity>,
) -> Result<HostProfile, InventoryError> {
    let mut updated = expected.clone();
    updated.identity = identity;
    validate_profile(&updated)?;
    save(
        path,
        Change::Replace {
            expected,
            updated: updated.clone(),
        },
    )?;
    Ok(updated)
}

pub fn set_configuration(
    path: &Path,
    expected: &HostProfile,
    host: &str,
) -> Result<HostProfile, InventoryError> {
    let mut updated = expected.clone();
    updated.configuration_host = Some(host.into());
    validate_profile(&updated)?;
    save(
        path,
        Change::Replace {
            expected,
            updated: updated.clone(),
        },
    )?;
    Ok(updated)
}

enum Change<'a> {
    Add(HostProfile),
    Replace {
        expected: &'a HostProfile,
        updated: HostProfile,
    },
}

fn save(path: &Path, change: Change<'_>) -> Result<Vec<HostProfile>, InventoryError> {
    let filename = path.file_name().ok_or(InventoryError::UnsafeLocation)?;
    let parent = path
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
        .map_err(|_| InventoryError::SaveFailed)?;
    let metadata = fs::symlink_metadata(parent).map_err(|_| InventoryError::UnsafeLocation)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || metadata.mode() & 0o077 != 0
    {
        return Err(InventoryError::UnsafeLocation);
    }

    let mut lock_name = filename.to_os_string();
    lock_name.push(".lock");
    let lock = open(
        parent.join(lock_name),
        OFlags::CREATE | OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map_err(|_| InventoryError::UnsafeLocation)?;
    let lock = File::from(lock);
    let metadata = lock
        .metadata()
        .map_err(|_| InventoryError::UnsafeLocation)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::getuid().as_raw()
        || metadata.mode() & 0o077 != 0
    {
        return Err(InventoryError::UnsafeLocation);
    }
    flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
        if error == rustix::io::Errno::WOULDBLOCK {
            InventoryError::Busy
        } else {
            InventoryError::SaveFailed
        }
    })?;

    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => return Err(InventoryError::UnsafeLocation),
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(InventoryError::ReadFailed),
    }
    // Reload under the lock so another completed save cannot be overwritten.
    let mut hosts = match load(path) {
        Ok(hosts) => hosts,
        Err(InventoryError::Missing) => Vec::new(),
        Err(error) => return Err(error),
    };
    match change {
        Change::Add(host) => {
            if hosts.iter().any(|existing| existing.name == host.name) {
                return Err(InventoryError::DuplicateName);
            }
            if hosts.len() == 32 {
                return Err(InventoryError::Full);
            }
            hosts.push(host);
        }
        Change::Replace { expected, updated } => {
            let current = hosts
                .iter_mut()
                .find(|host| host.name == expected.name)
                .ok_or(InventoryError::Changed)?;
            // A key approved for one connection must not be saved onto a
            // different connection edited by another client in the meantime.
            if current != expected {
                return Err(InventoryError::Changed);
            }
            *current = updated;
        }
    }
    let inventory = Inventory { schema: 1, hosts };
    inventory.validate()?;
    if serde_json::to_vec_pretty(&inventory)
        .map_err(|_| InventoryError::SaveFailed)?
        .len() as u64
        + 1
        > MAX_BYTES
    {
        return Err(InventoryError::TooLarge);
    }
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).map_err(|_| InventoryError::SaveFailed)?;
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| InventoryError::SaveFailed)?;
    serde_json::to_writer_pretty(&mut temporary, &inventory)
        .map_err(|_| InventoryError::SaveFailed)?;
    temporary
        .write_all(b"\n")
        .map_err(|_| InventoryError::SaveFailed)?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|_| InventoryError::SaveFailed)?;
    temporary
        .persist(path)
        .map_err(|_| InventoryError::SaveFailed)?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|_| InventoryError::SaveFailed)?;
    Ok(inventory.hosts)
}
