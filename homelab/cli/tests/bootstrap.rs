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
            "xcode-select",
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
        fs::write(root.join("age-key"), "fixture-only-never-a-real-secret").unwrap();
        fs::set_permissions(root.join("age-key"), fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            std::process::Command::new("/usr/bin/ssh-keygen")
                .args(["-q", "-t", "ed25519", "-N", "", "-f"])
                .arg(root.join("deploy-key"))
                .status()
                .unwrap()
                .success()
        );
        fs::write(root.join("installer.json"), serde_json::to_vec(&json!({
            "url":"https://github.com/DeterminateSystems/nix-installer/releases/download/v1.2.3/nix-installer-aarch64-darwin",
            "sha256":Sha256::digest(b"fixture-installer").iter().map(|byte| format!("{byte:02x}")).collect::<String>()
        })).unwrap()).unwrap();
        fs::write(root.join("readiness.json"), serde_json::to_vec(&json!({"adminUser":"admin","adminUID":501,"authorizedKeys":["ssh-ed25519 AAAA"],"services":[]})).unwrap()).unwrap();
        let expected_host: homelab_client::config::Host =
            serde_json::from_slice(&fs::read(root.join("readiness.json")).unwrap()).unwrap();
        fs::write(
            root.join("manifest.json"),
            serde_json::to_vec(&json!({"schema":1,"hosts":{"workstation":expected_host}})).unwrap(),
        )
        .unwrap();
        let request = Request {
            repository: "example/private-config".into(),
            expected_host,
            host: "workstation".into(),
            revision: "a".repeat(40),
            age_key: root.join("age-key"),
            deploy_key: root.join("deploy-key"),
            approved_host: Some("workstation".into()),
            resume: false,
            repair_from: None,
            repair_previous: None,
        };
        let tools = Tools {
            git: root.join("git"),
            xcode_select: root.join("xcode-select"),
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
fn build_failures_report_the_failed_boundary_before_host_mutation() {
    for (flag, expected) in [
        ("build-fails", "bootstrap-build-failed"),
        (
            "build-supervision-fails",
            "bootstrap-build-supervision-failed",
        ),
        ("build-output-missing", "bootstrap-build-output-unavailable"),
    ] {
        let fixture = Fixture::new(true);
        fixture.flag(flag);
        assert_eq!(fixture.run().unwrap_err().code(), expected);
        fixture.no_host_mutation();
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
fn completed_activation_reconciles_without_secrets_fetch_or_reinstallation() {
    for confirmed in [false, true] {
        let mut fixture = Fixture::new(true);
        let system = fixture.directory.path().join("system");
        let mut journal = Journal::open(
            &fixture.state(),
            &fixture.request.repository,
            &fixture.request.host,
            &fixture.request.revision,
            false,
        )
        .unwrap();
        journal.record(Phase::Activating, Some(&system)).unwrap();
        drop(journal);
        fixture.request.resume = true;
        fs::remove_file(&fixture.request.age_key).unwrap();
        fs::remove_file(&fixture.request.deploy_key).unwrap();
        if confirmed {
            fixture.flag("activation-confirmed");
        }
        let result = fixture.run();
        if confirmed {
            assert_eq!(result.unwrap().phase, Phase::Activated);
        } else {
            assert_eq!(result.unwrap_err(), Error::RecoveryRequired);
        }
        assert!(fixture.events().contains(&"activation-status".into()));
        fixture.no_host_mutation();
        assert!(
            !fixture
                .events()
                .iter()
                .any(|event| event.contains("clone") || event == "activate")
        );
    }
}

#[test]
fn interrupted_key_installation_revalidates_build_and_keeps_its_phase_on_failure() {
    for fail_build in [false, true] {
        let mut fixture = Fixture::new(true);
        let mut journal = Journal::open(
            &fixture.state(),
            &fixture.request.repository,
            &fixture.request.host,
            &fixture.request.revision,
            false,
        )
        .unwrap();
        journal
            .record(
                Phase::InstallingKey,
                Some(
                    &fixture
                        .directory
                        .path()
                        .join("system")
                        .canonicalize()
                        .unwrap(),
                ),
            )
            .unwrap();
        drop(journal);
        fixture.request.resume = true;
        fixture.flag("existing-key");
        if fail_build {
            fixture.flag("build-fails");
        }
        let result = fixture.run();
        if fail_build {
            assert_eq!(result.unwrap_err(), Error::Build);
            let state: serde_json::Value =
                serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap())
                    .unwrap();
            assert_eq!(state["phase"], "InstallingKey");
            fixture.no_host_mutation();
        } else {
            assert_eq!(result.unwrap().phase, Phase::Activated);
            assert!(fixture.events().contains(&"verify-secrets".into()));
        }
    }
}

#[test]
fn interrupted_key_installation_cannot_switch_to_a_different_rebuilt_system() {
    let mut fixture = Fixture::new(true);
    let original = fixture
        .directory
        .path()
        .join("system")
        .canonicalize()
        .unwrap();
    fs::create_dir(fixture.directory.path().join("system-other")).unwrap();
    let mut journal = Journal::open(
        &fixture.state(),
        &fixture.request.repository,
        &fixture.request.host,
        &fixture.request.revision,
        false,
    )
    .unwrap();
    journal
        .record(Phase::InstallingKey, Some(&original))
        .unwrap();
    drop(journal);
    let saved = fs::read(fixture.state().join("progress.json")).unwrap();
    fixture.request.resume = true;
    fixture.flag("different-system");
    fixture.flag("existing-key");
    assert_eq!(fixture.run().unwrap_err(), Error::RecoveryRequired);
    assert_eq!(
        fs::read(fixture.state().join("progress.json")).unwrap(),
        saved
    );
    fixture.no_host_mutation();
}

#[test]
fn uncertain_journal_phases_block_replay_before_fetch() {
    for phase in [Phase::InstallingKey, Phase::Activating, Phase::Activated] {
        let mut fixture = Fixture::new(true);
        let mut journal = Journal::open(
            &fixture.state(),
            &fixture.request.repository,
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
            &fixture.request.repository,
            &fixture.request.host,
            &fixture.request.revision,
            false,
        )
        .unwrap();
        journal.record(Phase::InstallingNix, None).unwrap();
        drop(journal);
        let progress = fs::read(fixture.state().join("progress.json")).unwrap();
        fixture.request.resume = true;

        assert_eq!(fixture.run().unwrap_err(), Error::RecoveryRequired);
        fixture.no_host_mutation();
        assert!(fixture.events().contains(&"nix-status".into()));
        assert_eq!(
            fs::read(fixture.state().join("progress.json")).unwrap(),
            progress
        );
    }
}

#[test]
fn public_helper_revision_is_independent_from_private_configuration() {
    let fixture = Fixture::new(true);
    fs::write(fixture.directory.path().join("REVISION"), "b".repeat(40)).unwrap();
    assert!(fixture.run().is_ok());
}

#[test]
fn manifest_and_evaluated_configuration_must_match_reviewed_host() {
    for file in ["manifest.json", "readiness.json"] {
        let fixture = Fixture::new(true);
        let path = fixture.directory.path().join(file);
        let mut content: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let host = if file == "manifest.json" {
            &mut content["hosts"]["workstation"]
        } else {
            &mut content
        };
        host["services"] = json!(["unexpected-service"]);
        fs::write(path, serde_json::to_vec(&content).unwrap()).unwrap();
        assert_eq!(fixture.run().unwrap_err(), Error::NotReady);
        assert!(
            !fixture
                .events()
                .iter()
                .any(|event| event == "build" || event == "install-key" || event == "activate")
        );
    }
}

#[test]
fn bootstrap_uses_isolated_ssh_transport() {
    let mut fixture = Fixture::new(true);
    let git = std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join("git"))
        .find(|path| path.is_file())
        .expect("Git is required for the SSH transport integration check")
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
    fixture.run().unwrap();
    assert!(fixture.events().contains(&"git-ssh-verified".into()));
}

#[test]
fn expired_authorization_stops_before_key_installation_without_prompting_again() {
    let fixture = Fixture::new(true);
    fixture.flag("late-auth-fails");
    assert_eq!(fixture.run().unwrap_err(), Error::Elevation);
    let events = fixture.events();
    assert_eq!(events.last().unwrap(), "validate-authorization");
    assert_eq!(
        events
            .iter()
            .filter(|event| *event == "authenticate")
            .count(),
        0
    );
    assert!(events.contains(&"verify-secrets".into()));
    fixture.no_host_mutation();
    let progress: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap()).unwrap();
    assert_eq!(progress["phase"], "VerifyingSecrets");
}

