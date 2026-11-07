use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

use homelab_client::bootstrap_state::{Journal, Phase, StateError};

#[test]
fn activated_resume_uses_original_revision_without_credentials() {
    use homelab_client::bootstrap_state::activation_candidate;
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path();
    let revision = "a".repeat(40);
    let probe = || activation_candidate(home, "example/config", "example", &revision);
    assert!(!probe().unwrap());
    let state = home.join(".local/state/homelab/bootstrap");
    let mut journal =
        Journal::start_or_resume(&state, "example/config", "example", &revision).unwrap();
    for phase in [Phase::Preparing, Phase::Building, Phase::InstallingKey] {
        journal
            .record(phase, Some(std::path::Path::new("/nix/store/test-system")))
            .unwrap();
        assert!(!probe().unwrap());
    }
    for phase in [Phase::Activating, Phase::Activated] {
        journal
            .record(phase, Some(std::path::Path::new("/nix/store/test-system")))
            .unwrap();
        assert!(probe().unwrap());
    }
    assert_eq!(
        activation_candidate(home, "example/config", "example", &"b".repeat(40)),
        Err(StateError::Mismatch)
    );
    assert_eq!(
        activation_candidate(home, "example/other", "example", &revision),
        Err(StateError::Mismatch)
    );
    fs::remove_file(state.join("progress.json")).unwrap();
    assert!(probe().is_err());
}

fn start(path: &std::path::Path) -> Journal {
    Journal::open(
        path,
        "example/config",
        "example",
        "reviewed-revision",
        false,
    )
    .unwrap()
}

#[test]
fn renewal_probe_treats_partial_bootstrap_as_started_and_rejects_unsafe_ancestors() {
    use homelab_client::bootstrap_state::has_started;
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path();
    fs::set_permissions(home, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!has_started(home).unwrap());
    let state = home.join(".local/state/homelab");
    fs::create_dir_all(&state).unwrap();
    assert!(!has_started(home).unwrap());
    fs::create_dir(state.join("bootstrap")).unwrap();
    assert!(has_started(home).unwrap());
    fs::remove_dir(state.join("bootstrap")).unwrap();
    symlink(home.join("missing"), state.join("bootstrap")).unwrap();
    assert_eq!(has_started(home), Err(StateError::UnsafeLocation));
    fs::remove_file(state.join("bootstrap")).unwrap();
    fs::set_permissions(&state, fs::Permissions::from_mode(0o777)).unwrap();
    assert_eq!(has_started(home), Err(StateError::UnsafeLocation));
    fs::set_permissions(&state, fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(has_started(home), Err(StateError::UnsafeLocation));
    fs::set_permissions(&state, fs::Permissions::from_mode(0o700)).unwrap();
    assert!(!has_started(home).unwrap());
}

#[test]
fn automatic_open_starts_or_resumes_only_the_same_safe_attempt() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    let mut journal =
        Journal::start_or_resume(&path, "example/config", "example", "revision").unwrap();
    journal.record(Phase::Building, None).unwrap();
    drop(journal);
    let mut resumed =
        Journal::start_or_resume(&path, "example/config", "example", "revision").unwrap();
    assert_eq!(resumed.phase(), Phase::Building);
    resumed.record(Phase::InstallingKey, None).unwrap();
    drop(resumed);
    assert!(matches!(
        Journal::start_or_resume(&path, "example/config", "example", "revision"),
        Err(StateError::NeedsInspection)
    ));
    assert!(matches!(
        Journal::start_or_resume(&path, "example/config", "example", "different"),
        Err(StateError::Mismatch)
    ));
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
    let mut resumed = Journal::open(
        &path,
        "example/config",
        "example",
        "reviewed-revision",
        true,
    )
    .unwrap();
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
        Journal::open(
            &competing_path,
            "example/config",
            "example",
            "reviewed-revision",
            true,
        )
        .err()
    })
    .join()
    .unwrap();
    assert_eq!(error, Some(StateError::Busy));
    drop(journal);
    assert!(path.join("bootstrap.lock").exists());
    assert!(
        Journal::open(
            &path,
            "example/config",
            "example",
            "reviewed-revision",
            true
        )
        .is_ok()
    );
}

