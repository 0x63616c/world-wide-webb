use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::bootstrap_privileged::{Error, activate, install_nix};
use sha2::{Digest, Sha256};

struct Fixture {
    directory: tempfile::TempDir,
    executable: PathBuf,
    marker: PathBuf,
    hash: String,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("download");
        let marker = directory.path().join("executed");
        let result = Command::new("rustc")
            .arg("--edition=2024")
            .arg(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/bootstrap_privileged.rs"),
            )
            .arg("-o")
            .arg(&executable)
            .env("HOMELAB_FIXTURE_MARKER", &marker)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        let hash = Sha256::digest(fs::read(&executable).unwrap())
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o600)).unwrap();
        Self {
            directory,
            executable,
            marker,
            hash,
        }
    }

    fn install(&self) -> Result<(), Error> {
        install_nix(
            &self.executable,
            &self.hash,
            rustix::process::geteuid().as_raw(),
        )
    }
}

#[test]
fn installer_runs_a_verified_private_snapshot_and_removes_it() {
    let fixture = Fixture::new();
    let original = fs::read(&fixture.executable).unwrap();
    for mode in [0o400, 0o600, 0o700] {
        fs::set_permissions(&fixture.executable, fs::Permissions::from_mode(mode)).unwrap();
        fixture.install().unwrap();
        let snapshot = PathBuf::from(fs::read_to_string(&fixture.marker).unwrap());
        assert_ne!(snapshot, fixture.executable);
        assert!(!snapshot.exists());
        assert!(!snapshot.parent().unwrap().exists());
        assert_eq!(fs::read(&fixture.executable).unwrap(), original);
    }
}

#[test]
fn installer_rejects_mismatch_and_unsafe_sources_without_execution() {
    let fixture = Fixture::new();
    let uid = rustix::process::geteuid().as_raw();
    for digest in ["f".repeat(64), "A".repeat(64), "0".repeat(63)] {
        assert_eq!(
            install_nix(&fixture.executable, &digest, uid),
            Err(Error::InvalidInstaller)
        );
    }
    assert_eq!(
        install_nix(&fixture.executable, &fixture.hash, uid.wrapping_add(1)),
        Err(Error::InvalidInstaller)
    );
    for mode in [0o644, 0o755] {
        fs::set_permissions(&fixture.executable, fs::Permissions::from_mode(mode)).unwrap();
        assert_eq!(fixture.install(), Err(Error::InvalidInstaller));
    }
    fs::set_permissions(&fixture.executable, fs::Permissions::from_mode(0o600)).unwrap();
    let alias = fixture.directory.path().join("alias");
    symlink(&fixture.executable, &alias).unwrap();
    assert_eq!(
        install_nix(&alias, &fixture.hash, uid),
        Err(Error::InvalidInstaller)
    );
    fs::File::options()
        .write(true)
        .open(&fixture.executable)
        .unwrap()
        .set_len(100 * 1024 * 1024 + 1)
        .unwrap();
    assert_eq!(fixture.install(), Err(Error::InvalidInstaller));
    assert!(!fixture.marker.exists());
}

#[test]
fn installer_checks_effective_special_permissions() {
    let fixture = Fixture::new();
    fs::set_permissions(&fixture.executable, fs::Permissions::from_mode(0o4600)).unwrap();
    let mode = fs::metadata(&fixture.executable)
        .unwrap()
        .permissions()
        .mode()
        & 0o7777;
    // Sandboxed filesystems can clear setuid when chmod succeeds.
    match mode {
        0o4600 => {
            assert_eq!(fixture.install(), Err(Error::InvalidInstaller));
            assert!(!fixture.marker.exists());
        }
        0o600 => assert_eq!(fixture.install(), Ok(())),
        _ => panic!("unexpected effective installer mode: {mode:o}"),
    }
}

#[test]
fn installer_failure_requires_inspection_and_cleans_snapshot() {
    let fixture = Fixture::new();
    fs::write(fixture.marker.with_extension("fail"), "").unwrap();
    assert_eq!(fixture.install(), Err(Error::InstallationUnconfirmed));
    let snapshot = fs::read_to_string(&fixture.marker).unwrap();
    assert!(!Path::new(&snapshot).exists());
    assert!(
        !Error::InstallationUnconfirmed
            .to_string()
            .contains("private-output")
    );
}

#[test]
fn activation_rejects_non_store_paths_without_execution() {
    let fixture = Fixture::new();
    assert_eq!(
        activate(fixture.directory.path()),
        Err(Error::InvalidActivation)
    );
    assert_eq!(
        activate(Path::new("relative")),
        Err(Error::InvalidActivation)
    );
    assert_eq!(
        activate(Path::new("/nix/store")),
        Err(Error::InvalidActivation)
    );
    assert!(!fixture.marker.exists());
}
