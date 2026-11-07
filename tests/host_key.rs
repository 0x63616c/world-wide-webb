use std::fs;
use std::os::unix::fs::{MetadataExt, PermissionsExt, symlink};
use std::path::Path;
use std::sync::{Arc, Barrier};

use homelab_client::host_key::{InstallError, ensure, install};

fn source(path: &Path, contents: &[u8], mode: u32) {
    fs::write(path, contents).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
}

fn uid() -> u32 {
    rustix::process::geteuid().as_raw()
}

#[test]
fn unprivileged_cli_rejects_installation_before_reading_source() {
    if rustix::process::geteuid().is_root() {
        return;
    }
    let temporary = tempfile::tempdir().unwrap();
    let missing = temporary.path().join("missing");
    let result = std::process::Command::new(env!("CARGO_BIN_EXE_homelab-host"))
        .args(["install-host-key", "--source"])
        .arg(missing)
        .args(["--source-uid", &uid().to_string()])
        .output()
        .unwrap();
    assert_eq!(result.status.code(), Some(1));
    assert!(result.stdout.is_empty());
    assert!(
        String::from_utf8(result.stderr)
            .unwrap()
            .contains("requires administrator elevation")
    );
    assert_eq!(fs::read_dir(temporary.path()).unwrap().count(), 0);
}

#[test]
fn resume_keeps_matching_identity_and_rejects_replacement_or_symlink() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    let directory = temporary.path().join("keys");
    source(&input, b"fixture-host-key\n", 0o600);
    ensure(&input, &directory, uid()).unwrap();
    let destination = directory.join("key.txt");
    let inode = fs::metadata(&destination).unwrap().ino();
    ensure(&input, &directory, uid()).unwrap();
    assert_eq!(fs::metadata(&destination).unwrap().ino(), inode);
    source(&input, b"different-key\n", 0o600);
    assert_eq!(
        ensure(&input, &directory, uid()),
        Err(InstallError::AlreadyExists)
    );
    assert_eq!(fs::read(&destination).unwrap(), b"fixture-host-key\n");
    fs::remove_file(&destination).unwrap();
    symlink(&input, &destination).unwrap();
    assert_eq!(
        ensure(&input, &directory, uid()),
        Err(InstallError::AlreadyExists)
    );
}

#[test]
fn installs_complete_private_key_and_cleans_staging_file() {
    for mode in [0o400, 0o600] {
        let temporary = tempfile::tempdir().unwrap();
        let input = temporary.path().join("source");
        let directory = temporary.path().join("keys");
        source(&input, b"fixture-host-key\n", mode);
        install(&input, &directory, uid()).unwrap();
        let key = directory.join("key.txt");
        assert_eq!(fs::read(&key).unwrap(), b"fixture-host-key\n");
        let metadata = fs::metadata(key).unwrap();
        assert_eq!(metadata.uid(), uid());
        assert_eq!(metadata.mode() & 0o7777, 0o600);
        assert_eq!(fs::metadata(&directory).unwrap().mode() & 0o7777, 0o700);
        assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
    }
}

#[test]
fn invalid_sources_never_create_destination() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    let directory = temporary.path().join("keys");
    for mode in [0o000, 0o200, 0o440, 0o640, 0o644, 0o700] {
        source(&input, b"fixture", mode);
        assert_eq!(
            install(&input, &directory, uid()),
            Err(InstallError::InvalidSource),
            "requested mode {mode:o}, actual mode {:o}",
            fs::metadata(&input).unwrap().mode() & 0o7777
        );
        assert!(!directory.exists());
        fs::remove_file(&input).unwrap();
    }
    for contents in [Vec::new(), vec![b'x'; 65_537]] {
        source(&input, &contents, 0o600);
        assert_eq!(
            install(&input, &directory, uid()),
            Err(InstallError::InvalidSource)
        );
        assert!(!directory.exists());
    }
    source(&input, b"fixture", 0o600);
    assert_eq!(
        install(&input, &directory, uid().wrapping_add(1)),
        Err(InstallError::InvalidSource)
    );
    fs::remove_file(&input).unwrap();
    fs::create_dir(&input).unwrap();
    assert_eq!(
        install(&input, &directory, uid()),
        Err(InstallError::InvalidSource)
    );
}

