use homelab_client::{
    config::Workspace,
    configuration_pr::{Api, Error},
    provisioning, setup_repair,
};
use serde_json::{Value, json};
use std::cell::Cell;

struct Git {
    descriptor_exists: Cell<bool>,
    replacement: Cell<char>,
    changed_ciphertext: bool,
    descendant: bool,
    main_reads: Cell<usize>,
    followup: Cell<bool>,
}
impl Default for Git {
    fn default() -> Self {
        Self {
            descriptor_exists: Cell::new(true),
            replacement: Cell::new('b'),
            changed_ciphertext: false,
            descendant: true,
            main_reads: Cell::new(0),
            followup: Cell::new(false),
        }
    }
}
impl Api for Git {
    fn json(&self, method: &str, path: &str, _: Option<Value>) -> Result<Value, Error> {
        assert_eq!(method, "GET");
        if path.ends_with("/git/ref/heads/main") {
            self.main_reads.set(self.main_reads.get() + 1);
            return Ok(json!({"object":{"sha":"c".repeat(40)}}));
        }
        assert!(path.contains("/compare/"));
        Ok(json!({"status":if self.descendant {"ahead"} else {"diverged"}}))
    }
    fn raw(&self, path: &str) -> Result<Vec<u8>, Error> {
        if path.contains("/setup-repairs/") {
            if path.contains(&format!("/{}.json", "b".repeat(40))) && self.followup.get() {
                return Ok(serde_json::to_vec(&json!({"schema":1,"repository":"example/config","host":"build-mac","originalRevision":"b".repeat(40),"repairedRevision":"d".repeat(40)})).unwrap());
            }
            if !path.contains(&format!("/{}.json", "a".repeat(40))) {
                return Err(Error::Missing);
            }
            if !self.descriptor_exists.get() {
                return Err(Error::Missing);
            }
            return Ok(serde_json::to_vec(&json!({"schema":1,"repository":"example/config","host":"build-mac","originalRevision":"a".repeat(40),"repairedRevision":self.replacement.get().to_string().repeat(40)})).unwrap());
        }
        if self.changed_ciphertext && path.contains("/secrets/") && path.ends_with(&"b".repeat(40))
        {
            return Ok(b"changed".to_vec());
        }
        Ok(b"unchanged fixture bytes".to_vec())
    }
}
fn workspace() -> Workspace {
    Workspace { repository:"example/config".into(), revision:"a".repeat(40), manifest:serde_json::from_value(json!({"schema":1,"hosts":{"build-mac":{"adminUser":"admin","adminUID":501,"authorizedKeys":["ssh-ed25519 AAAA"],"services":[]}}})).unwrap() }
}
fn saved(root: &std::path::Path) {
    provisioning::save_approved_installation(root, "example/config", "build-mac", &"a".repeat(40))
        .unwrap();
}
#[test]
fn frozen_repair_survives_changed_or_deleted_descriptor_without_replacing_original_approval() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("state");
    saved(&root);
    let api = Git::default();
    let (repaired, original) =
        setup_repair::resolve(&api, &root, workspace(), "build-mac").unwrap();
    assert_eq!(repaired.revision, "b".repeat(40));
    assert_eq!(original, Some("a".repeat(40)));
    api.replacement.set('d');
    api.descriptor_exists.set(false);
    saved(&root);
    assert_eq!(
        setup_repair::resolve(&api, &root, workspace(), "build-mac")
            .unwrap()
            .0
            .revision,
        "b".repeat(40)
    );
    assert_eq!(api.main_reads.get(), 2);
    let saved = provisioning::approved_installation(&root, "build-mac")
        .unwrap()
        .unwrap();
    assert_eq!(saved.revision, "a".repeat(40));
    assert_eq!(saved.repair.unwrap().descriptor_commit, "c".repeat(40));
    assert!(
        provisioning::save_approved_installation(
            &root,
            "example/config",
            "build-mac",
            &"d".repeat(40)
        )
        .is_err()
    );
}
#[test]
fn absent_descriptor_does_not_change_saved_setup() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("state");
    saved(&root);
    let api = Git::default();
    api.descriptor_exists.set(false);
    let before = std::fs::read(root.join("installations/build-mac.json")).unwrap();
    let (unchanged, repair) = setup_repair::resolve(&api, &root, workspace(), "build-mac").unwrap();
    assert_eq!(unchanged.revision, "a".repeat(40));
    assert!(repair.is_none());
    assert_eq!(
        std::fs::read(root.join("installations/build-mac.json")).unwrap(),
        before
    );
}
#[test]
fn changed_ciphertext_or_divergent_commit_cannot_be_adopted() {
    for api in [
        Git {
            changed_ciphertext: true,
            ..Git::default()
        },
        Git {
            descendant: false,
            ..Git::default()
        },
    ] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("state");
        saved(&root);
        let before = std::fs::read(root.join("installations/build-mac.json")).unwrap();
        assert!(setup_repair::resolve(&api, &root, workspace(), "build-mac").is_err());
        assert_eq!(
            std::fs::read(root.join("installations/build-mac.json")).unwrap(),
            before
        );
    }
}

#[test]
#[ignore = "explicit read-only GitHub check against a copy of saved non-secret metadata"]
fn published_repair_matches_saved_enrollment() {
    let source = std::path::PathBuf::from(
        std::env::var_os("HOMELAB_TEST_SAVED_REPAIR").expect("explicit provisioning directory"),
    );
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("state");
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(root.join("installations"))
        .unwrap();
    let filename = "installations/homelab-macbook.json";
    let original = std::fs::read(source.join(filename)).unwrap();
    for name in ["repository.json", filename] {
        std::fs::copy(source.join(name), root.join(name)).unwrap();
        std::fs::set_permissions(root.join(name), std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    let saved = provisioning::approved_installation(&root, "homelab-macbook")
        .unwrap()
        .unwrap();
    let workspace =
        homelab_client::config::fetch_revision(&saved.repository, &saved.revision).unwrap();
    let api = homelab_client::configuration_pr::GitHub {
        executable: "/opt/homebrew/bin/gh".into(),
    };
    let (repaired, from) =
        setup_repair::resolve(&api, &root, workspace, "homelab-macbook").unwrap();
    assert_eq!(from.as_deref(), Some(saved.revision.as_str()));
    assert_ne!(repaired.revision, saved.revision);
    assert_eq!(std::fs::read(source.join(filename)).unwrap(), original);
}

#[test]
fn followup_freezes_previous_selection_without_replacing_original_approval() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("state");
    saved(&root);
    let api = Git::default();
    setup_repair::resolve(&api, &root, workspace(), "build-mac").unwrap();
    let first = provisioning::approved_installation(&root, "build-mac")
        .unwrap()
        .unwrap()
        .repair
        .unwrap();
    api.followup.set(true);
    let (effective, original) =
        setup_repair::resolve(&api, &root, workspace(), "build-mac").unwrap();
    assert_eq!(effective.revision, "d".repeat(40));
    assert_eq!(original, Some("a".repeat(40)));
    let latest = provisioning::approved_installation(&root, "build-mac")
        .unwrap()
        .unwrap();
    assert_eq!(latest.revision, "a".repeat(40));
    assert_eq!(
        latest.repair.as_ref().unwrap().previous.as_deref(),
        Some(&first)
    );
    api.followup.set(false);
    api.descriptor_exists.set(false);
    assert_eq!(
        setup_repair::resolve(&api, &root, workspace(), "build-mac")
            .unwrap()
            .0
            .revision,
        "d".repeat(40)
    );
    assert!(provisioning::save_installation_repair(&root, "build-mac", &first).is_err());
}
