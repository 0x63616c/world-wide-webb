use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
pub enum Phase {
    Preparing,
    InstallingNix,
    Building,
    VerifyingSecrets,
    InstallingKey,
    Activating,
    Activated,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum StateError {
    #[error(
        "Bootstrap state must use a private directory and regular files owned by this user. Check the state directory permissions and symlinks."
    )]
    UnsafeLocation,
    #[error("Another bootstrap is running. Wait for it to finish before retrying.")]
    Busy,
    #[error("Bootstrap already started. Review its state and explicitly resume.")]
    AlreadyStarted,
    #[error("No bootstrap state exists to resume. Start a new bootstrap instead.")]
    Missing,
    #[error(
        "Saved bootstrap state does not match this host and revision. Use the original reviewed inputs."
    )]
    Mismatch,
    #[error("Saved bootstrap state is invalid. Preserve and inspect it before proceeding.")]
    Invalid,
    #[error(
        "Nix installation, host-key installation or activation may have started. Inspect the target and confirm any privileged process has stopped before attempting recovery."
    )]
    NeedsInspection,
    #[error(
        "Bootstrap state could not be durably saved. Inspect its state and disk availability before retrying."
    )]
    SaveFailed,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Progress {
    schema: u8,
    host: String,
    revision: String,
    phase: Phase,
    #[serde(rename = "builtSystem")]
    built_system: Option<PathBuf>,
}

pub struct Journal {
    directory: PathBuf,
    progress: Progress,
    _lock: File,
}

fn private_file(path: &Path, create: bool) -> Result<File, StateError> {
    let flags = if create {
        OFlags::CREATE | OFlags::RDWR
    } else {
        OFlags::RDONLY
    };
    let file = open(
        path,
        flags | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::RUSR | Mode::WUSR,
    )
    .map(File::from)
    .map_err(|_| StateError::UnsafeLocation)?;
    let metadata = file.metadata().map_err(|_| StateError::UnsafeLocation)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(StateError::UnsafeLocation);
    }
    Ok(file)
}

impl Journal {
    pub fn open(
        state_directory: &Path,
        host: &str,
        revision: &str,
        resume: bool,
    ) -> Result<Self, StateError> {
        if host.is_empty() || revision.is_empty() {
            return Err(StateError::Invalid);
        }
        let missing_directories: Vec<_> = state_directory
            .ancestors()
            .take_while(|path| {
                fs::symlink_metadata(path)
                    .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
            })
            .collect();
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(state_directory)
            .map_err(|_| StateError::UnsafeLocation)?;
        let metadata =
            fs::symlink_metadata(state_directory).map_err(|_| StateError::UnsafeLocation)?;
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o7777 != 0o700
        {
            return Err(StateError::UnsafeLocation);
        }
        // The journal must survive loss of newly created directory entries too.
        for directory in missing_directories {
            let parent = directory
                .parent()
                .filter(|path| !path.as_os_str().is_empty())
                .unwrap_or(Path::new("."));
            File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|_| StateError::SaveFailed)?;
        }
        let lock = private_file(&state_directory.join("bootstrap.lock"), true)?;
        flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|error| {
            if error == rustix::io::Errno::WOULDBLOCK {
                StateError::Busy
            } else {
                StateError::UnsafeLocation
            }
        })?;
        let path = state_directory.join("progress.json");
        let existing = match fs::symlink_metadata(&path) {
            Ok(_) => true,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(StateError::UnsafeLocation),
        };
        let progress = if existing {
            let mut bytes = Vec::new();
            private_file(&path, false)?
                .take(65_537)
                .read_to_end(&mut bytes)
                .map_err(|_| StateError::Invalid)?;
            if bytes.len() > 65_536 {
                return Err(StateError::Invalid);
            }
            let progress: Progress =
                serde_json::from_slice(&bytes).map_err(|_| StateError::Invalid)?;
            if progress.schema != 1
                || progress
                    .built_system
                    .as_ref()
                    .is_some_and(|path| !path.is_absolute())
            {
                return Err(StateError::Invalid);
            }
            if progress.host != host || progress.revision != revision {
                return Err(StateError::Mismatch);
            }
            if !resume {
                return Err(StateError::AlreadyStarted);
            }
            if matches!(
                progress.phase,
                Phase::InstallingNix | Phase::InstallingKey | Phase::Activating | Phase::Activated
            ) {
                return Err(StateError::NeedsInspection);
            }
            progress
        } else {
            if resume {
                return Err(StateError::Missing);
            }
            Progress {
                schema: 1,
                host: host.into(),
                revision: revision.into(),
                phase: Phase::Preparing,
                built_system: None,
            }
        };
        let journal = Self {
            directory: state_directory.to_owned(),
            progress,
            _lock: lock,
        };
        if !existing {
            journal.write(&journal.progress)?;
        }
        Ok(journal)
    }

    pub fn phase(&self) -> Phase {
        self.progress.phase
    }

    pub fn record(&mut self, phase: Phase, built_system: Option<&Path>) -> Result<(), StateError> {
        if built_system.is_some_and(|path| !path.is_absolute()) {
            return Err(StateError::Invalid);
        }
        let mut progress = self.progress.clone();
        progress.phase = phase;
        progress.built_system = built_system.map(Path::to_owned);
        self.write(&progress)?;
        self.progress = progress;
        Ok(())
    }

    fn write(&self, progress: &Progress) -> Result<(), StateError> {
        let bytes = serde_json::to_vec(progress).map_err(|_| StateError::SaveFailed)?;
        if bytes.len() >= 65_536 {
            return Err(StateError::Invalid);
        }
        let mut temporary =
            tempfile::NamedTempFile::new_in(&self.directory).map_err(|_| StateError::SaveFailed)?;
        temporary
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| StateError::SaveFailed)?;
        temporary
            .write_all(&bytes)
            .map_err(|_| StateError::SaveFailed)?;
        temporary
            .write_all(b"\n")
            .map_err(|_| StateError::SaveFailed)?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|_| StateError::SaveFailed)?;
        temporary
            .persist(self.directory.join("progress.json"))
            .map_err(|_| StateError::SaveFailed)?;
        File::open(&self.directory)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| StateError::SaveFailed)?;
        Ok(())
    }
}
