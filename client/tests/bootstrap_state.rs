use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

use homelab_client::bootstrap_state::{Journal, Phase, StateError};

fn start(path: &std::path::Path) -> Journal {
    Journal::open(path, "example", "reviewed-revision", false).unwrap()
}

#[test]
fn records_and_resumes_pre_key_progress() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    let mut journal = start(&path);
    assert_eq!(journal.phase(), Phase::Preparing);
    journal
        .record(Phase::Building, Some(temporary.path()))
        .unwrap();
    let progress: serde_json::Value =
        serde_json::from_slice(&fs::read(path.join("progress.json")).unwrap()).unwrap();
    assert_eq!(progress["builtSystem"], temporary.path().to_str().unwrap());
    assert_eq!(progress["phase"], "Building");
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o7777,
        0o700
    );
    for file in ["progress.json", "bootstrap.lock"] {
        assert_eq!(
            fs::metadata(path.join(file)).unwrap().permissions().mode() & 0o7777,
            0o600
        );
    }
    drop(journal);
    let mut resumed = Journal::open(&path, "example", "reviewed-revision", true).unwrap();
    assert_eq!(resumed.phase(), Phase::Building);
    resumed.record(Phase::VerifyingSecrets, None).unwrap();
}

#[test]
fn os_lock_excludes_concurrent_clients_but_stale_filename_does_not() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    let journal = start(&path);
    let competing_path = path.clone();
    let error = std::thread::spawn(move || {
        Journal::open(&competing_path, "example", "reviewed-revision", true).err()
    })
    .join()
    .unwrap();
    assert_eq!(error, Some(StateError::Busy));
    drop(journal);
    assert!(path.join("bootstrap.lock").exists());
    assert!(Journal::open(&path, "example", "reviewed-revision", true).is_ok());
}

#[test]
fn existing_state_requires_resume_and_original_inputs() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    drop(start(&path));
    assert_eq!(
        Journal::open(&path, "example", "reviewed-revision", false).err(),
        Some(StateError::AlreadyStarted)
    );
    assert_eq!(
        Journal::open(&path, "different", "reviewed-revision", true).err(),
        Some(StateError::Mismatch)
    );
    assert_eq!(
        Journal::open(&path, "example", "different", true).err(),
        Some(StateError::Mismatch)
    );
    assert_eq!(
        Journal::open(
            &temporary.path().join("missing"),
            "example",
            "reviewed-revision",
            true
        )
        .err(),
        Some(StateError::Missing)
    );
}

#[test]
fn uncertain_or_completed_mutations_never_automatically_resume() {
    for phase in [
        Phase::InstallingNix,
        Phase::InstallingKey,
        Phase::Activating,
        Phase::Activated,
    ] {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("state");
        let mut journal = start(&path);
        journal.record(phase, None).unwrap();
        drop(journal);
        assert_eq!(
            Journal::open(&path, "example", "reviewed-revision", true).err(),
            Some(StateError::NeedsInspection)
        );
    }
}

#[test]
fn malformed_and_oversized_progress_are_preserved() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    drop(start(&path));
    let file = path.join("progress.json");
    for bytes in [b"{broken".to_vec(), vec![b' '; 65_537], br#"{"schema":1,"host":"example","revision":"reviewed-revision","phase":"Preparing","builtSystem":null,"secret":"unexpected"}"#.to_vec()] {
        fs::write(&file, &bytes).unwrap();
        assert_eq!(Journal::open(&path, "example", "reviewed-revision", true).err(), Some(StateError::Invalid));
        assert_eq!(fs::read(&file).unwrap(), bytes);
    }
}

#[test]
fn unsafe_permissions_and_symlinks_are_rejected_without_repair() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    drop(start(&path));
    fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        Journal::open(&path, "example", "reviewed-revision", true).err(),
        Some(StateError::UnsafeLocation)
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    let alias = temporary.path().join("alias");
    symlink(&path, &alias).unwrap();
    assert_eq!(
        Journal::open(&alias, "example", "reviewed-revision", true).err(),
        Some(StateError::UnsafeLocation)
    );
    for name in ["bootstrap.lock", "progress.json"] {
        let file = path.join(name);
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            Journal::open(&path, "example", "reviewed-revision", true).err(),
            Some(StateError::UnsafeLocation)
        );
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let original = fs::read(&file).unwrap();
        fs::remove_file(&file).unwrap();
        symlink("absent", &file).unwrap();
        assert_eq!(
            Journal::open(&path, "example", "reviewed-revision", true).err(),
            Some(StateError::UnsafeLocation)
        );
        assert!(file.is_symlink());
        fs::remove_file(&file).unwrap();
        fs::write(&file, original).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    }
}
