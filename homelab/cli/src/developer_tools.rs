//! The approved prerequisite installs one Apple CLT catalog item, never OS updates.
use std::fs::{self, File};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use thiserror::Error;

use crate::process;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Developer tools installation requires administrator authorization on macOS.")]
    Authorization,
    #[error(
        "Developer tools state is unsafe or unavailable. Inspect its ownership and permissions."
    )]
    State,
    #[error("Another developer tools operation is running. Wait before reconnecting.")]
    Busy,
    #[error(
        "An earlier developer tools installation may still be running. Inspect Apple Software Update before retrying; no second installation was started."
    )]
    Interrupted,
    #[error(
        "The selected developer tools are not working. Repair the existing Xcode selection before retrying."
    )]
    Selection,
    #[error(
        "Apple did not provide an unambiguous Command Line Tools package. Retry after checking Software Update on the Mac."
    )]
    Catalog,
    #[error(
        "Apple Command Line Tools installation did not finish successfully. Inspect Software Update on the Mac before retrying."
    )]
    Installation,
}

/// Called within the operator-approved setup, which includes Apple developer tools.
pub fn ensure_installed(progress: impl Fn(&str)) -> Result<(), Error> {
    if !cfg!(target_os = "macos") || rustix::process::geteuid().as_raw() != 0 {
        return Err(Error::Authorization);
    }
    let parent = fs::canonicalize("/var/db").map_err(|_| Error::State)?;
    for ancestor in parent.ancestors() {
        let metadata = fs::symlink_metadata(ancestor).map_err(|_| Error::State)?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err(Error::State);
        }
    }
    ensure(
        &Tools::native(),
        &parent.join("homelab-developer-tools"),
        0,
        progress,
    )
}

struct Tools {
    select: PathBuf,
    git: PathBuf,
    clt_git: PathBuf,
    pkgutil: PathBuf,
    update: PathBuf,
    marker: PathBuf,
}

impl Tools {
    fn native() -> Self {
        Self {
            select: "/usr/bin/xcode-select".into(),
            git: "/usr/bin/git".into(),
            clt_git: "/Library/Developer/CommandLineTools/usr/bin/git".into(),
            pkgutil: "/usr/sbin/pkgutil".into(),
            update: "/usr/sbin/softwareupdate".into(),
            marker: "/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress".into(),
        }
    }
}

fn command(path: &Path, args: &[&str]) -> Command {
    let mut command = Command::new(path);
    command
        .args(args)
        .env_clear()
        .env("HOME", "/var/root")
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    command
}

fn succeeds(path: &Path, args: &[&str]) -> bool {
    process::run_silent(&mut command(path, args), Duration::from_secs(30))
        .is_ok_and(|status| status.success())
}

fn private_file(path: &Path, uid: u32, exclusive: bool) -> Result<File, Error> {
    let mut flags =
        OFlags::RDWR | OFlags::CREATE | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC;
    if exclusive {
        flags |= OFlags::EXCL;
    }
    let file = File::from(open(path, flags, Mode::from_raw_mode(0o600)).map_err(|_| Error::State)?);
    let metadata = file.metadata().map_err(|_| Error::State)?;
    if !metadata.is_file()
        || metadata.uid() != uid
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 1
    {
        return Err(Error::State);
    }
    Ok(file)
}

struct InstallationLock(File);

impl Drop for InstallationLock {
    fn drop(&mut self) {
        // Another thread's fork can briefly inherit this descriptor before exec.
        // Explicit unlock prevents that child from prolonging a completed run.
        let _ = flock(&self.0, FlockOperation::Unlock);
    }
}

