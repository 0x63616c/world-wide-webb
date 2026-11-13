//! Target-side ownership of one enrollment attempt across separate SSH calls.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use rustix::fs::{FlockOperation, OFlags, flock};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Another enrollment owns this Mac. Resume that attempt before starting another.")]
    Busy,
    #[error(
        "Enrollment reservation is unsafe or does not match this attempt. Preserve it for recovery."
    )]
    Invalid,
    #[error(
        "Bootstrap has started. Resume the original installation; its credentials cannot be renewed yet."
    )]
    Started,
    #[error(
        "The enrollment transition could not be saved. Reconnect and inspect the same attempt."
    )]
    Save,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attempt {
    pub id: String,
    pub repository: String,
    pub host: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub enum Phase {
    Preparing,
    BootstrapClaimed { revision: String },
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u8,
    attempt: Attempt,
    phase: Phase,
}

pub struct Reservation {
    home: PathBuf,
    directory: PathBuf,
    lock: File,
}

impl Drop for Reservation {
    fn drop(&mut self) {
        let _ = flock(&self.lock, FlockOperation::Unlock);
    }
}

fn protected(file: &File) -> Result<(), Error> {
    let metadata = file.metadata().map_err(|_| Error::Invalid)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(Error::Invalid);
    }
    Ok(())
}

pub(crate) fn valid_attempt(attempt: &Attempt) -> bool {
    attempt.id.len() == 64
        && attempt
            .id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        && crate::config::valid_repository(&attempt.repository)
        && crate::config::valid_host(&attempt.host)
}

impl Reservation {
    pub fn open(home: &Path) -> Result<Self, Error> {
        if !home.is_absolute() {
            return Err(Error::Invalid);
        }
        let metadata = fs::symlink_metadata(home).map_err(|_| Error::Invalid)?;
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o022 != 0
        {
            return Err(Error::Invalid);
        }
        let directory = home.join(".homelab-enrollment");
        match fs::DirBuilder::new().mode(0o700).create(&directory) {
            Ok(()) => File::open(home)
                .and_then(|file| file.sync_all())
                .map_err(|_| Error::Save)?,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(Error::Invalid),
        }
        let metadata = fs::symlink_metadata(&directory).map_err(|_| Error::Invalid)?;
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o7777 != 0o700
        {
            return Err(Error::Invalid);
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags((OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK).bits() as i32)
            .open(directory.join("lock"))
            .map_err(|_| Error::Invalid)?;
        protected(&lock)?;
        flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|_| Error::Busy)?;
        Ok(Self {
            home: home.into(),
            directory,
            lock,
        })
    }

    fn read(&self) -> Result<Option<Record>, Error> {
        let file = match OpenOptions::new()
            .read(true)
            .custom_flags((OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK).bits() as i32)
            .open(self.directory.join("reservation.json"))
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(_) => return Err(Error::Invalid),
        };
        protected(&file)?;
        let mut bytes = Vec::new();
        file.take(4097)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::Invalid)?;
        if bytes.len() > 4096 {
            return Err(Error::Invalid);
        }
        let record: Record = serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?;
        if record.schema != 1 || !valid_attempt(&record.attempt) {
            return Err(Error::Invalid);
        }
        if let Phase::BootstrapClaimed { revision } = &record.phase
            && !crate::config::valid_revision(revision)
        {
            return Err(Error::Invalid);
        }
        Ok(Some(record))
    }

    fn write(&self, record: &Record) -> Result<(), Error> {
        let mut file = tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| Error::Save)?;
        serde_json::to_writer(&mut file, record).map_err(|_| Error::Save)?;
        file.flush()
            .and_then(|()| file.as_file().sync_all())
            .map_err(|_| Error::Save)?;
        file.persist(self.directory.join("reservation.json"))
            .map_err(|_| Error::Save)?;
        File::open(&self.directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| Error::Save)
    }

    fn owned(&self, attempt: &Attempt) -> Result<Record, Error> {
        if !valid_attempt(attempt) {
            return Err(Error::Invalid);
        }
        let record = self.read()?.ok_or(Error::Invalid)?;
        if record.attempt != *attempt {
            return Err(Error::Busy);
        }
        Ok(record)
    }

    pub fn acquire(&self, attempt: &Attempt) -> Result<Phase, Error> {
        if !valid_attempt(attempt) {
            return Err(Error::Invalid);
        }
        if let Some(record) = self.read()? {
            return if record.attempt == *attempt {
                Ok(record.phase)
            } else {
                Err(Error::Busy)
            };
        }
        if crate::bootstrap_state::has_started(&self.home).map_err(|_| Error::Invalid)? {
            return Err(Error::Started);
        }
        self.write(&Record {
            schema: 1,
            attempt: attempt.clone(),
            phase: Phase::Preparing,
        })?;
        Ok(Phase::Preparing)
    }

    pub fn renewal_allowed(&self, attempt: &Attempt) -> Result<(), Error> {
        if self.owned(attempt)?.phase != Phase::Preparing
            || crate::bootstrap_state::has_started(&self.home).map_err(|_| Error::Invalid)?
        {
            return Err(Error::Started);
        }
        Ok(())
    }

    /// Persist ownership of the exact revision before a bootstrap process starts.
    /// A repeated claim authorizes reconciliation, never blind replay of mutation.
    pub fn claim_bootstrap(&self, attempt: &Attempt, revision: &str) -> Result<(), Error> {
        if !crate::config::valid_revision(revision) {
            return Err(Error::Invalid);
        }
        let mut record = self.owned(attempt)?;
        let phase = Phase::BootstrapClaimed {
            revision: revision.into(),
        };
        if record.phase == phase {
            return Ok(());
        }
        self.renewal_allowed(attempt)?;
        record.phase = phase;
        self.write(&record)
    }

    pub fn release_preparation(&self, attempt: &Attempt) -> Result<(), Error> {
        if !valid_attempt(attempt) {
            return Err(Error::Invalid);
        }
        if self.read()?.is_none() {
            return if crate::bootstrap_state::has_started(&self.home).map_err(|_| Error::Invalid)? {
                Err(Error::Started)
            } else {
                Ok(())
            };
        }
        self.renewal_allowed(attempt)?;
        fs::remove_file(self.directory.join("reservation.json")).map_err(|_| Error::Save)?;
        File::open(&self.directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| Error::Save)
    }
}
