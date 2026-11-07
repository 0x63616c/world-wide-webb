use std::path::Path;
use std::process::Command;

use homelab_client::inventory::HostProfile;
use homelab_client::remote_completion::{self, Installation};

struct Fixture {
    directory: tempfile::TempDir,
}

impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let output = Command::new("rustc")
            .args(["--edition=2024", "-o"])
            .arg(directory.path().join("ssh"))
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/remote_completion.rs"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Self { directory }
    }

    fn flag(&self, name: &str) {
        std::fs::write(self.directory.path().join(name), "yes").unwrap();
    }

    fn finish(
        &self,
    ) -> Result<homelab_client::bootstrap_privileged::VerifiedSetup, remote_completion::Error> {
        remote_completion::finish_with_tools(
            &HostProfile {
                name: "build-mac".into(),
                address: "example-host".into(),
                user: "admin".into(),
                identity: None,
                configuration_host: Some("build-mac".into()),
            },
            &self.directory.path().join("ssh"),
            &self.directory.path().join("ssh"),
            Installation {
                repository: "example/config",
                host: "build-mac",
                revision: &"a".repeat(40),
                tag: "tag:homelab",
            },
            |_| {},
        )
    }

    fn events(&self) -> String {
        std::fs::read_to_string(self.directory.path().join("events")).unwrap()
    }
}

#[test]
fn verifies_tailnet_reboot_and_completion_without_repeating_finished_setup() {
    let fixture = Fixture::new();
    fixture.flag("lost-reboot-response");
    assert!(fixture.finish().unwrap().completed);
    let before = fixture.events();
    assert_eq!(before.matches("request-setup-reboot").count(), 1);
    assert_eq!(before.matches(" verify-setup ").count(), 2);
    assert!(
        before
            .lines()
            .any(|line| line.starts_with("100.80.1.2:") && line.contains("read-setup-report"))
    );
    assert!(fixture.finish().unwrap().completed);
    let after = fixture.events();
    assert_eq!(after.matches("request-setup-reboot").count(), 1);
    assert_eq!(after.matches(" verify-setup ").count(), 2);
}

#[test]
fn stale_verification_never_reboots_or_completes() {
    let fixture = Fixture::new();
    fixture.flag("stale-report");
    assert!(fixture.finish().is_err());
    let events = fixture.events();
    assert!(!events.contains("request-setup-reboot"));
    assert!(!events.contains(" complete-setup "));
}

#[test]
fn failed_tailnet_route_keeps_hold_before_reboot() {
    let fixture = Fixture::new();
    fixture.flag("tailnet-fails");
    assert!(matches!(
        fixture.finish(),
        Err(remote_completion::Error::Tailnet)
    ));
    let events = fixture.events();
    assert!(!events.contains("request-setup-reboot"));
    assert!(!events.contains(" complete-setup "));
}

#[test]
fn already_rebooted_host_only_verifies_and_completes() {
    let fixture = Fixture::new();
    fixture.flag("rebooted");
    assert!(fixture.finish().unwrap().completed);
    assert!(!fixture.events().contains("request-setup-reboot"));
}

#[test]
fn rejected_reboot_does_not_wait_or_claim_completion() {
    let fixture = Fixture::new();
    fixture.flag("reboot-denied");
    assert!(matches!(
        fixture.finish(),
        Err(remote_completion::Error::RebootRequest)
    ));
    assert!(!fixture.events().contains("kern.bootsessionuuid"));
    assert!(!fixture.events().contains(" complete-setup "));
}
