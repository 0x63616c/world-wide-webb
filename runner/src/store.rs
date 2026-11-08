//! One locked, durable journal. A failed read never becomes an empty journal.
use crate::state::{JOURNAL_VERSION, Journal};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const MAX_JOURNAL_BYTES: u64 = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("state directory or file is not private and owned by this service account")]
    Permissions,
    #[error("another controller owns the state lock")]
    Locked,
    #[error("journal is invalid; preserve it and reconcile owned resources before retrying")]
    Invalid,
    #[error("journal I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

pub struct Store {
    directory: PathBuf,
    _lock: File,
}

impl Drop for Store {
    fn drop(&mut self) {
        // A concurrent spawn can briefly inherit the descriptor before exec.
        // Release this owner's lock without waiting for that duplicate to close.
        let _ = self._lock.unlock();
    }
}

impl Store {
    /// Privileged offline inspection keeps the service's files and ownership intact.
    /// The caller must first prove its launchd service is absent.
    pub fn open_for_owner(directory: &Path, owner: u32) -> Result<Self, StoreError> {
        let metadata = fs::symlink_metadata(directory)?;
        if !metadata.is_dir() || !private_for(&metadata, owner) {
            return Err(StoreError::Permissions);
        }
        let lock = private_open_for(&directory.join("controller.lock"), false, owner)?;
        lock.try_lock().map_err(|_| StoreError::Locked)?;
        Ok(Self {
            directory: directory.to_owned(),
            _lock: lock,
        })
    }

    pub fn open(directory: &Path) -> Result<Self, StoreError> {
        fs::DirBuilder::new()
            .mode(0o700)
            .recursive(true)
            .create(directory)?;
        let metadata = fs::symlink_metadata(directory)?;
        if !metadata.is_dir() || !private(&metadata) {
            return Err(StoreError::Permissions);
        }
        let lock = private_open(&directory.join("controller.lock"), true)?;
        lock.try_lock().map_err(|_| StoreError::Locked)?;
        Ok(Self {
            directory: directory.to_owned(),
            _lock: lock,
        })
    }

    pub fn load(&self) -> Result<Journal, StoreError> {
        let owner = fs::symlink_metadata(&self.directory)?.uid();
        let mut file = match private_open_for(&self.directory.join("journal.json"), false, owner) {
            Ok(file) => file,
            Err(StoreError::Io(error)) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Journal::default());
            }
            Err(error) => return Err(error),
        };
        let mut bytes = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_JOURNAL_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(StoreError::Invalid);
        }
        let mut journal: Journal =
            serde_json::from_slice(&bytes).map_err(|_| StoreError::Invalid)?;
        journal.migrate();
        if journal.version != JOURNAL_VERSION || journal.validate().is_err() {
            return Err(StoreError::Invalid);
        }
        Ok(journal)
    }

    pub fn save(&self, journal: &Journal) -> Result<(), StoreError> {
        if journal.version != JOURNAL_VERSION || journal.validate().is_err() {
            return Err(StoreError::Invalid);
        }
        let bytes = serde_json::to_vec_pretty(journal).map_err(|_| StoreError::Invalid)?;
        if bytes.len() as u64 > MAX_JOURNAL_BYTES {
            return Err(StoreError::Invalid);
        }
        let mut pending = tempfile::NamedTempFile::new_in(&self.directory)?;
        pending
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))?;
        pending.write_all(&bytes)?;
        pending.as_file().sync_all()?;
        pending
            .persist(self.directory.join("journal.json"))
            .map_err(|e| StoreError::Io(e.error))?;
        File::open(&self.directory)?.sync_all()?;
        Ok(())
    }
}

fn private(metadata: &fs::Metadata) -> bool {
    private_for(metadata, rustix::process::geteuid().as_raw())
}

fn private_for(metadata: &fs::Metadata, owner: u32) -> bool {
    metadata.uid() == owner && metadata.mode() & 0o077 == 0
}

fn private_open(path: &Path, create: bool) -> Result<File, StoreError> {
    private_open_for(path, create, rustix::process::geteuid().as_raw())
}

fn private_open_for(path: &Path, create: bool, owner: u32) -> Result<File, StoreError> {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(create)
        .create(create)
        .mode(0o600)
        .custom_flags(rustix::fs::OFlags::NOFOLLOW.bits() as i32);
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || !private_for(&metadata, owner) {
        return Err(StoreError::Permissions);
    }
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_drop_releases_lock_even_with_a_temporary_inherited_descriptor() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let store = Store::open(root.path()).unwrap();
        // fork() can retain this same open-file description until child exec.
        let inherited = store._lock.try_clone().unwrap();
        assert!(matches!(Store::open(root.path()), Err(StoreError::Locked)));
        drop(store);
        let replacement = Store::open(root.path()).expect("ownership ends with Store");
        assert!(matches!(Store::open(root.path()), Err(StoreError::Locked)));
        drop(inherited);
        drop(replacement);
    }

    #[test]
    fn exclusive_owner_persists_and_reopens_the_same_journal() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let store = Store::open(root.path()).unwrap();
        assert!(matches!(Store::open(root.path()), Err(StoreError::Locked)));
        let journal = Journal {
            sequence: 19,
            ..Journal::default()
        };
        store.save(&journal).unwrap();
        assert_eq!(store.load().unwrap(), journal);
        drop(store);
        assert_eq!(Store::open(root.path()).unwrap().load().unwrap(), journal);
    }

    #[test]
    fn corruption_and_future_versions_never_erase_active_state() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let store = Store::open(root.path()).unwrap();
        let journal = root.path().join("journal.json");
        fs::write(&journal, "{truncated").unwrap();
        fs::set_permissions(&journal, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(store.load(), Err(StoreError::Invalid)));
        assert_eq!(fs::read_to_string(&journal).unwrap(), "{truncated");
        fs::write(
            &journal,
            r#"{"version":99,"sequence":0,"last_repository":null,"retry_after":0,"active":null}"#,
        )
        .unwrap();
        assert!(matches!(store.load(), Err(StoreError::Invalid)));
    }

    #[test]
    fn symlinks_and_shared_permissions_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("controller.lock")).unwrap();
        assert!(Store::open(root.path()).is_err());
        fs::remove_file(root.path().join("controller.lock")).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            Store::open(root.path()),
            Err(StoreError::Permissions)
        ));
    }

    #[test]
    fn offline_inspection_is_exclusive_and_preserves_the_service_files() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let store = Store::open(root.path()).unwrap();
        store.save(&Journal::default()).unwrap();
        let owner = fs::metadata(root.path()).unwrap().uid();
        assert!(matches!(
            Store::open_for_owner(root.path(), owner),
            Err(StoreError::Locked)
        ));
        drop(store);
        let inspected = Store::open_for_owner(root.path(), owner).unwrap();
        assert_eq!(inspected.load().unwrap(), Journal::default());
        assert_eq!(
            fs::metadata(root.path().join("journal.json"))
                .unwrap()
                .uid(),
            owner
        );
        assert!(matches!(
            Store::open_for_owner(root.path(), owner + 1),
            Err(StoreError::Permissions)
        ));
    }
}
