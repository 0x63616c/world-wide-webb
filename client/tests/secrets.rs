use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::secrets::{SecretError, verify_host_identity};
use tempfile::TempDir;

struct Fixture {
    directory: TempDir,
    key: PathBuf,
    ciphertext: PathBuf,
    sops: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let key = directory.path().join("source.age");
        let ciphertext = directory.path().join("source.sops.yaml");
        let sops = directory.path().join("sops-fixture");
        fs::write(&key, "synthetic-correct-key").unwrap();
        fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
        fs::write(&ciphertext, "synthetic-ciphertext").unwrap();
        let result = Command::new("rustc")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/sops.rs"))
            .arg("-o")
            .arg(&sops)
            .output()
            .unwrap();
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        Self {
            directory,
            key,
            ciphertext,
            sops,
        }
    }

    fn verify(&self) -> Result<(), SecretError> {
        verify_host_identity(&self.key, &self.ciphertext, &self.sops)
    }

    fn assert_cleaned(&self) {
        let isolated = fs::read_to_string(self.directory.path().join("isolated-home")).unwrap();
        assert!(!Path::new(&isolated).exists());
        assert!(self.key.exists());
        assert!(self.ciphertext.exists());
    }
}

#[test]
fn verifies_supplied_identity_with_private_copies_and_discards_plaintext() {
    let fixture = Fixture::new();
    fixture.verify().unwrap();
    fixture.assert_cleaned();
    assert_eq!(
        fs::read_to_string(&fixture.key).unwrap(),
        "synthetic-correct-key"
    );
    fs::set_permissions(&fixture.key, fs::Permissions::from_mode(0o400)).unwrap();
    fixture.verify().unwrap();
    fixture.assert_cleaned();
}

#[test]
fn wrong_identity_returns_only_a_static_error() {
    let fixture = Fixture::new();
    fs::write(&fixture.key, "synthetic-wrong-key").unwrap();
    let error = fixture.verify().unwrap_err();
    assert_eq!(error, SecretError::VerificationFailed);
    assert!(!format!("{error:?} {error}").contains("synthetic-wrong-key"));
    assert!(!format!("{error:?} {error}").contains("private-key-and-plaintext"));
    fixture.assert_cleaned();
}

#[test]
fn oversized_ciphertext_is_rejected_before_copying_or_running_sops() {
    let fixture = Fixture::new();
    fs::File::options()
        .write(true)
        .open(&fixture.ciphertext)
        .unwrap()
        .set_len(16 * 1024 * 1024 + 1)
        .unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::CiphertextTooLarge));
    assert!(!fixture.directory.path().join("isolated-home").exists());
}

#[test]
fn rejects_unsafe_inputs_before_running_sops() {
    let fixture = Fixture::new();
    for mode in [0o644, 0o660, 0o700] {
        fs::set_permissions(&fixture.key, fs::Permissions::from_mode(mode)).unwrap();
        assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    }
    fs::set_permissions(&fixture.key, fs::Permissions::from_mode(0o600)).unwrap();
    fs::write(&fixture.key, "").unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    fs::write(&fixture.key, vec![b'k'; 65_537]).unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    fs::remove_file(&fixture.key).unwrap();
    symlink(&fixture.ciphertext, &fixture.key).unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    assert_eq!(
        verify_host_identity(
            Path::new("relative.age"),
            &fixture.ciphertext,
            &fixture.sops
        ),
        Err(SecretError::InvalidInputs)
    );
    assert!(!fixture.directory.path().join("executed").exists());
}

#[test]
fn ambient_recovery_credentials_cannot_make_a_wrong_key_work() {
    if let Some(directory) = std::env::var_os("HOMELAB_SOPS_TEST_CHILD") {
        let directory = PathBuf::from(directory);
        let result = verify_host_identity(
            &directory.join("source.age"),
            &directory.join("source.sops.yaml"),
            &directory.join("sops-fixture"),
        );
        assert_eq!(result, Err(SecretError::VerificationFailed));
        return;
    }
    let fixture = Fixture::new();
    fs::write(&fixture.key, "synthetic-wrong-key").unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "ambient_recovery_credentials_cannot_make_a_wrong_key_work",
            "--nocapture",
        ])
        .env("HOMELAB_SOPS_TEST_CHILD", fixture.directory.path())
        .env("SOPS_AGE_KEY", "synthetic-correct-key")
        .env(
            "SOPS_AGE_KEY_FILE",
            fixture.directory.path().join("recovery.age"),
        )
        .env("SOPS_AGE_KEY_CMD", "forbidden-command")
        .env("AWS_ACCESS_KEY_ID", "private-cloud-credential")
        .env("SSH_AUTH_SOCK", "private-agent")
        .env("XDG_CONFIG_HOME", fixture.directory.path().join("operator"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!String::from_utf8_lossy(&output.stdout).contains("private-key-and-plaintext"));
    assert!(!String::from_utf8_lossy(&output.stderr).contains("private-key-and-plaintext"));
    fixture.assert_cleaned();
}

#[test]
fn invalid_ciphertext_or_executable_never_runs_sops() {
    let fixture = Fixture::new();
    fs::write(&fixture.ciphertext, "").unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    fs::remove_file(&fixture.ciphertext).unwrap();
    symlink(&fixture.key, &fixture.ciphertext).unwrap();
    assert_eq!(fixture.verify(), Err(SecretError::InvalidInputs));
    fs::remove_file(&fixture.ciphertext).unwrap();
    fs::write(&fixture.ciphertext, "synthetic-ciphertext").unwrap();
    assert_eq!(
        verify_host_identity(&fixture.key, &fixture.ciphertext, Path::new("sops")),
        Err(SecretError::InvalidInputs)
    );
    assert!(!fixture.directory.path().join("executed").exists());
}

#[test]
fn host_cli_is_silent_on_success_and_redacts_failure() {
    let fixture = Fixture::new();
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_homelab-host"))
            .arg("verify-host-secrets")
            .arg("--key")
            .arg(&fixture.key)
            .arg("--ciphertext")
            .arg(&fixture.ciphertext)
            .arg("--sops")
            .arg(&fixture.sops)
            .env("SOPS_AGE_KEY", "operator-recovery-private-key")
            .output()
            .unwrap()
    };
    let success = run();
    assert!(success.status.success());
    assert!(success.stdout.is_empty());
    assert!(success.stderr.is_empty());
    fs::write(&fixture.key, "synthetic-wrong-key").unwrap();
    let failure = run();
    assert!(!failure.status.success());
    assert!(failure.stdout.is_empty());
    assert_eq!(
        String::from_utf8(failure.stderr).unwrap(),
        "Host identity verification failed: The supplied host identity could not decrypt this host's secrets.\n"
    );
    fixture.assert_cleaned();
}
