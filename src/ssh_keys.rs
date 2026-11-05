//! Publish reviewed public keys where OpenSSH StrictModes can trust every parent.
use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::MetadataExt;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicU64, Ordering};

use rustix::fd::OwnedFd;
use rustix::fs::{
    AtFlags, FileType, Mode, OFlags, fchmod, fstat, fsync, mkdirat, open, openat, renameat, statat,
    unlinkat,
};
use thiserror::Error;

const LIMIT: u64 = 1024 * 1024;
static NEXT: AtomicU64 = AtomicU64::new(0);
const DIRECTORY: OFlags = OFlags::RDONLY
    .union(OFlags::DIRECTORY)
    .union(OFlags::NOFOLLOW)
    .union(OFlags::CLOEXEC);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("SSH key installation requires root and a valid local user name.")]
    InvalidUser,
    #[error(
        "The key source must be a bounded, root-owned, read-only regular Nix store file without symlinks."
    )]
    InvalidSource,
    #[error(
        "The SSH authorized-keys directory or existing entry is unsafe; inspect it before retrying."
    )]
    UnsafeDestination,
    #[error("SSH keys could not be staged; the existing entry was not replaced.")]
    Prepare,
    #[error(
        "SSH keys were published, but durable installation is unconfirmed. Inspect the destination."
    )]
    Unconfirmed,
}

