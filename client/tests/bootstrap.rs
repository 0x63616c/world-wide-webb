use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::process::Command;

use homelab_client::bootstrap::{Error, Request, Tools, run};
use homelab_client::bootstrap_state::{Journal, Phase};
use serde_json::json;
use sha2::{Digest, Sha256};

struct Fixture {
    directory: tempfile::TempDir,
    request: Request,
    tools: Tools,
}
impl Fixture {
    fn new(existing_nix: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        fs::write(root.join("REVISION"), "a".repeat(40)).unwrap();
        let executable = root.join("fixture");
        let output = Command::new("rustc")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/bootstrap.rs"))
            .arg("-o")
            .arg(&executable)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        for name in [
            "git",
            "uname",
            "id",
            "dseditgroup",
            "sudo",
            "curl",
            "helper",
            "nix",
        ] {
            symlink(&executable, root.join(name)).unwrap();
        }
        fs::create_dir_all(root.join("system/sw/bin")).unwrap();
        symlink(&executable, root.join("system/sw/bin/homelab-host")).unwrap();
        for name in ["age-key", "github-token"] {
            fs::write(root.join(name), "fixture-only-never-a-real-secret").unwrap();
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o600)).unwrap();
        }
        fs::write(root.join("installer.json"), serde_json::to_vec(&json!({
            "url":"https://github.com/DeterminateSystems/nix-installer/releases/download/v1.2.3/nix-installer-aarch64-darwin",
            "sha256":Sha256::digest(b"fixture-installer").iter().map(|byte| format!("{byte:02x}")).collect::<String>()
        })).unwrap()).unwrap();
        fs::write(root.join("readiness.json"), serde_json::to_vec(&json!({"activationReady":true,"adminUser":"admin","adminUID":501,"authorizedKeys":["fixture-public-key"]})).unwrap()).unwrap();
        let request = Request {
            host: "homelab-macbook".into(),
            revision: "a".repeat(40),
            age_key: root.join("age-key"),
            github_token: root.join("github-token"),
            approved_host: Some("homelab-macbook".into()),
            resume: false,
        };
        let tools = Tools {
            git: root.join("git"),
            uname: root.join("uname"),
            id: root.join("id"),
            dseditgroup: root.join("dseditgroup"),
            sudo: root.join("sudo"),
            curl: root.join("curl"),
            helper: root.join("helper"),
            installed_nix: root.join("installed-nix"),
            nix: existing_nix.then(|| root.join("nix")),
        };
        Self {
            directory,
            request,
            tools,
        }
    }
    fn state(&self) -> PathBuf {
        self.directory.path().join("state")
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
    fn run(&self) -> Result<homelab_client::bootstrap::Report, Error> {
        run(&self.request, &self.tools, &self.state())
    }
    fn no_host_mutation(&self) {
        assert!(
            !self
                .events()
                .iter()
                .any(|event| ["install-key", "activate", "install-nix"].contains(&event.as_str())),
            "{:?}",
            self.events()
        );
    }
}

#[test]
fn fresh_install_and_existing_nix_reach_activation_without_real_host_tools() {
    for existing_nix in [false, true] {
        let fixture = Fixture::new(existing_nix);
        let report = fixture.run().unwrap();
        assert_eq!(report.phase, Phase::Activated);
        let events = fixture.events();
        assert_eq!(events.contains(&"install-nix".into()), !existing_nix);
        assert_eq!(events.contains(&"download-installer".into()), !existing_nix);
        let positions: Vec<_> = [
            "fetch",
            "evaluate",
            "build",
            "verify-secrets",
            "install-key",
            "activate",
        ]
        .iter()
        .map(|expected| events.iter().position(|event| event == expected).unwrap())
        .collect();
        assert!(positions.windows(2).all(|pair| pair[0] < pair[1]));
    }
}

#[test]
fn approval_identity_and_exact_revision_are_required_before_secrets_or_network() {
    for case in [
        "no-approval",
        "wrong-user",
        "wrong-architecture",
        "noncommit",
    ] {
        let mut fixture = Fixture::new(true);
        fs::remove_file(&fixture.request.age_key).unwrap();
        let expected = match case {
            "no-approval" => {
                fixture.request.approved_host = None;
                Error::ApprovalRequired
            }
            "noncommit" => {
                fixture.request.revision = "main".into();
                Error::InvalidRequest
            }
            _ => {
                fixture.flag(case);
                Error::WrongTarget
            }
        };
        assert_eq!(fixture.run().unwrap_err(), expected);
        assert!(fixture.events().is_empty());
        assert!(!fixture.state().exists());
    }
}

#[test]
fn unsafe_credential_inputs_are_rejected_before_fetch() {
    for symlink_input in [false, true] {
        let fixture = Fixture::new(true);
        if symlink_input {
            let target = fixture.directory.path().join("real-key");
            fs::rename(&fixture.request.age_key, &target).unwrap();
            symlink(target, &fixture.request.age_key).unwrap();
        } else {
            fs::set_permissions(&fixture.request.age_key, fs::Permissions::from_mode(0o644))
                .unwrap();
        }
        assert_eq!(fixture.run().unwrap_err(), Error::InvalidCredentials);
        assert!(fixture.events().is_empty());
    }
}

