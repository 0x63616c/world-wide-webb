//! Move legacy operator files without rewriting secrets or overwriting saved progress.
use std::fs::{self, File};
use std::io;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};

// Migration owns these locks entirely in this process. Explicitly unlock on
// scope exit so an unrelated fork cannot extend their lifetime until exec.
struct MigrationLock(File);
impl MigrationLock {
    fn acquire(file: File) -> io::Result<Self> {
        rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive)?;
        Ok(Self(file))
    }
}
impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = rustix::fs::flock(&self.0, rustix::fs::FlockOperation::Unlock);
    }
}

pub fn migrate(home: &Path) -> io::Result<()> {
    let root = home.join(".homelab");
    let sources = [
        home.join(".config/homelab"),
        home.join(".local/state/homelab"),
    ];
    let mut moves = Vec::new();
    for source in &sources {
        if source.try_exists()? {
            plan_profiles(source, &root.join("profiles"), &mut moves)?;
        }
    }
    let cache = home.join(".cache/homelab");
    if cache.try_exists()? {
        plan(&cache, &root.join("cache"), &mut moves)?;
    }
    if moves.is_empty() {
        return Ok(());
    }
    // Validate the complete move before touching any saved setup.
    for (source, target) in &moves {
        if let Ok(existing) = fs::symlink_metadata(target) {
            let original = fs::symlink_metadata(source)?;
            if !existing.is_file()
                || existing.dev() != original.dev()
                || existing.ino() != original.ino()
            {
                return Err(io::Error::other(
                    "Both old and new homelab folders contain saved files; neither was overwritten.",
                ));
            }
        }
    }
    private_directory(&root)?;
    let lock = rustix::fs::open(
        root.join("migration.lock"),
        rustix::fs::OFlags::CREATE
            | rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::from_bits_truncate(0o600),
    )?;
    let _migration_lock = MigrationLock::acquire(File::from(lock))?;
    let mut locks = Vec::new();
    for (source, _) in &moves {
        if source
            .file_name()
            .is_some_and(|name| name.to_string_lossy().ends_with("lock"))
        {
            let file = MigrationLock::acquire(File::open(source)?)?;
            locks.push(file);
        }
    }
    for (source, target) in &moves {
        private_directory(target.parent().unwrap())?;
        match fs::hard_link(source, target) {
            Ok(()) => (),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                let a = fs::symlink_metadata(source)?;
                let b = fs::symlink_metadata(target)?;
                if a.dev() != b.dev() || a.ino() != b.ino() {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        }
        File::open(target.parent().unwrap())?.sync_all()?;
        fs::remove_file(source)?;
        File::open(source.parent().unwrap())?.sync_all()?;
    }
    for source in sources.iter().chain(std::iter::once(&cache)) {
        remove_empty(source)?;
    }
    Ok(())
}

fn private_directory(path: &Path) -> io::Result<()> {
    if path.file_name().is_some_and(|name| name != ".homelab")
        && let Some(parent) = path.parent()
    {
        private_directory(parent)?;
    }
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if !metadata.is_dir()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o077 != 0
        {
            return Err(io::Error::other("Unsafe homelab directory permissions."));
        }
        return Ok(());
    }
    fs::DirBuilder::new().mode(0o700).create(path)
}

fn plan_profiles(
    source: &Path,
    profiles: &Path,
    moves: &mut Vec<(PathBuf, PathBuf)>,
) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if !metadata.is_dir() || metadata.uid() != rustix::process::geteuid().as_raw() {
        return Err(io::Error::other("Unsafe legacy homelab folder."));
    }
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let target = if entry.file_name() == "profiles" {
            profiles.to_owned()
        } else {
            profiles.join("default").join(entry.file_name())
        };
        plan(&entry.path(), &target, moves)?;
    }
    Ok(())
}

fn plan(source: &Path, target: &Path, moves: &mut Vec<(PathBuf, PathBuf)>) -> io::Result<()> {
    let metadata = fs::symlink_metadata(source)?;
    if metadata.uid() != rustix::process::geteuid().as_raw() {
        return Err(io::Error::other("Legacy files have a different owner."));
    }
    if metadata.is_dir() {
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            plan(&entry.path(), &target.join(entry.file_name()), moves)?;
        }
    } else if metadata.is_file() {
        moves.push((source.to_owned(), target.to_owned()));
    } else {
        return Err(io::Error::other(
            "Legacy homelab state contains a symbolic link or special file; migration stopped.",
        ));
    }
    Ok(())
}

fn remove_empty(path: &Path) -> io::Result<()> {
    if !path.try_exists()? {
        return Ok(());
    }
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() {
            remove_empty(&entry.path())?;
        }
    }
    match fs::remove_dir(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::DirectoryNotEmpty => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn migration_lock_does_not_outlive_its_owner_after_an_unrelated_fork() {
        use std::process::{Command, Stdio};
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("migration.lock");
        let owner = MigrationLock::acquire(File::create(&path).unwrap()).unwrap();
        let mut child = Command::new("/bin/sleep")
            .arg("3")
            .stdin(Stdio::from(owner.0.try_clone().unwrap()))
            .spawn()
            .unwrap();
        let probe = File::open(&path).unwrap();
        assert_eq!(
            rustix::fs::flock(&probe, rustix::fs::FlockOperation::NonBlockingLockExclusive),
            Err(rustix::io::Errno::WOULDBLOCK)
        );
        drop(owner);
        let released =
            rustix::fs::flock(&probe, rustix::fs::FlockOperation::NonBlockingLockExclusive);
        let child_still_alive = child.try_wait().unwrap().is_none();
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(child_still_alive);
        assert!(
            released.is_ok(),
            "Finished migration retained its lock: {released:?}"
        );
    }
    #[test]
    fn migration_preserves_bytes_permissions_and_profiles_and_repeats_safely() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        for (old, new) in [
            (
                ".config/homelab/repository.json",
                "profiles/default/repository.json",
            ),
            (
                ".config/homelab/profiles/demo/inventory.json",
                "profiles/demo/inventory.json",
            ),
            (
                ".local/state/homelab/provisioning/recovery-age-key.txt",
                "profiles/default/provisioning/recovery-age-key.txt",
            ),
        ] {
            let source = home.path().join(old);
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            fs::write(&source, b"preserved bytes").unwrap();
            fs::set_permissions(&source, fs::Permissions::from_mode(0o600)).unwrap();
            migrate(home.path()).unwrap();
            let target = home.path().join(".homelab").join(new);
            assert_eq!(fs::read(&target).unwrap(), b"preserved bytes");
            assert_eq!(fs::metadata(target).unwrap().mode() & 0o777, 0o600);
            assert!(!source.exists());
        }
        migrate(home.path()).unwrap();
    }
    #[test]
    fn conflicts_leave_both_copies_untouched() {
        let home = tempfile::tempdir().unwrap();
        let old = home.path().join(".config/homelab/repository.json");
        let new = home
            .path()
            .join(".homelab/profiles/default/repository.json");
        for path in [&old, &new] {
            fs::create_dir_all(path.parent().unwrap()).unwrap();
        }
        fs::write(&old, "old").unwrap();
        fs::write(&new, "new").unwrap();
        assert!(migrate(home.path()).is_err());
        assert_eq!(fs::read(old).unwrap(), b"old");
        assert_eq!(fs::read(new).unwrap(), b"new");
    }
}
