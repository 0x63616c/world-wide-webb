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

impl Phase {
    /// Fixed operator messages deliberately exclude paths and subprocess output.
    pub fn message(self) -> &'static str {
        match self {
            Self::Preparing => "Preparing the reviewed configuration…",
            Self::InstallingNix => "Installing Nix. This can take several minutes…",
            Self::Building => "Building configuration…",
            Self::VerifyingSecrets => "Checking host secret decryption…",
            Self::InstallingKey => "Installing this Mac’s identities…",
            Self::Activating => "Activating the built configuration…",
            Self::Activated => "Configuration activated; verification and reboot are next.",
        }
    }
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
    repository: String,
    host: String,
    revision: String,
    #[serde(
        default,
        rename = "repairedFrom",
        skip_serializing_if = "Option::is_none"
    )]
    repaired_from: Option<String>,
    #[serde(default, rename = "repairedVia", skip_serializing_if = "Vec::is_empty")]
    repaired_via: Vec<String>,
    phase: Phase,
    #[serde(rename = "builtSystem")]
    built_system: Option<PathBuf>,
}

pub struct Journal {
    directory: PathBuf,
    progress: Progress,
    _lock: File,
}

impl Drop for Journal {
    fn drop(&mut self) {
        // A concurrent fork can retain a descriptor until exec. Closing our
        // copy alone would prolong the lock beyond this journal's lifetime.
        let _ = flock(&self._lock, FlockOperation::Unlock);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OpenMode {
    Fresh,
    Resume,
    StartOrResume,
    Reconcile,
    Repair,
}

/// Absence is meaningful only when every existing ancestor is traversable and
/// safely owned. Treat even an incomplete bootstrap directory as started.
pub fn has_started(home: &Path) -> Result<bool, StateError> {
    if !home.is_absolute() {
        return Err(StateError::UnsafeLocation);
    }
    let mut path = home.to_path_buf();
    for component in ["", ".local", "state", "homelab", "bootstrap"] {
        if !component.is_empty() {
            path.push(component);
        }
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !component.is_empty() => {
                return Ok(false);
            }
            Err(_) => return Err(StateError::UnsafeLocation),
        };
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o022 != 0
            || metadata.mode() & 0o100 == 0
        {
            return Err(StateError::UnsafeLocation);
        }
    }
    Ok(true)
}

/// A candidate only: privileged activation receipts still decide whether setup
/// can finish. This avoids requiring an expired enrollment key after activation.
pub fn activation_revision(
    home: &Path,
    repository: &str,
    host: &str,
    revision: &str,
) -> Result<Option<String>, StateError> {
    if !has_started(home)? {
        return Ok(None);
    }
    let mut bytes = Vec::new();
    private_file(
        &home.join(".local/state/homelab/bootstrap/progress.json"),
        false,
    )?
    .take(65_537)
    .read_to_end(&mut bytes)
    .map_err(|_| StateError::Invalid)?;
    if bytes.len() > 65_536 {
        return Err(StateError::Invalid);
    }
    let progress: Progress = serde_json::from_slice(&bytes).map_err(|_| StateError::Invalid)?;
    if progress.schema != 1
        || progress.repository != repository
        || progress.host != host
        || (progress.revision != revision && progress.repaired_from.as_deref() != Some(revision))
    {
        return Err(StateError::Mismatch);
    }
    Ok(
        (matches!(progress.phase, Phase::Activating | Phase::Activated)
            && progress.built_system.is_some())
        .then_some(progress.revision),
    )
}

pub fn activation_candidate(
    home: &Path,
    repository: &str,
    host: &str,
    revision: &str,
) -> Result<bool, StateError> {
    activation_revision(home, repository, host, revision).map(|revision| revision.is_some())
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
        repository: &str,
        host: &str,
        revision: &str,
        resume: bool,
    ) -> Result<Self, StateError> {
        Self::open_mode(
            state_directory,
            repository,
            host,
            revision,
            if resume {
                OpenMode::Resume
            } else {
                OpenMode::Fresh
            },
        )
    }

    /// A wizard retry does not need a separate first-run/resume question. The
    /// journal still binds the exact inputs and blocks uncertain mutations.
    pub fn start_or_resume(
        state_directory: &Path,
        repository: &str,
        host: &str,
        revision: &str,
    ) -> Result<Self, StateError> {
        Self::open_mode(
            state_directory,
            repository,
            host,
            revision,
            OpenMode::StartOrResume,
        )
    }

    /// Returns uncertain phases without replaying them. The caller must verify
    /// privileged completion independently before making another mutation.
    pub fn open_for_reconciliation(
        state_directory: &Path,
        repository: &str,
        host: &str,
        revision: &str,
    ) -> Result<Self, StateError> {
        Self::open_mode(
            state_directory,
            repository,
            host,
            revision,
            OpenMode::Reconcile,
        )
    }

    /// A repair keeps the original reservation, but records the effective commit
    /// in the same atomic journal write as its provenance. No two-file migration.
    pub fn open_repair(
        directory: &Path,
        repository: &str,
        host: &str,
        from: &str,
        to: &str,
    ) -> Result<Self, StateError> {
        match Self::open_mode(directory, repository, host, from, OpenMode::Repair) {
            Ok(journal) => {
                journal.ensure_repairable()?;
                Ok(journal)
            }
            Err(StateError::Mismatch) => {
                let journal = Self::open_mode(directory, repository, host, to, OpenMode::Repair)?;
                if journal.progress.repaired_from.as_deref() != Some(from)
                    || !journal.progress.repaired_via.is_empty()
                {
                    return Err(StateError::Mismatch);
                }
                Ok(journal)
            }
            Err(error) => Err(error),
        }
    }