#[test]
fn missing_ciphertext_or_wrong_commit_never_mutates_host() {
    for (flag, expected) in [
        ("missing-ciphertext", Error::Unprovisioned),
        ("wrong-revision", Error::Repository),
    ] {
        let fixture = Fixture::new(true);
        fixture.flag(flag);
        assert_eq!(fixture.run().unwrap_err(), expected);
        fixture.no_host_mutation();
        assert!(!fixture.events().contains(&"evaluate".into()));
    }
}

#[test]
fn unready_or_wrong_identity_configuration_never_builds_or_installs_key() {
    for (field, value) in [
        ("activationReady", json!(false)),
        ("adminUID", json!(502)),
        ("adminUser", json!("other")),
        ("authorizedKeys", json!([])),
    ] {
        let fixture = Fixture::new(true);
        let path = fixture.directory.path().join("readiness.json");
        let mut readiness: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        readiness[field] = value;
        fs::write(path, serde_json::to_vec(&readiness).unwrap()).unwrap();
        assert_eq!(fixture.run().unwrap_err(), Error::NotReady);
        fixture.no_host_mutation();
        assert!(!fixture.events().contains(&"build".into()));
    }
}

#[test]
fn decryption_failure_and_existing_key_block_identity_changes() {
    for (flag, expected) in [
        ("decrypt-fails", Error::Decryption),
        ("existing-key", Error::ExistingKey),
    ] {
        let fixture = Fixture::new(true);
        fixture.flag(flag);
        assert_eq!(fixture.run().unwrap_err(), expected);
        fixture.no_host_mutation();
    }
    let fixture = Fixture::new(true);
    fixture.flag("late-key");
    assert_eq!(fixture.run().unwrap_err(), Error::KeyInstallation);
    assert!(!fixture.events().contains(&"activate".into()));
    assert!(!fixture.directory.path().join("installed-key").exists());
}

#[test]
fn uncertain_journal_phases_block_replay_before_fetch() {
    for phase in [Phase::InstallingKey, Phase::Activating, Phase::Activated] {
        let mut fixture = Fixture::new(true);
        let mut journal = Journal::open(
            &fixture.state(),
            &fixture.request.host,
            &fixture.request.revision,
            false,
        )
        .unwrap();
        journal.record(phase, None).unwrap();
        drop(journal);
        fixture.request.resume = true;
        assert_eq!(fixture.run().unwrap_err(), Error::RecoveryRequired);
        assert!(fixture.events().is_empty());
    }
}

#[test]
fn interrupted_installation_requires_inspection_even_when_nix_runs() {
    for existing in [false, true] {
        let mut fixture = Fixture::new(existing);
        let mut journal = Journal::open(
            &fixture.state(),
            &fixture.request.host,
            &fixture.request.revision,
            false,
        )
        .unwrap();
        journal.record(Phase::InstallingNix, None).unwrap();
        drop(journal);
        let progress = fs::read(fixture.state().join("progress.json")).unwrap();
        fixture.request.resume = true;
        fs::remove_file(&fixture.request.age_key).unwrap();
        assert_eq!(fixture.run().unwrap_err(), Error::RecoveryRequired);
        fixture.no_host_mutation();
        assert!(fixture.events().is_empty());
        assert_eq!(
            fs::read(fixture.state().join("progress.json")).unwrap(),
            progress
        );
    }
}

#[test]
fn mismatched_artifact_never_reads_credentials_or_invokes_tools() {
    let fixture = Fixture::new(true);
    fs::write(fixture.directory.path().join("REVISION"), "b".repeat(40)).unwrap();
    fs::remove_file(&fixture.request.age_key).unwrap();
    assert_eq!(fixture.run().unwrap_err(), Error::ArtifactRevision);
    assert!(fixture.events().is_empty());
    assert!(!fixture.state().exists());
}

#[test]
fn actual_git_uses_the_private_askpass_adapter_with_quoted_helper_path() {
    let mut fixture = Fixture::new(true);
    let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|path| path.is_file())
        .expect("Git is required for the askpass integration check")
        .canonicalize()
        .unwrap();
    fs::write(
        fixture.directory.path().join("actual-git"),
        git.to_str().unwrap(),
    )
    .unwrap();
    let helper = fixture.directory.path().join("helper with ' spaces");
    symlink(env!("CARGO_BIN_EXE_homelab-host"), &helper).unwrap();
    fixture.tools.helper = helper;
    fs::write(&fixture.request.github_token, "github_pat_synthetic123\n").unwrap();
    fixture.run().unwrap();
    assert!(fixture.events().contains(&"git-askpass-verified".into()));
}

#[test]
fn authentication_is_refreshed_after_build_before_key_installation() {
    let fixture = Fixture::new(true);
    fixture.flag("late-auth-fails");
    assert_eq!(fixture.run().unwrap_err(), Error::Elevation);
    let events = fixture.events();
    assert_eq!(events.last().unwrap(), "authenticate");
    assert!(events.contains(&"verify-secrets".into()));
    fixture.no_host_mutation();
    let progress: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap()).unwrap();
    assert_eq!(progress["phase"], "VerifyingSecrets");
}