fn ensure(tools: &Tools, directory: &Path, uid: u32, progress: impl Fn(&str)) -> Result<(), Error> {
    match fs::DirBuilder::new().mode(0o700).create(directory) {
        Ok(()) => File::open(directory.parent().ok_or(Error::State)?)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error::State)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(_) => return Err(Error::State),
    }
    let metadata = fs::symlink_metadata(directory).map_err(|_| Error::State)?;
    if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o777 != 0o700 {
        return Err(Error::State);
    }
    let lock = private_file(&directory.join("lock"), uid, false)?;
    flock(&lock, FlockOperation::NonBlockingLockExclusive).map_err(|_| Error::Busy)?;
    let _lock = InstallationLock(lock);
    // Never execute Apple's git shim without a selection: it can launch a GUI.
    if succeeds(&tools.select, &["--print-path"]) {
        return if succeeds(&tools.git, &["--version"]) {
            Ok(())
        } else {
            Err(Error::Selection)
        };
    }
    let attempted = directory.join("installation-started");
    match fs::symlink_metadata(&attempted) {
        Ok(_) => {
            // A disconnect after installation can precede xcode-select. Verify
            // the receipt and actual tool before repairing only that selection.
            return if installed_clt(tools) {
                select_clt(tools)
            } else {
                Err(Error::Interrupted)
            };
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
        Err(_) => return Err(Error::State),
    }
    // Do not take over another installer's demand marker, including a symlink.
    let marker = private_file(&tools.marker, uid, true)?;
    let result = (|| {
        progress("Checking Apple’s Command Line Tools catalog…");
        let output = process::capture(
            &mut command(&tools.update, &["--list"]),
            Duration::from_secs(300),
        )
        .map_err(|_| Error::Catalog)?;
        if !output.status.success() {
            return Err(Error::Catalog);
        }
        let label =
            catalog_label(std::str::from_utf8(&output.stdout).map_err(|_| Error::Catalog)?)?;
        let mut journal = private_file(&attempted, uid, true)?;
        journal
            .write_all(
                b"Apple CLT installation was requested. Verify completion before recovery.\n",
            )
            .and_then(|_| journal.sync_all())
            .map_err(|_| Error::State)?;
        File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error::State)?;
        progress("Installing Apple Command Line Tools. This can take several minutes…");
        let status = process::run_silent(
            &mut command(&tools.update, &["--install", &label]),
            Duration::from_secs(3600),
        )
        .map_err(|_| Error::Installation)?;
        if !status.success() || !installed_clt(tools) {
            return Err(Error::Installation);
        }
        select_clt(tools)?;
        Ok(())
    })();
    // Only remove the marker created by this operation, never a replacement.
    let original = marker.metadata().map_err(|_| Error::State)?;
    if fs::symlink_metadata(&tools.marker)
        .is_ok_and(|m| m.dev() == original.dev() && m.ino() == original.ino())
    {
        fs::remove_file(&tools.marker).map_err(|_| Error::State)?;
    }
    result
}

fn installed_clt(tools: &Tools) -> bool {
    succeeds(
        &tools.pkgutil,
        &["--pkg-info", "com.apple.pkg.CLTools_Executables"],
    ) && succeeds(&tools.clt_git, &["--version"])
}

fn select_clt(tools: &Tools) -> Result<(), Error> {
    if succeeds(
        &tools.select,
        &["--switch", "/Library/Developer/CommandLineTools"],
    ) && succeeds(&tools.git, &["--version"])
    {
        Ok(())
    } else {
        Err(Error::Installation)
    }
}

fn catalog_label(catalog: &str) -> Result<String, Error> {
    let mut candidates = Vec::new();
    for line in catalog.lines() {
        let Some(label) = line.trim().strip_prefix("* Label: ") else {
            continue;
        };
        let version = if let Some(version) = label.strip_prefix("Command Line Tools for Xcode-") {
            version
        } else if let Some(versions) = label.strip_prefix("Command Line Tools for Xcode ") {
            let (title_version, package_version) =
                versions.split_once('-').ok_or(Error::Catalog)?;
            numeric_version(title_version)?;
            package_version
        } else {
            continue;
        };
        let numbers = numeric_version(version)?;
        candidates.push((numbers, label));
    }
    candidates.sort_by(|a, b| a.0.cmp(&b.0));
    let (version, label) = candidates.pop().ok_or(Error::Catalog)?;
    if candidates
        .last()
        .is_some_and(|(other, _)| other == &version)
    {
        return Err(Error::Catalog);
    }
    Ok(label.to_owned())
}

