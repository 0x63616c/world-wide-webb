use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::inventory::HostProfile;
use homelab_client::remote_setup::{self, Request, Tools};
use serde_json::json;
use sha2::{Digest, Sha256};

struct Fixture {
    directory: tempfile::TempDir,
    tools: Tools,
}
impl Fixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let executable = root.join("fixture");
        let build = Command::new("rustc")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/remote_setup.rs"))
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            build.status.success(),
            "{}",
            String::from_utf8_lossy(&build.stderr)
        );
        for name in ["ssh", "scp"] {
            symlink(&executable, root.join(name)).unwrap();
        }
        fs::create_dir(root.join("artifact")).unwrap();
        fs::write(root.join("artifact/homelab-host"), "synthetic-helper").unwrap();
        fs::write(root.join("artifact/bootstrap.sh"), "synthetic-launcher").unwrap();
        fs::write(
            root.join("artifact/REVISION"),
            format!("{}\n", "a".repeat(40)),
        )
        .unwrap();
        fs::write(root.join("artifact/setup-plan.json"), serde_json::to_vec(&json!({
            "schema":1,"revision":"a".repeat(40),"hosts":{"homelab-macbook":{
                "activationReady":true,"adminUser":"admin","adminUID":501,"hasAuthorizedKeys":true,"services":["home-assistant"]
            }}
        })).unwrap()).unwrap();
        for (name, contents) in [
            ("source-age", "synthetic-private-age"),
            ("source-token", "synthetic-private-token"),
        ] {
            fs::write(root.join(name), contents).unwrap();
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o600)).unwrap();
        }
        let tools = Tools {
            ssh: root.join("ssh"),
            scp: root.join("scp"),
        };
        let fixture = Self { directory, tools };
        fixture.checksums();
        fixture
    }
    fn request(&self) -> Request {
        let root = self.directory.path();
        Request {
            profile: HostProfile {
                name: "my-macbook".into(),
                address: "example-host".into(),
                user: "admin".into(),
            },
            configuration_host: "homelab-macbook".into(),
            revision: "a".repeat(40),
            artifact_directory: root.join("artifact"),
            age_key: root.join("source-age"),
            github_token: root.join("source-token"),
            resume: false,
        }
    }
    fn checksums(&self) {
        let artifact = self.directory.path().join("artifact");
        let sums: String = [
            "homelab-host",
            "bootstrap.sh",
            "REVISION",
            "setup-plan.json",
        ]
        .iter()
        .map(|name| {
            let hash: String = Sha256::digest(fs::read(artifact.join(name)).unwrap())
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
            format!("{hash}  {name}\n")
        })
        .collect();
        fs::write(artifact.join("SHA256SUMS"), sums).unwrap();
    }
    fn flag(&self, name: &str) {
        fs::write(self.directory.path().join(name), "").unwrap();
    }
    fn events(&self) -> Vec<String> {
        fs::read_to_string(self.directory.path().join("events"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
    fn path(&self, name: &str) -> PathBuf {
        self.directory.path().join(name)
    }
}

#[test]
fn approved_journey_transfers_snapshots_runs_interactively_cleans_and_reconnects() {
    let fixture = Fixture::new();
    let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
    assert_eq!(prepared.configuration_host(), "homelab-macbook");
    assert!(
        prepared
            .lines()
            .iter()
            .any(|line| line.contains("home-assistant"))
    );
    assert_eq!(fixture.events(), ["inspect"]);
    // The reviewed snapshot, rather than later edits to caller inputs, is sent.
    fs::write(fixture.path("source-age"), "changed-after-review").unwrap();
    let report = remote_setup::apply(prepared, &fixture.tools).unwrap();
    assert_eq!(
        fixture.events(),
        [
            "inspect",
            "inspect",
            "stage",
            "transfer",
            "verify",
            "bootstrap",
            "cleanup",
            "inspect"
        ]
    );
    assert!(
        report
            .lines()
            .iter()
            .any(|line| line.contains("Only the selected SSH route"))
    );
    assert_eq!(
        fs::read_to_string(fixture.path("source-age")).unwrap(),
        "changed-after-review"
    );
}

#[test]
fn dropping_review_cancels_without_remote_mutation() {
    let fixture = Fixture::new();
    drop(remote_setup::prepare(fixture.request(), &fixture.tools).unwrap());
    assert_eq!(fixture.events(), ["inspect"]);
}

#[test]
fn unready_plan_and_artifact_tampering_block_before_ssh() {
    for case in ["not-ready", "hash", "revision"] {
        let fixture = Fixture::new();
        if case == "not-ready" {
            let path = fixture.path("artifact/setup-plan.json");
            let mut plan: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
            plan["hosts"]["homelab-macbook"]["activationReady"] = json!(false);
            fs::write(path, serde_json::to_vec(&plan).unwrap()).unwrap();
            fixture.checksums();
        } else if case == "hash" {
            fs::write(fixture.path("artifact/homelab-host"), "tampered").unwrap();
        } else {
            fs::write(fixture.path("artifact/REVISION"), "b".repeat(40)).unwrap();
            fixture.checksums();
        }
        assert!(remote_setup::prepare(fixture.request(), &fixture.tools).is_err());
        assert!(fixture.events().is_empty());
    }
}

#[test]
fn changed_target_identity_blocks_before_credentials_are_transferred() {
    let fixture = Fixture::new();
    let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
    fixture.flag("changed-uid");
    let error = remote_setup::apply(prepared, &fixture.tools).err().unwrap();
    assert_eq!(error.code(), "setup-target-changed");
    assert_eq!(fixture.events(), ["inspect", "inspect"]);
}

#[test]
fn transfer_and_hash_failures_never_start_bootstrap_and_cleanup_known_files() {
    for case in ["transfer-fails", "remote-hash-fails"] {
        let fixture = Fixture::new();
        let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
        fixture.flag(case);
        assert!(remote_setup::apply(prepared, &fixture.tools).is_err());
        assert!(!fixture.events().contains(&"bootstrap".into()));
        assert_eq!(fixture.events().last().unwrap(), "cleanup");
    }
}

#[test]
fn interrupted_sessions_are_unknown_and_do_not_cleanup_in_use_staging() {
    for status in [255, 130, 143] {
        let fixture = Fixture::new();
        let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
        fs::write(fixture.path("interrupted-status"), status.to_string()).unwrap();
        let error = remote_setup::apply(prepared, &fixture.tools).err().unwrap();
        assert_eq!(error.code(), "setup-outcome-unknown");
        assert!(
            error
                .next_action()
                .contains("/private/tmp/homelab-setup.ABC12345")
        );
        assert!(!fixture.events().contains(&"cleanup".into()));
        assert!(!format!("{error:?} {error}").contains("synthetic-private"));
    }
}

#[test]
fn failure_cleanup_and_reconnect_results_are_not_reported_as_success() {
    for (flag, expected) in [
        ("bootstrap-fails", "setup-bootstrap-failed"),
        ("cleanup-fails", "setup-cleanup-unconfirmed"),
        ("reconnect-fails", "setup-reconnect-failed"),
    ] {
        let fixture = Fixture::new();
        let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
        fixture.flag(flag);
        assert_eq!(
            remote_setup::apply(prepared, &fixture.tools)
                .err()
                .unwrap()
                .code(),
            expected
        );
        assert!(fixture.events().contains(&"cleanup".into()));
    }
}

#[test]
fn unsafe_credentials_and_remote_paths_are_rejected() {
    let fixture = Fixture::new();
    fs::set_permissions(
        fixture.path("source-token"),
        fs::Permissions::from_mode(0o644),
    )
    .unwrap();
    assert_eq!(
        remote_setup::prepare(fixture.request(), &fixture.tools)
            .err()
            .unwrap()
            .code(),
        "setup-invalid-credentials"
    );
    assert_eq!(fixture.events(), ["inspect"]);
    fs::set_permissions(
        fixture.path("source-token"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let prepared = remote_setup::prepare(fixture.request(), &fixture.tools).unwrap();
    fixture.flag("unsafe-stage");
    assert_eq!(
        remote_setup::apply(prepared, &fixture.tools)
            .err()
            .unwrap()
            .code(),
        "setup-staging-failed"
    );
    assert!(!fixture.events().contains(&"transfer".into()));
    assert!(!fixture.events().contains(&"cleanup".into()));
}
