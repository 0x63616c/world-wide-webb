use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::tailscale::{EnrollmentError, reconcile};
use tempfile::TempDir;

const RUNNING: &str = r#"{"BackendState":"Running"}"#;
const NEEDS_LOGIN: &str = r#"{"BackendState":"NeedsLogin"}"#;

struct Fixture {
    directory: TempDir,
    executable: PathBuf,
    key: PathBuf,
}

impl Fixture {
    fn new(status: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("tailscale-fixture");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/tailscale.rs");
        let compilation = Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            compilation.status.success(),
            "{}",
            String::from_utf8_lossy(&compilation.stderr)
        );
        fs::write(directory.path().join("status"), status).unwrap();
        fs::write(directory.path().join("after"), RUNNING).unwrap();
        let key = directory.path().join("auth-key");
        Self {
            directory,
            executable,
            key,
        }
    }

    fn provision_key(&self) {
        fs::write(&self.key, "fixture-auth-key-value").unwrap();
        fs::set_permissions(&self.key, fs::Permissions::from_mode(0o400)).unwrap();
    }

    fn calls(&self) -> String {
        fs::read_to_string(self.directory.path().join("calls")).unwrap_or_default()
    }

    fn run(&self) -> Result<(), EnrollmentError> {
        reconcile(
            &self.executable,
            "build-mac",
            "tag:build-machines",
            &self.key,
        )
    }
}

#[test]
fn running_node_reconciles_without_an_auth_key() {
    let fixture = Fixture::new(RUNNING);
    fixture.run().unwrap();
    assert!(
        fixture
            .calls()
            .contains("set --hostname=build-mac --advertise-tags=tag:build-machines --ssh")
    );
    assert!(!fixture.calls().contains("auth-key"));
}

#[test]
fn enrollment_uses_a_file_reference_and_verifies_running() {
    let fixture = Fixture::new(NEEDS_LOGIN);
    fixture.provision_key();
    fixture.run().unwrap();
    let calls = fixture.calls();
    assert!(calls.contains("up --hostname=build-mac"));
    assert!(calls.contains(&format!("--auth-key=file:{}", fixture.key.display())));
    assert!(!calls.contains("fixture-auth-key-value"));
    assert_eq!(calls.matches("status --json --peers=false").count(), 2);
}

#[test]
fn login_requires_a_private_nonempty_key() {
    let fixture = Fixture::new(NEEDS_LOGIN);
    assert!(matches!(
        fixture.run(),
        Err(EnrollmentError::MissingAuthKey)
    ));
    fixture.provision_key();
    fs::set_permissions(&fixture.key, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(matches!(
        fixture.run(),
        Err(EnrollmentError::MissingAuthKey)
    ));
    fs::set_permissions(&fixture.key, fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(&fixture.key, "").unwrap();
    assert!(matches!(
        fixture.run(),
        Err(EnrollmentError::MissingAuthKey)
    ));
    assert!(!fixture.calls().contains("up "));
}

#[test]
fn sops_generation_symlink_is_supported() {
    let fixture = Fixture::new(NEEDS_LOGIN);
    fixture.provision_key();
    let link = fixture.directory.path().join("sops-key");
    symlink(&fixture.key, &link).unwrap();
    reconcile(
        &fixture.executable,
        "build-mac",
        "tag:build-machines",
        &link,
    )
    .unwrap();
}

#[test]
fn malformed_or_unready_status_never_enrolls() {
    let fixture = Fixture::new("not-json");
    assert!(matches!(
        fixture.run(),
        Err(EnrollmentError::StatusUnavailable)
    ));
    fs::write(
        fixture.directory.path().join("status"),
        r#"{"BackendState":"NeedsMachineAuth"}"#,
    )
    .unwrap();
    assert!(matches!(fixture.run(), Err(EnrollmentError::NotReady)));
    assert!(!fixture.calls().contains("up "));
    assert!(!fixture.calls().contains("set "));
}

#[test]
fn failed_apply_does_not_expose_subprocess_output() {
    let fixture = Fixture::new(RUNNING);
    fs::write(fixture.directory.path().join("fail-apply"), "").unwrap();
    let error = fixture.run().unwrap_err();
    assert!(matches!(error, EnrollmentError::ApplyFailed));
    assert!(!error.to_string().contains("fixture-sensitive-output"));
}

#[test]
fn successful_command_is_not_proof_of_running() {
    let fixture = Fixture::new(NEEDS_LOGIN);
    fixture.provision_key();
    fs::write(fixture.directory.path().join("after"), NEEDS_LOGIN).unwrap();
    assert!(matches!(fixture.run(), Err(EnrollmentError::NotRunning)));
}

#[test]
fn invalid_hostname_is_rejected_before_any_command() {
    let fixture = Fixture::new(RUNNING);
    assert!(matches!(
        reconcile(
            &fixture.executable,
            "--bad name",
            "tag:build-machines",
            &fixture.key
        ),
        Err(EnrollmentError::InvalidHostname)
    ));
    assert!(fixture.calls().is_empty());
}

#[test]
fn invalid_tag_is_rejected_before_any_command() {
    let fixture = Fixture::new("Running");
    assert!(matches!(
        reconcile(
            &fixture.executable,
            "build-mac",
            "tag:bad,tag:extra",
            &fixture.key
        ),
        Err(EnrollmentError::InvalidTag)
    ));
    assert!(fixture.calls().is_empty());
}