#[test]
fn older_built_helper_is_rejected_before_installing_any_identity() {
    let fixture = Fixture::new(true);
    fixture.flag("old-helper");
    assert_eq!(fixture.run().unwrap_err(), Error::BuildOutput);
    fixture.no_host_mutation();
}

#[test]
fn missing_or_broken_developer_tools_stop_before_secrets_journal_or_network() {
    for flag in ["missing-clt", "broken-git"] {
        let fixture = Fixture::new(true);
        fixture.flag(flag);
        fs::remove_file(&fixture.request.age_key).unwrap();
        fs::remove_file(&fixture.request.deploy_key).unwrap();
        assert_eq!(fixture.run().unwrap_err(), Error::CommandLineToolsRequired);
        assert!(!fixture.state().exists());
        assert!(fixture.events().is_empty());
        assert_eq!(
            fixture.directory.path().join("git-invoked").exists(),
            flag == "broken-git"
        );
    }
}

#[test]
fn progress_follows_durable_phases_and_stops_at_the_failed_operation() {
    use homelab_client::bootstrap::run_with_progress;
    for fail_build in [false, true] {
        let fixture = Fixture::new(false);
        if fail_build {
            fixture.flag("build-fails");
        }
        let mut phases = Vec::new();
        let result = run_with_progress(
            &fixture.request,
            &fixture.tools,
            &fixture.state(),
            |phase| {
                let saved: serde_json::Value = serde_json::from_slice(
                    &fs::read(fixture.state().join("progress.json")).unwrap(),
                )
                .unwrap();
                assert_eq!(saved["phase"], serde_json::to_value(phase).unwrap());
                phases.push(phase);
            },
        );
        let mut expected = vec![Phase::Preparing, Phase::InstallingNix, Phase::Building];
        if fail_build {
            assert_eq!(result.unwrap_err(), Error::Build);
        } else {
            result.unwrap();
            expected.extend([
                Phase::VerifyingSecrets,
                Phase::InstallingKey,
                Phase::Activating,
                Phase::Activated,
            ]);
        }
        assert_eq!(phases, expected);
        let messages = phases
            .iter()
            .map(|phase| phase.message())
            .collect::<Vec<_>>()
            .join("\n");
        assert!(!messages.contains(fixture.directory.path().to_str().unwrap()));
        assert!(!messages.contains(&fixture.request.revision));
        assert!(!messages.contains(&fixture.request.repository));
        assert!(!messages.contains("AGE-SECRET"));
    }
}

