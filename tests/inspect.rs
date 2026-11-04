use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::inspect::{InspectionState, inspect};
use homelab_client::inventory::HostProfile;
use tempfile::TempDir;

struct Fixture {
    directory: TempDir,
    executable: PathBuf,
}

impl Fixture {
    fn new(response: &str) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("ssh-fixture");
        let source = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ssh.rs");
        let output = Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        fs::write(directory.path().join("response"), response).unwrap();
        Self {
            directory,
            executable,
        }
    }
}

fn host() -> HostProfile {
    HostProfile {
        identity: None,
        configuration_host: None,
        name: "example".into(),
        address: "example-host".into(),
        user: "operator".into(),
    }
}

#[test]
fn invalid_profiles_are_rejected_before_executing_ssh() {
    let fixture = Fixture::new("");
    for field in ["name", "address", "user"] {
        for value in [
            "-oProxyCommand=secret-command",
            "bad\nhost",
            "",
            "a;secret-command",
        ] {
            let mut profile = host();
            match field {
                "name" => profile.name = value.into(),
                "address" => profile.address = value.into(),
                "user" => profile.user = value.into(),
                _ => unreachable!(),
            }
            let error = inspect(&profile, &fixture.executable).unwrap_err();
            assert_eq!(error.code(), "invalid-host-profile");
            assert!(!format!("{error:?}").contains("secret-command"));
            assert!(!fixture.directory.path().join("executed").exists());
        }
    }
}

#[test]
fn arm_host_uses_fixed_probe_and_serializes_existing_contract() {
    let fixture = Fixture::new("27.2\narm64\noperator\n501\n104857600\n");
    let inventory = fixture.directory.path().join("private/inventory.json");
    homelab_client::inventory::add(&inventory, host()).unwrap();
    let profiles = homelab_client::inventory::load(&inventory).unwrap();
    let selected = profiles
        .iter()
        .find(|profile| profile.name == "example")
        .unwrap();
    let report = inspect(selected, &fixture.executable).unwrap();
    assert!(report.is_ready());
    assert_eq!(report.free_gib, 100.0);
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["schema"], 1);
    assert_eq!(json["state"], "ready");
    assert_eq!(json["macOS"], "27.2");
    assert_eq!(json["freeGiB"], 100.0);
    assert_eq!(json["nextAction"], report.next_action);
    assert_eq!(json.as_object().unwrap().len(), 10);
}

#[test]
fn intel_host_is_explicitly_blocked() {
    let fixture = Fixture::new("27.2\nx86_64\noperator\n501\n104857600\n");
    let report = inspect(&host(), &fixture.executable).unwrap();
    assert!(!report.is_ready());
    assert_eq!(report.state, InspectionState::Blocked);
    assert_eq!(serde_json::to_value(report).unwrap()["state"], "blocked");
}

#[test]
fn unexpected_data_and_wrong_account_are_rejected() {
    let fixture = Fixture::new("");
    for response in [
        "27.2\narm64\nroot\n0\n1\n",
        "27.2\narm64\noperator\n501\n1\nextra\n",
        "27.2\narm64\noperator\n501\n-1\n",
        "27.2\narm64\noperator\n501\n18446744073709551616\n",
        "27.2\narm64\noperator\nno\n1\n",
        "\u{1b}[31msecret-fixture",
    ] {
        fs::write(fixture.directory.path().join("response"), response).unwrap();
        let error = inspect(&host(), &fixture.executable).unwrap_err();
        assert_eq!(error.code(), "unexpected-host-response");
        assert!(!format!("{error:?}").contains("secret-fixture"));
    }
}

#[test]
fn ssh_failures_redact_both_output_streams() {
    let fixture = Fixture::new("");
    fs::write(fixture.directory.path().join("fail"), "").unwrap();
    let error = inspect(&host(), &fixture.executable).unwrap_err();
    assert_eq!(error.code(), "ssh-check-failed");
    assert!(error.next_action().contains("fingerprint"));
    assert!(!format!("{error:?}").contains("secret-fixture"));
}

#[test]
fn excessive_output_is_bounded() {
    let fixture = Fixture::new(&"x".repeat(20_000));
    let error = inspect(&host(), &fixture.executable).unwrap_err();
    assert_eq!(error.code(), "excessive-host-output");
}

#[test]
fn inherits_operator_environment() {
    if let Some(executable) = std::env::var_os("HOMELAB_INSPECT_CHILD") {
        inspect(&host(), Path::new(&executable)).unwrap();
        return;
    }
    let fixture = Fixture::new("27.2\narm64\noperator\n501\n104857600\n");
    fs::write(fixture.directory.path().join("check-environment"), "").unwrap();
    // Set environment only on a subprocess, keeping parallel Rust tests race-free.
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "inherits_operator_environment", "--nocapture"])
        .env("HOMELAB_INSPECT_CHILD", &fixture.executable)
        .env("HOMELAB_INSPECT_ENV", "inherited")
        .env("SSH_AUTH_SOCK", "fixture-agent-socket")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn remembered_agent_identity_is_used_and_public_snapshot_is_removed() {
    let fixture = Fixture::new("27.2\narm64\noperator\n501\n104857600\n");
    let mut profile = host();
    let key = "ssh-ed25519 AAAA";
    fs::write(fixture.directory.path().join("expected-key"), key).unwrap();
    profile.identity = Some(homelab_client::inventory::AgentIdentity {
        public_key: key.into(),
        agent_socket: fixture.directory.path().join("selected agent.sock"),
    });
    let inventory = fixture.directory.path().join("private/inventory.json");
    homelab_client::inventory::add(&inventory, profile).unwrap();
    let loaded = homelab_client::inventory::load(&inventory).unwrap();
    assert!(inspect(&loaded[0], &fixture.executable).unwrap().is_ready());
    for path in fs::read_to_string(fixture.directory.path().join("identity-files"))
        .unwrap()
        .lines()
    {
        assert!(!Path::new(path).exists());
    }
}