    fn ensure_repairable(&self) -> Result<(), StateError> {
        if self.progress.repaired_from.is_some() {
            return Err(StateError::NeedsInspection);
        }
        self.ensure_pre_key_repair()
    }

    fn ensure_pre_key_repair(&self) -> Result<(), StateError> {
        if self.progress.built_system.is_some()
            || !matches!(
                self.phase(),
                Phase::Preparing | Phase::InstallingNix | Phase::Building
            )
        {
            return Err(StateError::NeedsInspection);
        }
        Ok(())
    }

    /// Advance a failed repair without replacing its original reservation.
    pub fn open_followup(
        directory: &Path,
        repository: &str,
        host: &str,
        original: &str,
        previous: &str,
        next: &str,
    ) -> Result<Self, StateError> {
        if [original, previous, next]
            .iter()
            .any(|revision| !crate::config::valid_revision(revision))
            || original == previous
            || previous == next
            || original == next
        {
            return Err(StateError::Mismatch);
        }
        match Self::open_mode(directory, repository, host, previous, OpenMode::Repair) {
            Ok(journal) => {
                journal.ensure_pre_key_repair()?;
                if journal.progress.repaired_from.as_deref() != Some(original)
                    || journal.progress.repaired_via.len() >= 4
                    || journal
                        .progress
                        .repaired_via
                        .iter()
                        .any(|revision| revision == next)
                {
                    return Err(StateError::Mismatch);
                }
                Ok(journal)
            }
            Err(StateError::Mismatch) => {
                let journal = Self::open_mode(directory, repository, host, next, OpenMode::Repair)?;
                if journal.progress.repaired_from.as_deref() != Some(original)
                    || journal.progress.repaired_via.last().map(String::as_str) != Some(previous)
                {
                    return Err(StateError::Mismatch);
                }
                Ok(journal)
            }
            Err(error) => Err(error),
        }
    }

    pub fn record_followup(
        &mut self,
        original: &str,
        previous: &str,
        next: &str,
    ) -> Result<(), StateError> {
        if self.progress.repaired_from.as_deref() != Some(original)
            || [original, previous, next]
                .iter()
                .any(|revision| !crate::config::valid_revision(revision))
            || original == previous
            || original == next
            || previous == next
        {
            return Err(StateError::Mismatch);
        }
        if self.progress.revision == next
            && self.progress.repaired_via.last().map(String::as_str) == Some(previous)
        {
            return Ok(());
        }
        self.ensure_pre_key_repair()?;
        if self.progress.revision != previous
            || self.progress.repaired_via.len() >= 4
            || self
                .progress
                .repaired_via
                .iter()
                .any(|revision| revision == next)
        {
            return Err(StateError::Mismatch);
        }
        let mut progress = self.progress.clone();
        progress.revision = next.into();
        progress.repaired_via.push(previous.into());
        self.write(&progress)?;
        self.progress = progress;
        Ok(())
    }

    pub fn record_repair(&mut self, from: &str, to: &str) -> Result<(), StateError> {
        if self.progress.revision == to
            && self.progress.repaired_from.as_deref() == Some(from)
            && self.progress.repaired_via.is_empty()
        {
            return Ok(());
        }
        self.ensure_repairable()?;
        if self.progress.revision != from || !crate::config::valid_revision(to) {
            return Err(StateError::Mismatch);
        }
        let mut progress = self.progress.clone();
        progress.revision = to.into();
        progress.repaired_from = Some(from.into());
        self.write(&progress)?;
        self.progress = progress;
        Ok(())
    }

    fn open_mode(
        state_directory: &Path,
        repository: &str,
        host: &str,
        revision: &str,
        mode: OpenMode,
    ) -> Result<Self, StateError> {
        if repository.is_empty() || host.is_empty() || revision.is_empty() {
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
            if progress.repository != repository
                || progress.host != host
                || progress.revision != revision
            {
                return Err(StateError::Mismatch);
            }
            if mode == OpenMode::Fresh {
                return Err(StateError::AlreadyStarted);
            }
            if !matches!(mode, OpenMode::Reconcile | OpenMode::Repair)
                && matches!(
                    progress.phase,
                    Phase::InstallingNix
                        | Phase::InstallingKey
                        | Phase::Activating
                        | Phase::Activated
                )
            {
                return Err(StateError::NeedsInspection);
            }
            progress
        } else {
            if matches!(mode, OpenMode::Resume | OpenMode::Repair) {
                return Err(StateError::Missing);
            }
            Progress {
                schema: 1,
                repository: repository.into(),
                host: host.into(),
                revision: revision.into(),
                repaired_from: None,
                repaired_via: Vec::new(),
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

    pub fn built_system(&self) -> Option<&Path> {
        self.progress.built_system.as_deref()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dropping_journal_unlocks_even_when_a_duplicate_descriptor_survives() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state");
        let open = || Journal::start_or_resume(&path, "example/config", "test-mac", "revision");
        let journal = open().unwrap();
        // A retained descriptor models another process sharing the open file description.
        let retained = journal._lock.try_clone().unwrap();

        assert!(matches!(open(), Err(StateError::Busy)));
        drop(journal);

        let resumed = open().expect("the journal lifetime, not the duplicate, owns the lock");
        assert!(matches!(open(), Err(StateError::Busy)));
        assert!(retained.metadata().is_ok());
        drop(resumed);
        drop(retained);
    }
}
