use std::fs::File;
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use rustix::fd::OwnedFd;
use rustix::fs::{AtFlags, Mode, OFlags, fchmod, fsync, linkat, mkdirat, open, openat, unlinkat};
use thiserror::Error;

static NEXT_TEMP: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InstallError {
    #[error(
        "The source must be a nonempty private regular file owned by the expected user, no larger than 64 KiB."
    )]
    InvalidSource,
    #[error(
        "The destination must be a private directory owned by the installing user, without a symlink."
    )]
    UnsafeDestination,
    #[error("A host key already exists; it was not replaced.")]
    AlreadyExists,
    #[error("The host key could not be prepared for installation.")]
    PrepareFailed,
    #[error(
        "The host key was published, but durable installation could not be confirmed. Inspect the destination before retrying."
    )]
    ConfirmationFailed,
}

struct StagedKey<'a> {
    directory: &'a OwnedFd,
    name: String,
}

impl Drop for StagedKey<'_> {
    fn drop(&mut self) {
        let _ = unlinkat(self.directory, self.name.as_str(), AtFlags::empty());
    }
}

pub fn install(
    source: &Path,
    destination_directory: &Path,
    source_uid: u32,
) -> Result<(), InstallError> {
    install_inner(source, destination_directory, source_uid, false)
}

/// Resume an interrupted publication only when the protected destination is
/// byte-for-byte identical. An unexpected identity is never overwritten.
pub fn ensure(
    source: &Path,
    destination_directory: &Path,
    source_uid: u32,
) -> Result<(), InstallError> {
    install_inner(source, destination_directory, source_uid, true)
}

fn install_inner(
    source: &Path,
    destination_directory: &Path,
    source_uid: u32,
    reuse_matching: bool,
) -> Result<(), InstallError> {
    let source = open(
        source,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map(File::from)
    .map_err(|_| InstallError::InvalidSource)?;
    let metadata = source.metadata().map_err(|_| InstallError::InvalidSource)?;
    if !metadata.is_file()
        || metadata.uid() != source_uid
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
    {
        return Err(InstallError::InvalidSource);
    }
    let mut contents = Vec::new();
    source
        .take(65_537)
        .read_to_end(&mut contents)
        .map_err(|_| InstallError::InvalidSource)?;
    if contents.is_empty() || contents.len() > 65_536 {
        return Err(InstallError::InvalidSource);
    }

    let name = destination_directory
        .file_name()
        .ok_or(InstallError::UnsafeDestination)?;
    let parent = destination_directory
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let parent = open(
        parent,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| InstallError::UnsafeDestination)?;
    match mkdirat(&parent, name, Mode::RWXU) {
        Ok(()) => fsync(&parent).map_err(|_| InstallError::PrepareFailed)?,
        Err(rustix::io::Errno::EXIST) => {}
        Err(_) => return Err(InstallError::UnsafeDestination),
    }
    let directory = openat(
        &parent,
        name,
        OFlags::RDONLY | OFlags::DIRECTORY | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )
    .map_err(|_| InstallError::UnsafeDestination)?;
    let metadata = rustix::fs::fstat(&directory).map_err(|_| InstallError::UnsafeDestination)?;
    if metadata.st_uid != rustix::process::geteuid().as_raw() || metadata.st_mode & 0o7777 != 0o700
    {
        return Err(InstallError::UnsafeDestination);
    }

    let mut staged = None;
    for _ in 0..100 {
        let name = format!(
            ".key-{}-{}",
            std::process::id(),
            NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
        );
        match openat(
            &directory,
            name.as_str(),
            OFlags::WRONLY | OFlags::CREATE | OFlags::EXCL | OFlags::NOFOLLOW | OFlags::CLOEXEC,
            Mode::RUSR | Mode::WUSR,
        ) {
            Ok(file) => {
                staged = Some((
                    StagedKey {
                        directory: &directory,
                        name,
                    },
                    File::from(file),
                ));
                break;
            }
            Err(rustix::io::Errno::EXIST) => continue,
            Err(_) => return Err(InstallError::PrepareFailed),
        }
    }
    let (staged, mut file) = staged.ok_or(InstallError::PrepareFailed)?;
    fchmod(&file, Mode::RUSR | Mode::WUSR).map_err(|_| InstallError::PrepareFailed)?;
    file.write_all(&contents)
        .and_then(|()| file.sync_all())
        .map_err(|_| InstallError::PrepareFailed)?;
    // Hard-link publication fails for every existing entry, including dangling
    // symlinks. Concurrent installers therefore cannot replace a host identity.
    let published = linkat(
        &directory,
        staged.name.as_str(),
        &directory,
        "key.txt",
        AtFlags::empty(),
    );
    if published == Err(rustix::io::Errno::EXIST) && reuse_matching {
        let mut existing = openat(
            &directory,
            "key.txt",
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map(File::from)
        .map_err(|_| InstallError::AlreadyExists)?;
        let metadata = existing
            .metadata()
            .map_err(|_| InstallError::AlreadyExists)?;
        if !metadata.is_file()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
        {
            return Err(InstallError::AlreadyExists);
        }
        let mut bytes = Vec::new();
        (&mut existing)
            .take(65_537)
            .read_to_end(&mut bytes)
            .map_err(|_| InstallError::AlreadyExists)?;
        if bytes != contents {
            return Err(InstallError::AlreadyExists);
        }
        existing
            .sync_all()
            .map_err(|_| InstallError::ConfirmationFailed)?;
        unlinkat(&directory, staged.name.as_str(), AtFlags::empty())
            .map_err(|_| InstallError::ConfirmationFailed)?;
        fsync(&directory).map_err(|_| InstallError::ConfirmationFailed)?;
        return Ok(());
    }
    published.map_err(|error| {
        if error == rustix::io::Errno::EXIST {
            InstallError::AlreadyExists
        } else {
            InstallError::PrepareFailed
        }
    })?;
    fsync(&directory).map_err(|_| InstallError::ConfirmationFailed)?;
    unlinkat(&directory, staged.name.as_str(), AtFlags::empty())
        .map_err(|_| InstallError::ConfirmationFailed)?;
    fsync(&directory).map_err(|_| InstallError::ConfirmationFailed)?;
    Ok(())
}