#[test]
fn existing_state_requires_resume_and_original_inputs() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    drop(start(&path));
    assert_eq!(
        Journal::open(
            &path,
            "example/config",
            "example",
            "reviewed-revision",
            false
        )
        .err(),
        Some(StateError::AlreadyStarted)
    );
    assert_eq!(
        Journal::open(
            &path,
            "example/config",
            "different",
            "reviewed-revision",
            true
        )
        .err(),
        Some(StateError::Mismatch)
    );
    assert_eq!(
        Journal::open(&path, "other/config", "example", "reviewed-revision", true).err(),
        Some(StateError::Mismatch)
    );
    assert_eq!(
        Journal::open(&path, "example/config", "example", "different", true).err(),
        Some(StateError::Mismatch)
    );
    assert_eq!(
        Journal::open(
            &temporary.path().join("missing"),
            "example/config",
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
            Journal::open(
                &path,
                "example/config",
                "example",
                "reviewed-revision",
                true
            )
            .err(),
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
    for bytes in [b"{broken".to_vec(), vec![b' '; 65_537], br#"{"schema":1,"repository":"example/config","host":"example","revision":"reviewed-revision","phase":"Preparing","builtSystem":null,"secret":"unexpected"}"#.to_vec()] {
        fs::write(&file, &bytes).unwrap();
        assert_eq!(Journal::open(&path, "example/config", "example", "reviewed-revision", true).err(), Some(StateError::Invalid));
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
        Journal::open(
            &path,
            "example/config",
            "example",
            "reviewed-revision",
            true
        )
        .err(),
        Some(StateError::UnsafeLocation)
    );
    fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
    let alias = temporary.path().join("alias");
    symlink(&path, &alias).unwrap();
    assert_eq!(
        Journal::open(
            &alias,
            "example/config",
            "example",
            "reviewed-revision",
            true
        )
        .err(),
        Some(StateError::UnsafeLocation)
    );
    for name in ["bootstrap.lock", "progress.json"] {
        let file = path.join(name);
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(
            Journal::open(
                &path,
                "example/config",
                "example",
                "reviewed-revision",
                true
            )
            .err(),
            Some(StateError::UnsafeLocation)
        );
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        let original = fs::read(&file).unwrap();
        fs::remove_file(&file).unwrap();
        symlink("absent", &file).unwrap();
        assert_eq!(
            Journal::open(
                &path,
                "example/config",
                "example",
                "reviewed-revision",
                true
            )
            .err(),
            Some(StateError::UnsafeLocation)
        );
        assert!(file.is_symlink());
        fs::remove_file(&file).unwrap();
        fs::write(&file, original).unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
    }
}

#[test]
fn repair_requires_existing_journal_and_exact_original_effective_pair() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join("state");
    let old = "a".repeat(40);
    let new = "b".repeat(40);
    let open = || Journal::open_repair(&path, "example/config", "example", &old, &new);
    assert!(matches!(open(), Err(StateError::Missing)));
    assert!(!path.join("progress.json").exists());
    let mut journal = Journal::open(&path, "example/config", "example", &old, false).unwrap();
    journal.record(Phase::InstallingNix, None).unwrap();
    drop(journal);
    let before = fs::read(path.join("progress.json")).unwrap();
    drop(open().unwrap());
    assert_eq!(fs::read(path.join("progress.json")).unwrap(), before);
    let mut journal = open().unwrap();
    journal.record_repair(&old, &new).unwrap();
    drop(journal);
    let after = fs::read(path.join("progress.json")).unwrap();
    let mut journal = open().unwrap();
    journal.record_repair(&old, &new).unwrap();
    drop(journal);
    assert_eq!(fs::read(path.join("progress.json")).unwrap(), after);
    assert!(
        Journal::open_repair(&path, "example/config", "example", &old, &"c".repeat(40)).is_err()
    );
    assert!(
        Journal::open_repair(&path, "example/config", "example", &new, &"c".repeat(40)).is_err()
    );
}

#[test]
fn repaired_activation_reports_effective_revision_for_original_reservation() {
    let temporary = tempfile::tempdir().unwrap();
    let path = temporary.path().join(".local/state/homelab/bootstrap");
    let old = "a".repeat(40);
    let new = "b".repeat(40);
    let mut journal = Journal::open(&path, "example/config", "example", &old, false).unwrap();
    journal.record_repair(&old, &new).unwrap();
    journal
        .record(
            Phase::Activated,
            Some(std::path::Path::new("/nix/store/repaired-system")),
        )
        .unwrap();
    drop(journal);
    assert_eq!(
        homelab_client::bootstrap_state::activation_revision(
            temporary.path(),
            "example/config",
            "example",
            &old
        )
        .unwrap(),
        Some(new)
    );
}
