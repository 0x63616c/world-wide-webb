use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::power::{Outcome, PowerError, configure_ac_power};
use tempfile::TempDir;

const BEFORE: &str =
    "Battery Power:\n sleep 1\n womp 0\nAC Power:\n sleep 1\n womp 0\n autorestart 0\n";
const AFTER: &str =
    "Battery Power:\n sleep 1\n womp 0\nAC Power:\n sleep 0\n womp 1\n autorestart 1\n";

struct Fixture {
    directory: TempDir,
    executable: PathBuf,
}

impl Fixture {
    fn new(capabilities: &str, after: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("pmset-fixture");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/pmset.rs");
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
        fs::write(directory.path().join("capabilities"), capabilities).unwrap();
        fs::write(directory.path().join("settings"), BEFORE).unwrap();
        fs::write(directory.path().join("after"), after).unwrap();
        Self {
            directory,
            executable,
        }
    }

    fn calls(&self) -> String {
        fs::read_to_string(self.directory.path().join("calls")).unwrap()
    }
}

#[test]
fn applies_ac_policy_and_is_idempotent() {
    let fixture = Fixture::new(
        "Capabilities for AC Power:\n sleep\n womp\n autorestart\n",
        AFTER,
    );
    let report = configure_ac_power(&fixture.executable).unwrap();
    assert_eq!(report.outcome, Outcome::Applied);
    assert!(report.restart_after_power_failure_supported);
    assert_eq!(
        configure_ac_power(&fixture.executable).unwrap().outcome,
        Outcome::AlreadyConfigured
    );
    assert_eq!(
        fixture
            .calls()
            .matches("-c sleep 0 womp 1 autorestart 1")
            .count(),
        1
    );
    assert!(!fixture.calls().contains("-b"));
}

#[test]
fn unsupported_restart_is_reported_and_not_written() {
    let after = AFTER.replace(" autorestart 1\n", "");
    let fixture = Fixture::new("Capabilities for AC Power:\n sleep\n womp\n", &after);
    fs::write(
        fixture.directory.path().join("settings"),
        BEFORE.replace(" autorestart 0\n", ""),
    )
    .unwrap();
    let report = configure_ac_power(&fixture.executable).unwrap();
    assert!(!report.restart_after_power_failure_supported);
    assert!(fixture.calls().contains("-c sleep 0 womp 1\n"));
    assert!(!fixture.calls().contains("autorestart"));
}

#[test]
fn battery_capabilities_cannot_authorize_ac_changes() {
    let fixture = Fixture::new("Capabilities for Battery Power:\n sleep\n womp\n", AFTER);
    assert!(matches!(
        configure_ac_power(&fixture.executable),
        Err(PowerError::AcPowerRequired)
    ));
    assert!(!fixture.calls().contains("-c"));
}

#[test]
fn missing_required_capability_prevents_mutation() {
    let fixture = Fixture::new("Capabilities for AC Power:\n sleep\n", AFTER);
    assert!(matches!(
        configure_ac_power(&fixture.executable),
        Err(PowerError::MissingCapability)
    ));
    assert!(!fixture.calls().contains("-c"));
}

#[test]
fn successful_command_is_not_enough_without_matching_settings() {
    let fixture = Fixture::new("Capabilities for AC Power:\n sleep\n womp\n", BEFORE);
    assert!(matches!(
        configure_ac_power(&fixture.executable),
        Err(PowerError::VerificationFailed)
    ));
}

#[test]
fn changed_battery_policy_is_reported() {
    let after = AFTER.replace("Battery Power:\n sleep 1", "Battery Power:\n sleep 0");
    let fixture = Fixture::new("Capabilities for AC Power:\n sleep\n womp\n", &after);
    assert!(matches!(
        configure_ac_power(&fixture.executable),
        Err(PowerError::BatteryChanged)
    ));
}

#[test]
fn failed_apply_is_not_reported_as_success() {
    let fixture = Fixture::new("Capabilities for AC Power:\n sleep\n womp\n", AFTER);
    fs::write(fixture.directory.path().join("fail-apply"), "").unwrap();
    assert!(matches!(
        configure_ac_power(&fixture.executable),
        Err(PowerError::CommandFailed)
    ));
}