#[test]
fn silent_bootstrap_child() {
    if std::env::var_os("HOMELAB_TEST_SILENT_BOOTSTRAP").is_none() {
        return;
    }
    Fixture::new(true).run().unwrap();
}

#[test]
fn existing_run_api_does_not_emit_progress_or_child_output() {
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "silent_bootstrap_child", "--nocapture"])
        .env("HOMELAB_TEST_SILENT_BOOTSTRAP", "1")
        .output()
        .unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.is_empty());
    for phase in [
        Phase::Preparing,
        Phase::InstallingNix,
        Phase::Building,
        Phase::VerifyingSecrets,
        Phase::InstallingKey,
        Phase::Activating,
        Phase::Activated,
    ] {
        assert!(!stdout.contains(phase.message()));
    }
    assert!(!stdout.contains("AGE-SECRET"));
}

#[test]
fn verified_interrupted_nix_resumes_without_reinstalling() {
    let mut fixture = Fixture::new(true);
    let mut journal = Journal::open(
        &fixture.state(),
        &fixture.request.repository,
        &fixture.request.host,
        &fixture.request.revision,
        false,
    )
    .unwrap();
    journal.record(Phase::InstallingNix, None).unwrap();
    drop(journal);
    fixture.request.resume = true;
    fixture.flag("nix-confirmed");
    assert!(fixture.run().is_ok());
    assert!(fixture.events().contains(&"nix-status".into()));
    assert!(!fixture.events().contains(&"install-nix".into()));
    assert!(!fixture.events().contains(&"download-installer".into()));
}