fn valid_user(user: &str) -> bool {
    !user.is_empty()
        && user.len() <= 64
        && user
            .bytes()
            .next()
            .is_some_and(|b| b.is_ascii_alphabetic() || b == b'_')
        && user
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn source_bytes(source: &Path, owner: u32) -> Result<Vec<u8>, Error> {
    // Walk without following intermediate symlinks as well as the final entry.
    let mut directory = open("/", DIRECTORY, Mode::empty()).map_err(|_| Error::InvalidSource)?;
    let components: Vec<_> = source.components().collect();
    if components.len() < 2 || !matches!(components.first(), Some(Component::RootDir)) {
        return Err(Error::InvalidSource);
    }
    for component in &components[1..components.len().saturating_sub(1)] {
        let Component::Normal(name) = component else {
            return Err(Error::InvalidSource);
        };
        directory = openat(&directory, *name, DIRECTORY, Mode::empty())
            .map_err(|_| Error::InvalidSource)?;
    }
    let Some(Component::Normal(name)) = components.last() else {
        return Err(Error::InvalidSource);
    };
    let file = File::from(
        openat(
            &directory,
            *name,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::InvalidSource)?,
    );
    let metadata = file.metadata().map_err(|_| Error::InvalidSource)?;
    if !metadata.is_file()
        || metadata.uid() != owner
        || metadata.mode() & 0o222 != 0
        || metadata.len() > LIMIT
    {
        return Err(Error::InvalidSource);
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::InvalidSource)?;
    if bytes.len() as u64 > LIMIT {
        return Err(Error::InvalidSource);
    }
    Ok(bytes)
}

fn safe_directory(fd: &OwnedFd, owner: u32, final_directory: bool) -> Result<(), Error> {
    let metadata = fstat(fd).map_err(|_| Error::UnsafeDestination)?;
    if metadata.st_uid != owner
        || metadata.st_mode & 0o022 != 0
        || (final_directory && metadata.st_mode & 0o7777 != 0o755)
    {
        return Err(Error::UnsafeDestination);
    }
    Ok(())
}

pub fn install(user: &str, source: &Path) -> Result<(), Error> {
    if !rustix::process::geteuid().is_root() || !valid_user(user) {
        return Err(Error::InvalidUser);
    }
    if !source.starts_with("/nix/store")
        || source.components().count() < 4
        || source
            .as_os_str()
            .as_bytes()
            .split(|byte| *byte == b'/')
            .any(|part| part == b"." || part == b"..")
    {
        return Err(Error::InvalidSource);
    }
    let bytes = source_bytes(source, 0)?;
    let mut directory =
        open("/", DIRECTORY, Mode::empty()).map_err(|_| Error::UnsafeDestination)?;
    safe_directory(&directory, 0, false)?;
    for name in ["private", "etc", "ssh", "authorized_keys"] {
        if name == "authorized_keys" {
            directory = authorized_directory(&directory, 0)?;
            break;
        }
        directory = openat(&directory, name, DIRECTORY, Mode::empty())
            .map_err(|_| Error::UnsafeDestination)?;
        safe_directory(&directory, 0, name == "authorized_keys")?;
    }
    publish(&directory, user, &bytes, 0)
}

fn authorized_directory(parent: &OwnedFd, owner: u32) -> Result<OwnedFd, Error> {
    let created = match mkdirat(parent, "authorized_keys", Mode::RWXU) {
        Ok(()) => true,
        Err(rustix::io::Errno::EXIST) => false,
        Err(_) => return Err(Error::UnsafeDestination),
    };
    let directory = openat(parent, "authorized_keys", DIRECTORY, Mode::empty())
        .map_err(|_| Error::UnsafeDestination)?;
    safe_directory(&directory, owner, false)?;
    if created {
        // Set the required mode independently of umask, but never repair an
        // existing directory whose permissions may indicate tampering.
        fchmod(&directory, Mode::from_raw_mode(0o755)).map_err(|_| Error::Prepare)?;
        fsync(&directory)
            .and_then(|()| fsync(parent))
            .map_err(|_| Error::Prepare)?;
    }
    safe_directory(&directory, owner, true)?;
    Ok(directory)
}

fn publish(directory: &OwnedFd, user: &str, bytes: &[u8], owner: u32) -> Result<(), Error> {
    if !valid_user(user) {
        return Err(Error::InvalidUser);
    }
    safe_directory(directory, owner, true)?;
    match statat(directory, user, AtFlags::SYMLINK_NOFOLLOW) {
        Ok(metadata) => {
            let kind = FileType::from_raw_mode(metadata.st_mode);
            if metadata.st_uid != owner
                || !matches!(kind, FileType::RegularFile | FileType::Symlink)
                || (kind == FileType::RegularFile && metadata.st_mode & 0o022 != 0)
            {
                return Err(Error::UnsafeDestination);
            }
        }
        Err(rustix::io::Errno::NOENT) => {}
        Err(_) => return Err(Error::UnsafeDestination),
    }
    let name = format!(
        ".keys-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    );
    let mut file = File::from(
        openat(
            directory,
            name.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RWXU,
        )
        .map_err(|_| Error::Prepare)?,
    );
    let result = (|| {
        fchmod(&file, Mode::from_raw_mode(0o644)).map_err(|_| Error::Prepare)?;
        file.write_all(bytes)
            .and_then(|()| file.sync_all())
            .map_err(|_| Error::Prepare)?;
        // Rename replaces the link itself, never its Nix store target.
        renameat(directory, name.as_str(), directory, user).map_err(|_| Error::Prepare)?;
        fsync(directory).map_err(|_| Error::Unconfirmed)
    })();
    let _ = unlinkat(directory, name.as_str(), AtFlags::empty());
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::os::unix::fs::{PermissionsExt, symlink};

    fn fixture() -> (tempfile::TempDir, OwnedFd, u32) {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o755)).unwrap();
        let fd = open(root.path(), DIRECTORY, Mode::empty()).unwrap();
        (root, fd, rustix::process::geteuid().as_raw())
    }

    #[test]
    fn replace_symlink_update_and_revoke_without_changing_original() {
        let (root, fd, uid) = fixture();
        let original = root.path().join("store-source");
        fs::write(&original, b"old").unwrap();
        symlink(&original, root.path().join("admin")).unwrap();
        publish(&fd, "admin", b"new", uid).unwrap();
        assert_eq!(fs::read(&original).unwrap(), b"old");
        assert_eq!(fs::read(root.path().join("admin")).unwrap(), b"new");
        assert!(
            !fs::symlink_metadata(root.path().join("admin"))
                .unwrap()
                .is_symlink()
        );
        publish(&fd, "admin", b"replacement", uid).unwrap();
        publish(&fd, "admin", b"", uid).unwrap();
        assert_eq!(fs::read(root.path().join("admin")).unwrap(), b"");
        assert_eq!(
            fs::metadata(root.path().join("admin")).unwrap().mode() & 0o7777,
            0o644
        );
    }

    #[test]
    fn new_private_directory_gets_required_mode_but_existing_one_is_not_repaired() {
        let (root, fd, uid) = fixture();
        let directory = authorized_directory(&fd, uid).unwrap();
        assert_eq!(fstat(&directory).unwrap().st_mode & 0o7777, 0o755);
        fs::set_permissions(
            root.path().join("authorized_keys"),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        assert!(matches!(
            authorized_directory(&fd, uid),
            Err(Error::UnsafeDestination)
        ));
        assert_eq!(fstat(&directory).unwrap().st_mode & 0o7777, 0o700);
    }

    #[test]
    fn unsafe_destinations_and_user_paths_preserve_existing_contents() {
        let (root, fd, uid) = fixture();
        fs::write(root.path().join("admin"), b"old").unwrap();
        for user in ["../admin", "/admin", "", "a/b", "-root"] {
            assert_eq!(publish(&fd, user, b"new", uid), Err(Error::InvalidUser));
        }
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o777)).unwrap();
        assert_eq!(
            publish(&fd, "admin", b"new", uid),
            Err(Error::UnsafeDestination)
        );
        assert_eq!(fs::read(root.path().join("admin")).unwrap(), b"old");
    }

    #[test]
    fn readers_only_observe_complete_replacements() {
        let (root, fd, uid) = fixture();
        let first = vec![b'a'; 32 * 1024];
        let second = vec![b'b'; 32 * 1024];
        publish(&fd, "admin", &first, uid).unwrap();
        std::thread::scope(|scope| {
            let reader = scope.spawn(|| {
                for _ in 0..200 {
                    let bytes = fs::read(root.path().join("admin")).unwrap();
                    assert!(bytes == first || bytes == second);
                }
            });
            for _ in 0..20 {
                publish(&fd, "admin", &second, uid).unwrap();
                publish(&fd, "admin", &first, uid).unwrap();
            }
            reader.join().unwrap();
        });
        assert_eq!(fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[test]
    fn pinned_directory_cannot_be_redirected_by_a_replacement_symlink() {
        let (root, _, uid) = fixture();
        fs::create_dir(root.path().join("keys")).unwrap();
        fs::set_permissions(root.path().join("keys"), fs::Permissions::from_mode(0o755)).unwrap();
        let fd = open(root.path().join("keys"), DIRECTORY, Mode::empty()).unwrap();
        fs::rename(root.path().join("keys"), root.path().join("original")).unwrap();
        fs::create_dir(root.path().join("elsewhere")).unwrap();
        symlink(root.path().join("elsewhere"), root.path().join("keys")).unwrap();
        assert!(open(root.path().join("keys"), DIRECTORY, Mode::empty()).is_err());
        publish(&fd, "admin", b"keys", uid).unwrap();
        assert_eq!(
            fs::read(root.path().join("original/admin")).unwrap(),
            b"keys"
        );
        assert!(!root.path().join("elsewhere/admin").exists());
    }

    #[test]
    fn bounded_read_only_source_rejects_symlinks_and_writable_files() {
        let (root, _, uid) = fixture();
        let path = root.path().canonicalize().unwrap().join("source");
        fs::write(&path, b"keys").unwrap();
        assert_eq!(source_bytes(&path, uid), Err(Error::InvalidSource));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert_eq!(source_bytes(&path, uid).unwrap(), b"keys");
        let link = path.with_file_name("link");
        symlink(&path, &link).unwrap();
        assert_eq!(source_bytes(&link, uid), Err(Error::InvalidSource));
        let fifo = path.with_file_name("fifo");
        assert!(
            std::process::Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .unwrap()
                .success()
        );
        assert_eq!(source_bytes(&fifo, uid), Err(Error::InvalidSource));
        assert_eq!(
            source_bytes(&path, uid.wrapping_add(1)),
            Err(Error::InvalidSource)
        );
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(LIMIT + 1)
            .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o444)).unwrap();
        assert_eq!(source_bytes(&path, uid), Err(Error::InvalidSource));
    }
}