#[test]
fn special_mode_bits_are_checked_as_retained_by_the_filesystem() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    let directory = temporary.path().join("keys");
    source(&input, b"fixture", 0o4600);
    let mode = fs::metadata(&input).unwrap().mode() & 0o7777;
    match mode {
        0o4600 => {
            assert_eq!(
                install(&input, &directory, uid()),
                Err(InstallError::InvalidSource)
            );
            assert!(!directory.exists());
        }
        // A sandbox can strip setuid during chmod; a resulting 0600 file is private.
        0o600 => {
            install(&input, &directory, uid()).unwrap();
            assert_eq!(fs::read(directory.join("key.txt")).unwrap(), b"fixture");
        }
        _ => panic!("requested mode 4600, unexpected effective mode {mode:o}"),
    }
}

#[test]
fn symlink_source_is_not_followed() {
    let temporary = tempfile::tempdir().unwrap();
    let real = temporary.path().join("real");
    let alias = temporary.path().join("source");
    let directory = temporary.path().join("keys");
    source(&real, b"fixture", 0o600);
    symlink(&real, &alias).unwrap();
    assert_eq!(
        install(&alias, &directory, uid()),
        Err(InstallError::InvalidSource)
    );
    assert!(!directory.exists());
}

#[test]
fn unsafe_directory_and_directory_symlink_are_rejected() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    source(&input, b"fixture", 0o600);
    let directory = temporary.path().join("keys");
    fs::create_dir(&directory).unwrap();
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        install(&input, &directory, uid()),
        Err(InstallError::UnsafeDestination)
    );
    assert_eq!(fs::metadata(&directory).unwrap().mode() & 0o7777, 0o755);
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
    let alias = temporary.path().join("alias");
    symlink(&directory, &alias).unwrap();
    assert_eq!(
        install(&input, &alias, uid()),
        Err(InstallError::UnsafeDestination)
    );
    assert_eq!(fs::read_dir(directory).unwrap().count(), 0);
}

#[test]
fn existing_key_and_dangling_symlink_are_never_replaced() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    let directory = temporary.path().join("keys");
    source(&input, b"first", 0o600);
    install(&input, &directory, uid()).unwrap();
    source(&input, b"second", 0o600);
    assert_eq!(
        install(&input, &directory, uid()),
        Err(InstallError::AlreadyExists)
    );
    let key = directory.join("key.txt");
    assert_eq!(fs::read(&key).unwrap(), b"first");
    fs::remove_file(&key).unwrap();
    symlink("absent", &key).unwrap();
    assert_eq!(
        install(&input, &directory, uid()),
        Err(InstallError::AlreadyExists)
    );
    assert_eq!(fs::read_link(key).unwrap(), Path::new("absent"));
    assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
}

#[test]
fn concurrent_installers_publish_exactly_one_complete_key() {
    let temporary = tempfile::tempdir().unwrap();
    let directory = temporary.path().join("keys");
    let barrier = Arc::new(Barrier::new(2));
    let contents = [vec![b'a'; 65_536], vec![b'b'; 65_536]];
    let handles: Vec<_> = contents
        .iter()
        .enumerate()
        .map(|(index, contents)| {
            let input = temporary.path().join(format!("source-{index}"));
            source(&input, contents, 0o600);
            let directory = directory.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                barrier.wait();
                install(&input, &directory, uid())
            })
        })
        .collect();
    let results: Vec<_> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|result| **result == Err(InstallError::AlreadyExists))
            .count(),
        1
    );
    assert!(contents.contains(&fs::read(directory.join("key.txt")).unwrap()));
    assert_eq!(fs::read_dir(directory).unwrap().count(), 1);
}

#[test]
fn fifo_source_is_rejected_without_waiting_for_a_writer() {
    let temporary = tempfile::tempdir().unwrap();
    let input = temporary.path().join("source");
    assert!(
        std::process::Command::new("/usr/bin/mkfifo")
            .arg(&input)
            .status()
            .unwrap()
            .success()
    );
    let directory = temporary.path().join("keys");
    assert_eq!(
        install(&input, &directory, uid()),
        Err(InstallError::InvalidSource)
    );
    assert!(!directory.exists());
}