fn numeric_version(version: &str) -> Result<Vec<u32>, Error> {
    if version.is_empty() || version.len() > 32 {
        return Err(Error::Catalog);
    }
    let numbers: Option<Vec<u32>> = version
        .split('.')
        .map(|part| {
            if part.is_empty() || !part.bytes().all(|c| c.is_ascii_digit()) {
                None
            } else {
                part.parse().ok()
            }
        })
        .collect();
    let mut numbers = numbers.ok_or(Error::Catalog)?;
    while numbers.last() == Some(&0) {
        numbers.pop();
    }
    Ok(numbers)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    use std::sync::OnceLock;

    struct Fixture {
        root: tempfile::TempDir,
        tools: Tools,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().unwrap();
            let executable = root.path().join("native-tool");
            static BINARY: OnceLock<tempfile::TempDir> = OnceLock::new();
            let compiled = BINARY.get_or_init(|| {
                let directory = tempfile::tempdir().unwrap();
                assert!(
                    Command::new("rustc")
                        .args(["--edition=2024", "tests/fixtures/developer_tools.rs", "-o"])
                        .arg(directory.path().join("fixture"))
                        .current_dir(env!("CARGO_MANIFEST_DIR"))
                        .status()
                        .unwrap()
                        .success()
                );
                directory
            });
            fs::copy(compiled.path().join("fixture"), &executable).unwrap();
            let tools = Tools {
                select: executable.clone(),
                git: executable.clone(),
                clt_git: executable.clone(),
                pkgutil: executable.clone(),
                update: executable,
                marker: root.path().join("demand-marker"),
            };
            Self { root, tools }
        }

        fn run(&self) -> Result<(), Error> {
            ensure(
                &self.tools,
                &self.root.path().join("state"),
                rustix::process::geteuid().as_raw(),
                |_| {},
            )
        }

        fn calls(&self) -> String {
            fs::read_to_string(self.root.path().join("calls")).unwrap()
        }
    }

    #[test]
    fn catalog_selects_only_latest_numeric_clt_and_rejects_ambiguous_labels() {
        assert_eq!(catalog_label("* Label: macOS 99\n* Label: Command Line Tools for Xcode-16.9\n* Label: Command Line Tools for Xcode-16.10\n").unwrap(), "Command Line Tools for Xcode-16.10");
        for invalid in [
            "* Label: macOS 99",
            "* Label: Command Line Tools for Xcode-27;echo secret",
            "* Label: Command Line Tools for Xcode-27\n* Label: Command Line Tools for Xcode-27.0",
            "* Label: Command Line Tools for Xcode-27 beta",
            "* Label: Command Line Tools for Xcode 27.2-27.2;echo secret",
            "* Label: Command Line Tools for Xcode beta-27.2",
            "* Label: Command Line Tools for Xcode 27.2-27.2-1",
            "* Label: Command Line Tools for Xcode 27.2-27.2\n* Label: Command Line Tools for Xcode-27.2",
        ] {
            assert_eq!(catalog_label(invalid), Err(Error::Catalog));
        }
    }

    #[test]
    fn accepts_catalog_observed_on_fresh_macos_vm() {
        let catalog = "Software Update found the following new or updated software:\n* Label: Command Line Tools for Xcode 27.2-27.2\n\tTitle: Command Line Tools for Xcode 27.2, Version: 27.2, Size: 521120KiB, Recommended: YES,\n";
        assert_eq!(
            catalog_label(catalog).unwrap(),
            "Command Line Tools for Xcode 27.2-27.2"
        );
    }

    #[test]
    fn installs_one_package_verifies_and_reconnect_does_not_reinstall() {
        let fixture = Fixture::new();
        fixture.run().unwrap();
        fixture.run().unwrap();
        let calls = fixture.calls();
        assert_eq!(calls.matches("--install ").count(), 1);
        assert!(calls.contains("--pkg-info com.apple.pkg.CLTools_Executables"));
        assert!(calls.contains("--switch /Library/Developer/CommandLineTools"));
        assert!(!fixture.tools.marker.exists());
        assert!(
            fixture
                .root
                .path()
                .join("state/installation-started")
                .is_file()
        );
    }

    #[test]
    fn failed_or_interrupted_install_is_not_replayed() {
        let fixture = Fixture::new();
        fs::write(fixture.root.path().join("fail"), "").unwrap();
        assert_eq!(fixture.run(), Err(Error::Installation));
        fs::remove_file(fixture.root.path().join("fail")).unwrap();
        assert_eq!(fixture.run(), Err(Error::Interrupted));
        assert_eq!(fixture.calls().matches("--install ").count(), 1);
        assert!(!fixture.tools.marker.exists());
        assert!(!Error::Installation.to_string().contains("secret"));
    }

    #[test]
    fn interrupted_after_install_recovers_selection_without_installing_again() {
        let fixture = Fixture::new();
        fs::write(fixture.root.path().join("fail"), "").unwrap();
        assert_eq!(fixture.run(), Err(Error::Installation));
        // Simulate Apple finishing after the transport was interrupted.
        fs::write(fixture.root.path().join("installed"), "").unwrap();
        fixture.run().unwrap();
        assert!(fixture.root.path().join("selected").exists());
        assert_eq!(fixture.calls().matches("--install ").count(), 1);
        assert_eq!(fixture.calls().matches("--list").count(), 1);
    }

    #[test]
    fn existing_selection_is_preserved_and_broken_selection_is_not_replaced() {
        let fixture = Fixture::new();
        fs::write(fixture.root.path().join("selected"), "").unwrap();
        assert_eq!(fixture.run(), Err(Error::Selection));
        fs::write(fixture.root.path().join("installed"), "").unwrap();
        fixture.run().unwrap();
        assert!(!fixture.calls().contains("--list"));
    }

    #[test]
    fn concurrent_operation_and_unsafe_marker_are_refused() {
        let fixture = Fixture::new();
        let state = fixture.root.path().join("state");
        fs::DirBuilder::new().mode(0o700).create(&state).unwrap();
        let lock = private_file(
            &state.join("lock"),
            rustix::process::geteuid().as_raw(),
            false,
        )
        .unwrap();
        flock(&lock, FlockOperation::NonBlockingLockExclusive).unwrap();
        assert_eq!(fixture.run(), Err(Error::Busy));
        drop(lock);
        let target = fixture.root.path().join("untouched");
        fs::write(&target, "preserved").unwrap();
        symlink(&target, &fixture.tools.marker).unwrap();
        assert_eq!(fixture.run(), Err(Error::State));
        assert_eq!(fs::read_to_string(target).unwrap(), "preserved");
        assert!(!fixture.calls().contains("--list"));
    }
}
