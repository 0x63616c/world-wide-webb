//! Root provisioning stays within fixed directories and never follows service-owned links.
use rustix::{
    fs::{self, Mode, OFlags},
    process::{Gid, Uid},
};
use std::{
    ffi::OsStr,
    fs::File,
    io::{Read, Write},
    os::unix::fs::MetadataExt,
    path::Path,
};

#[derive(Debug, thiserror::Error)]
pub enum ProvisionError {
    #[error("runner provisioning requires root")]
    Identity,
    #[error("unsafe provisioning directory or executable")]
    UnsafePath,
    #[error("provisioning I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("provisioning filesystem operation failed: {0}")]
    Filesystem(#[from] rustix::io::Errno),
}

fn inspect(directory: &File, owner: u32, group: Option<u32>) -> Result<(), ProvisionError> {
    let metadata = directory.metadata()?;
    if !metadata.is_dir()
        || metadata.uid() != owner
        || group.is_some_and(|gid| metadata.gid() != gid)
        || metadata.mode() & 0o022 != 0
    {
        return Err(ProvisionError::UnsafePath);
    }
    Ok(())
}

fn child(
    parent: &File,
    name: &OsStr,
    owner: u32,
    group: u32,
    mode: Mode,
) -> Result<File, ProvisionError> {
    let created = match fs::mkdirat(parent, name, mode) {
        Ok(()) => true,
        Err(rustix::io::Errno::EXIST) => false,
        Err(error) => return Err(error.into()),
    };
    let directory = File::from(fs::openat(
        parent,
        name,
        OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::RDONLY,
        Mode::empty(),
    )?);
    if created {
        fs::fchown(
            &directory,
            Some(Uid::from_raw(owner)),
            Some(Gid::from_raw(group)),
        )?;
        fs::fchmod(&directory, mode)?;
    }
    inspect(&directory, owner, Some(group))?;
    Ok(directory)
}

fn private_child(
    parent: &File,
    name: &OsStr,
    owner: u32,
    group: u32,
) -> Result<File, ProvisionError> {
    // child verifies ownership and forbids redirected/group-writable paths
    // before the descriptor is allowed to change an existing directory's mode.
    let directory = child(parent, name, owner, group, Mode::from_raw_mode(0o700))?;
    fs::fchmod(&directory, Mode::from_raw_mode(0o700))?;
    Ok(directory)
}

pub fn provision(source: &Path, helper_directory: &Path) -> Result<(), ProvisionError> {
    if !rustix::process::geteuid().is_root() {
        return Err(ProvisionError::Identity);
    }
    let leaf = helper_directory
        .strip_prefix("/var/lib/homelab-runner-helpers")
        .ok()
        .and_then(|path| {
            if path.components().count() == 1 {
                path.file_name()
            } else {
                None
            }
        })
        .and_then(OsStr::to_str)
        .filter(|name| {
            !name.is_empty()
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        })
        .filter(|name| *name != "." && *name != "..")
        .ok_or(ProvisionError::UnsafePath)?;
    let root = File::open("/")?;
    inspect(&root, 0, None)?;
    let mut base = root;
    // /var is a system symlink on macOS. Anchor its canonical system location.
    for name in ["private", "var", "lib"] {
        base = File::from(fs::openat(
            &base,
            name,
            OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::RDONLY,
            Mode::empty(),
        )?);
        inspect(&base, 0, None)?;
    }
    let home = File::from(fs::openat(
        &base,
        "_runner",
        OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::RDONLY,
        Mode::empty(),
    )?);
    inspect(&home, 451, Some(451))?;
    fs::fchmod(&home, Mode::from_raw_mode(0o700))?;
    child(
        &home,
        OsStr::new("controller"),
        451,
        451,
        Mode::from_raw_mode(0o700),
    )?;
    child(
        &home,
        OsStr::new("tart"),
        451,
        451,
        Mode::from_raw_mode(0o700),
    )?;
    // macOS can create these with 0755/0711 before our first keychain call.
    // Tighten only verified service-owned directories through open descriptors.
    let library = private_child(&home, OsStr::new("Library"), 451, 451)?;
    private_child(&library, OsStr::new("Keychains"), 451, 451)?;
    child(
        &base,
        OsStr::new("homelab-runner-control"),
        0,
        0,
        Mode::from_raw_mode(0o755),
    )?;
    let helpers = child(
        &base,
        OsStr::new("homelab-runner-helpers"),
        0,
        0,
        Mode::from_raw_mode(0o755),
    )?;
    let target = child(&helpers, OsStr::new(leaf), 0, 0, Mode::from_raw_mode(0o755))?;
    install_helper(source, &target)?;
    Ok(())
}

fn install_helper(source: &Path, target: &File) -> Result<(), ProvisionError> {
    let canonical = std::fs::canonicalize(source)?;
    if !canonical.starts_with("/nix/store") {
        return Err(ProvisionError::UnsafePath);
    }
    crate::tart::trusted_executable(&canonical, false).map_err(|_| ProvisionError::UnsafePath)?;
    let mut input = File::from(fs::open(
        &canonical,
        OFlags::RDONLY | OFlags::NOFOLLOW,
        Mode::empty(),
    )?);
    let metadata = input.metadata()?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.len() > 64 * 1024 * 1024
        || metadata.len() == 0
    {
        return Err(ProvisionError::UnsafePath);
    }
    let mut bytes = Vec::new();
    input.read_to_end(&mut bytes)?;
    let existing_fd = match fs::openat(
        target,
        "softnet",
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        Ok(fd) => Some(fd),
        Err(rustix::io::Errno::NOENT) => None,
        Err(error) => return Err(error.into()),
    };
    if let Some(fd) = existing_fd {
        let mut existing = File::from(fd);
        let metadata = existing.metadata()?;
        if !metadata.is_file()
            || metadata.uid() != 0
            || metadata.gid() != 451
            || metadata.mode() & 0o7777 != 0o4750
            || metadata.len() > 64 * 1024 * 1024
        {
            return Err(ProvisionError::UnsafePath);
        }
        let mut old = Vec::new();
        Read::by_ref(&mut existing)
            .take(64 * 1024 * 1024 + 1)
            .read_to_end(&mut old)?;
        if old == bytes {
            return Ok(());
        }
        return Err(ProvisionError::UnsafePath);
    }
    let temporary = format!(".softnet-{}", uuid::Uuid::new_v4().simple());
    let result = (|| {
        let mut output = File::from(fs::openat(
            target,
            temporary.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW,
            Mode::from_raw_mode(0o600),
        )?);
        output.write_all(&bytes)?;
        fs::fchown(&output, Some(Uid::ROOT), Some(Gid::from_raw(451)))?;
        fs::fchmod(&output, Mode::from_raw_mode(0o4750))?;
        output.sync_all()?;
        // No service account can write target; publication is atomic after all checks.
        fs::renameat(target, temporary.as_str(), target, "softnet")?;
        target.sync_all()?;
        Ok::<_, ProvisionError>(())
    })();
    if result.is_err() {
        let _ = fs::unlinkat(target, temporary.as_str(), fs::AtFlags::empty());
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_owned_symlink_cannot_redirect_provisioning() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("controller")).unwrap();
        let before = std::fs::metadata(outside.path()).unwrap().mode();
        let parent = File::open(root.path()).unwrap();
        assert!(
            child(
                &parent,
                OsStr::new("controller"),
                rustix::process::geteuid().as_raw(),
                rustix::process::getegid().as_raw(),
                Mode::from_raw_mode(0o700)
            )
            .is_err()
        );
        assert_eq!(std::fs::metadata(outside.path()).unwrap().mode(), before);
    }

    #[test]
    fn native_created_service_directories_are_tightened_after_owner_validation() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let parent = File::open(root.path()).unwrap();
        let uid = rustix::process::geteuid().as_raw();
        let gid = rustix::process::getegid().as_raw();
        for (name, mode) in [("Library", 0o755), ("Keychains", 0o711)] {
            let path = root.path().join(name);
            std::fs::create_dir(&path).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(mode)).unwrap();
            assert!(private_child(&parent, OsStr::new(name), uid + 1, gid).is_err());
            assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o7777, mode);
            private_child(&parent, OsStr::new(name), uid, gid).unwrap();
            assert_eq!(std::fs::metadata(&path).unwrap().mode() & 0o7777, 0o700);
        }
        let outside = tempfile::tempdir().unwrap();
        std::fs::set_permissions(outside.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("redirected")).unwrap();
        assert!(private_child(&parent, OsStr::new("redirected"), uid, gid).is_err());
        assert_eq!(
            std::fs::metadata(outside.path()).unwrap().mode() & 0o7777,
            0o755
        );
    }
}