#[test]
fn installer_failure_is_reconciled_only_with_verified_completion() {
    for confirmed in [false, true] {
        let fixture = Fixture::new(false);
        fixture.flag("installer-exit-fails");
        if !confirmed {
            fixture.flag("nix-unconfirmed");
        }
        assert_eq!(fixture.run().is_ok(), confirmed);
        assert_eq!(
            fixture
                .events()
                .iter()
                .filter(|event| *event == "install-nix")
                .count(),
            1
        );
        if !confirmed {
            assert!(!fixture.events().contains(&"activate".into()));
        }
    }
}

#[test]
fn diagnostics_record_codes_without_credentials_or_process_output() {
    let fixture = Fixture::new(true);
    fixture.flag("build-fails");
    assert!(fixture.run().is_err());
    let path = fixture.state().join("diagnostics.jsonl");
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("bootstrap-build-failed"));
    assert!(!content.contains("fixture-only-never-a-real-secret"));
    assert!(!content.contains("PRIVATE KEY"));
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    for line in content.lines() {
        let event: serde_json::Value = serde_json::from_str(line).unwrap();
        let fields = event.as_object().unwrap();
        assert!(
            ["timestamp", "phase", "code"]
                .iter()
                .all(|name| fields.contains_key(*name))
        );
        assert!(fields.keys().all(|name| {
            ["timestamp", "phase", "code", "output", "exit_code"].contains(&name.as_str())
        }));
    }
}

fn repair_fixture(phase: Phase) -> Fixture {
    let mut fixture = Fixture::new(true);
    let original = "b".repeat(40);
    let mut journal = Journal::open(
        &fixture.state(),
        &fixture.request.repository,
        &fixture.request.host,
        &original,
        false,
    )
    .unwrap();
    journal.record(phase, None).unwrap();
    drop(journal);
    fixture.request.resume = true;
    fixture.request.repair_from = Some(original);
    fixture.flag("nix-confirmed");
    fixture
}

#[test]
fn configuration_repair_resumes_completed_nix_without_reissuing_credentials_or_installing_nix() {
    let fixture = repair_fixture(Phase::InstallingNix);
    let key = fs::read(&fixture.request.age_key).unwrap();
    let deploy = fs::read(&fixture.request.deploy_key).unwrap();
    fixture.run().unwrap();
    let events = fixture.events();
    assert!(events.contains(&"nix-status".into()));
    assert!(events.contains(&"repair-protected-files".into()));
    assert!(events.contains(&"repair-ancestry".into()));
    assert!(!events.contains(&"install-nix".into()));
    assert!(!events.contains(&"download-installer".into()));
    assert_eq!(fs::read(&fixture.request.age_key).unwrap(), key);
    assert_eq!(fs::read(&fixture.request.deploy_key).unwrap(), deploy);
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap()).unwrap();
    assert_eq!(state["revision"], fixture.request.revision);
    assert_eq!(state["repairedFrom"], "b".repeat(40));
    assert_eq!(state["phase"], "Activated");
}

#[test]
fn failed_repair_checks_preserve_original_journal_and_never_mutate_host() {
    for flag in [
        "evaluation-fails",
        "repair-changed-inputs",
        "repair-not-descendant",
        "existing-key",
        "nix-unconfirmed",
    ] {
        let fixture = repair_fixture(Phase::InstallingNix);
        if flag == "nix-unconfirmed" {
            fs::remove_file(fixture.directory.path().join("nix-confirmed")).unwrap();
        }
        fixture.flag(flag);
        let before = fs::read(fixture.state().join("progress.json")).unwrap();
        assert!(fixture.run().is_err(), "{flag}");
        assert_eq!(
            fs::read(fixture.state().join("progress.json")).unwrap(),
            before,
            "{flag}"
        );
        fixture.no_host_mutation();
    }
}

#[test]
fn configuration_repair_refuses_uncertain_key_installation_or_activation_before_fetch() {
    for phase in [Phase::InstallingKey, Phase::Activating, Phase::Activated] {
        let fixture = repair_fixture(phase);
        let before = fs::read(fixture.state().join("progress.json")).unwrap();
        assert_eq!(fixture.run().unwrap_err(), Error::RecoveryRequired);
        assert_eq!(
            fs::read(fixture.state().join("progress.json")).unwrap(),
            before
        );
        assert!(fixture.events().is_empty());
    }
}

#[test]
fn repair_retries_after_persisting_new_revision_without_losing_original_attempt() {
    let fixture = repair_fixture(Phase::InstallingNix);
    fixture.flag("build-fails");
    assert_eq!(fixture.run().unwrap_err(), Error::Build);
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap()).unwrap();
    assert_eq!(state["revision"], fixture.request.revision);
    assert_eq!(state["repairedFrom"], "b".repeat(40));
    assert_eq!(state["phase"], "Building");
    fixture.no_host_mutation();
    fs::remove_file(fixture.directory.path().join("build-fails")).unwrap();
    fixture.run().unwrap();
    assert!(!fixture.events().contains(&"install-nix".into()));
}

#[test]
fn followup_build_repair_preserves_keys_and_checks_both_ancestries() {
    let mut fixture = repair_fixture(Phase::Building);
    let original = fixture.request.repair_from.clone().unwrap();
    let previous = "c".repeat(40);
    let mut journal = Journal::open_repair(
        &fixture.state(),
        &fixture.request.repository,
        &fixture.request.host,
        &original,
        &previous,
    )
    .unwrap();
    journal.record_repair(&original, &previous).unwrap();
    drop(journal);
    fixture.request.repair_previous = Some(previous.clone());
    let key = fs::read(&fixture.request.age_key).unwrap();
    fixture.run().unwrap();
    let events = fixture.events();
    assert_eq!(
        events
            .iter()
            .filter(|event| *event == "repair-ancestry")
            .count(),
        2
    );
    assert_eq!(
        events
            .iter()
            .filter(|event| *event == "repair-protected-files")
            .count(),
        2
    );
    assert_eq!(fs::read(&fixture.request.age_key).unwrap(), key);
    let state: serde_json::Value =
        serde_json::from_slice(&fs::read(fixture.state().join("progress.json")).unwrap()).unwrap();
    assert_eq!(state["repairedFrom"], original);
    assert_eq!(state["repairedVia"], serde_json::json!([previous]));
    assert_eq!(state["phase"], "Activated");
}

#[test]
fn transient_clone_failure_retries_in_fresh_storage_before_installation() {
    let fixture = Fixture::new(true);
    fixture.flag("clone-transient");
    assert!(fixture.run().is_ok());
    assert_eq!(
        fixture
            .events()
            .iter()
            .filter(|e| *e == "fetch-transient")
            .count(),
        1
    );
    assert_eq!(
        fixture.events().iter().filter(|e| *e == "activate").count(),
        1
    );
}
