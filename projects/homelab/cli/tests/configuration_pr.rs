use homelab_client::{
    config::{Manifest, Workspace},
    configuration_pr::{self, Api, Error},
};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};

struct GitHub {
    manifest: Manifest,
    rules: String,
    existing_secret: Option<String>,
    branch: RefCell<Option<String>>,
    pull: RefCell<Option<Value>>,
    writes: RefCell<Vec<(String, Value)>>,
    lose_reference_response: Cell<bool>,
    lose_pr_response: Cell<bool>,
}
fn pr() -> Value {
    json!({"number":7,"html_url":"https://github.com/example/config/pull/7", "state":"open",
        "merged_at":null,"merge_commit_sha":null,"base":{"ref":"main","repo":{"full_name":"example/config"}}})
}
impl GitHub {
    fn new() -> Self {
        Self {
            manifest: serde_json::from_value(json!({"schema":1,"hosts":{
                "test-mac":{"adminUser":"admin","adminUID":501,"authorizedKeys":[],"activationReady":false,"services":[]},
                "other-mac":{"adminUser":"other","adminUID":502,"authorizedKeys":["ssh-ed25519 OTHER"],"activationReady":false,"services":[]}
            }})).unwrap(),
            rules: "creation_rules:\n  - path_regex: '^other/'\n    age: 'age1other'\n".into(),
            existing_secret: None, branch: RefCell::new(None), pull: RefCell::new(None),
            writes: RefCell::new(vec![]), lose_reference_response: Cell::new(false), lose_pr_response: Cell::new(false),
        }
    }
    fn workspace(&self) -> Workspace {
        Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest: self.manifest.clone(),
        }
    }
}
impl Api for GitHub {
    fn json(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, Error> {
        if method == "PATCH" && path.ends_with("/pulls/7") {
            let body = body.unwrap();
            assert_eq!(body, json!({"state":"closed"}));
            self.writes.borrow_mut().push((path.into(), body));
            self.pull.borrow_mut().as_mut().unwrap()["state"] = json!("closed");
            if self.lose_pr_response.replace(false) {
                return Err(Error::Access);
            }
            return Ok(self.pull.borrow().clone().unwrap());
        }
        if method == "POST" {
            let body = body.unwrap();
            self.writes.borrow_mut().push((path.into(), body.clone()));
            if path.ends_with("/git/trees") {
                return Ok(json!({"sha":"b".repeat(40)}));
            }
            if path.ends_with("/git/commits") {
                return Ok(json!({"sha":"c".repeat(40)}));
            }
            if path.ends_with("/git/refs") {
                *self.branch.borrow_mut() = Some(body["ref"].as_str().unwrap().into());
                if self.lose_reference_response.replace(false) {
                    return Err(Error::Access);
                }
                return Ok(body);
            }
            if path.ends_with("/pulls") {
                *self.pull.borrow_mut() = Some(pr());
                if self.lose_pr_response.replace(false) {
                    return Err(Error::Access);
                }
                return Ok(pr());
            }
        }
        if path.contains("/git/matching-refs/") {
            return Ok(match self.branch.borrow().as_ref() {
                Some(branch) => json!([{"ref":branch,"object":{"sha":"c".repeat(40)}}]),
                None => json!([]),
            });
        }
        if path.contains("/git/commits/") {
            return Ok(
                json!({"tree":{"sha":if path.ends_with(&"c".repeat(40)) { "b".repeat(40) } else { "d".repeat(40) }}}),
            );
        }
        if path.contains("/pulls?") {
            return Ok(self
                .pull
                .borrow()
                .clone()
                .map(|item| json!([item]))
                .unwrap_or(json!([])));
        }
        if path.ends_with("/pulls/7") {
            return self.pull.borrow().clone().ok_or(Error::Missing);
        }
        if path.contains("/compare/") {
            return Ok(json!({"status":"ahead"}));
        }
        panic!("unexpected synthetic API route: {method} {path}");
    }
    fn raw(&self, path: &str) -> Result<Vec<u8>, Error> {
        if path.contains("/homelab.json?") {
            return Ok(serde_json::to_vec(&self.manifest).unwrap());
        }
        if path.contains("/.sops.yaml?") {
            return Ok(self.rules.as_bytes().to_vec());
        }
        if path.contains("/projects/homelab/secrets/test-mac.sops.yaml?") {
            return self
                .existing_secret
                .as_ref()
                .map(|s| s.as_bytes().to_vec())
                .ok_or(Error::Missing);
        }
        panic!("unexpected raw route: {path}");
    }
}
fn ciphertext() -> String {
    let encrypted = "ENC[AES256_GCM,data:ZmFrZQ==,iv:ZmFrZQ==,tag:ZmFrZQ==,type:str]";
    let envelope =
        "-----BEGIN AGE ENCRYPTED FILE-----\nZmFrZQ==\n-----END AGE ENCRYPTED FILE-----\n";
    json!({"tailscale-auth-key":encrypted,"sops":{"mac":encrypted,"version":"3.12.2","lastmodified":"2026-11-06T00:00:00Z",
        "age":[{"recipient":"age1host","enc":envelope},{"recipient":"age1recovery","enc":envelope}]}}).to_string()
}
fn changes(api: &GitHub) -> Result<configuration_pr::Changes, Error> {
    configuration_pr::prepare(
        api,
        &api.workspace(),
        "test-mac",
        "ssh-ed25519 AAAA chosen",
        &ciphertext(),
        "age1host",
        "age1recovery",
    )
}

#[test]
fn renewal_closes_only_its_exact_proposal_and_reconciles_a_lost_response() {
    let api = GitHub::new();
    let proposal = changes(&api).unwrap();
    let mut request = pr();
    request["head"] = json!({"ref":proposal.branch(),"repo":{"full_name":"example/config"}});
    *api.pull.borrow_mut() = Some(request.clone());
    api.lose_pr_response.set(true);
    assert!(
        configuration_pr::resolve_for_renewal(&api, &proposal)
            .unwrap()
            .is_none()
    );
    assert_eq!(api.writes.borrow().len(), 1);
    assert!(
        configuration_pr::resolve_for_renewal(&api, &proposal)
            .unwrap()
            .is_none()
    );
    assert_eq!(api.writes.borrow().len(), 1);

    request["head"]["repo"]["full_name"] = json!("another/repository");
    *api.pull.borrow_mut() = Some(request);
    assert!(matches!(
        configuration_pr::resolve_for_renewal(&api, &proposal),
        Err(Error::Conflict)
    ));
    assert_eq!(api.writes.borrow().len(), 1);
}

#[test]
fn renewal_requires_exact_previous_ciphertext_and_survives_saved_proposal() {
    use std::os::unix::fs::PermissionsExt;
    let mut api = GitHub::new();
    let previous = ciphertext();
    let renewed = previous.replace("2026-11-06", "2026-11-07");
    api.existing_secret = Some(previous.clone());
    let prepare = |api: &GitHub, expected: &str| {
        configuration_pr::prepare_renewal(
            api,
            &api.workspace(),
            "test-mac",
            "ssh-ed25519 AAAA chosen",
            configuration_pr::Encryption {
                ciphertext: &renewed,
                host_recipient: "age1host",
                recovery_recipient: "age1recovery",
            },
            expected,
        )
    };
    assert!(matches!(prepare(&api, &renewed), Err(Error::Conflict)));
    let proposal = prepare(&api, &previous).unwrap();
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = directory.path().join("proposal.json");
    proposal.save(&path).unwrap();
    let saved = configuration_pr::Changes::load(&path, "example/config", "test-mac").unwrap();
    configuration_pr::publish(&api, &saved).unwrap();
    assert!(!api.writes.borrow().is_empty());

    let mut changed = GitHub::new();
    changed.existing_secret = Some(previous.replace("2026-11-06", "2026-11-08"));
    assert!(matches!(
        configuration_pr::publish(&changed, &saved),
        Err(Error::Conflict)
    ));
    assert!(changed.writes.borrow().is_empty());
    changed.existing_secret = None;
    assert!(prepare(&changed, &previous).is_err());
}

#[test]
fn renewal_cannot_replace_unrelated_service_secrets() {
    let mut api = GitHub::new();
    let mut previous: Value = serde_json::from_str(&ciphertext()).unwrap();
    previous["database-password"] = previous["tailscale-auth-key"].clone();
    let previous = previous.to_string();
    api.existing_secret = Some(previous.clone());
    assert!(matches!(
        configuration_pr::prepare_renewal(
            &api,
            &api.workspace(),
            "test-mac",
            "ssh-ed25519 AAAA chosen",
            configuration_pr::Encryption {
                ciphertext: &ciphertext(),
                host_recipient: "age1host",
                recovery_recipient: "age1recovery",
            },
            &previous,
        ),
        Err(Error::Invalid)
    ));
    assert!(api.writes.borrow().is_empty());
}

#[test]
fn saved_proposal_survives_main_changes_and_rejects_rebinding_or_tampering() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = directory.path().join("proposal.json");
    let api = GitHub::new();
    let original = changes(&api).unwrap();
    original.save(&path).unwrap();
    original.save(&path).unwrap();
    let saved = configuration_pr::Changes::load(&path, "example/config", "test-mac").unwrap();
    assert_eq!(saved.branch(), original.branch());
    let mut newer = original.clone();
    newer.base = "e".repeat(40);
    assert_eq!(newer.save(&path), Err(Error::Conflict));
    assert!(matches!(
        configuration_pr::Changes::load(&path, "example/other", "test-mac"),
        Err(Error::Conflict)
    ));
    let mut corrupted: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    corrupted["files"]["projects/homelab/secrets/test-mac.sops.yaml"] = json!("plaintext-secret");
    std::fs::write(&path, serde_json::to_vec(&corrupted).unwrap()).unwrap();
    assert!(matches!(
        configuration_pr::Changes::load(&path, "example/config", "test-mac"),
        Err(Error::Invalid)
    ));
    let altered: configuration_pr::Changes = serde_json::from_value(corrupted).unwrap();
    assert!(matches!(
        configuration_pr::publish(&api, &altered),
        Err(Error::Invalid)
    ));
    assert!(api.writes.borrow().is_empty());
}

#[test]
fn saved_proposal_rejects_public_files_and_symlinks() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = directory.path().join("proposal.json");
    let proposal = changes(&GitHub::new()).unwrap();
    proposal.save(&path).unwrap();
    let alias = directory.path().join("alias.json");
    symlink(&path, &alias).unwrap();
    assert!(matches!(
        configuration_pr::Changes::load(&alias, "example/config", "test-mac"),
        Err(Error::State)
    ));
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(matches!(
        configuration_pr::Changes::load(&path, "example/config", "test-mac"),
        Err(Error::State)
    ));
}

#[test]
fn oversized_or_unrelated_saved_changes_cannot_be_published() {
    use std::os::unix::fs::PermissionsExt;
    let api = GitHub::new();
    let original = changes(&api).unwrap();
    let mut edited = serde_json::to_value(&original).unwrap();
    edited["manifest"]["hosts"]["other-mac"]["adminUser"] = json!("changed");
    edited["files"]["projects/homelab/homelab.json"] =
        json!(serde_json::to_string_pretty(&edited["manifest"]).unwrap() + "\n");
    let changed: configuration_pr::Changes = serde_json::from_value(edited).unwrap();
    assert!(matches!(
        configuration_pr::publish(&api, &changed),
        Err(Error::Conflict)
    ));
    assert!(api.writes.borrow().is_empty());

    let mut oversized = serde_json::to_value(original).unwrap();
    let mut rules = oversized["files"][".sops.yaml"]
        .as_str()
        .unwrap()
        .to_owned();
    rules.push_str(&format!("# {}\n", "x".repeat(65536)));
    oversized["files"][".sops.yaml"] = json!(rules);
    let oversized: configuration_pr::Changes = serde_json::from_value(oversized).unwrap();
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = directory.path().join("proposal.json");
    assert_eq!(oversized.save(&path), Err(Error::Invalid));
    assert!(!path.exists());
    assert!(matches!(
        configuration_pr::publish(&api, &oversized),
        Err(Error::Invalid)
    ));
    assert!(api.writes.borrow().is_empty());
}

#[test]
fn legacy_saved_proposal_keeps_its_original_bytes_and_branch_when_resumed() {
    use std::os::unix::fs::PermissionsExt;
    let api = GitHub::new();
    let mut encoded = serde_json::to_value(changes(&api).unwrap()).unwrap();
    let mut manifest = encoded["manifest"].clone();
    manifest["hosts"]["test-mac"]["activationReady"] = json!(true);
    manifest["hosts"]["other-mac"]["activationReady"] = json!(false);
    encoded["manifest"] = manifest.clone();
    let original_bytes = serde_json::to_string_pretty(&manifest).unwrap() + "\n";
    encoded["files"]["projects/homelab/homelab.json"] = json!(original_bytes);
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = directory.path().join("proposal.json");
    std::fs::write(&path, serde_json::to_vec(&encoded).unwrap()).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let saved = configuration_pr::Changes::load(&path, "example/config", "test-mac").unwrap();
    let branch = saved.branch();
    configuration_pr::publish(&api, &saved).unwrap();
    assert_eq!(saved.branch(), branch);
    assert_eq!(
        serde_json::to_value(&saved).unwrap()["files"]["projects/homelab/homelab.json"],
        original_bytes
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        serde_json::to_vec(&encoded).unwrap()
    );
}

#[test]
fn publishes_only_three_allowed_files_and_preserves_other_hosts_and_rules() {
    let api = GitHub::new();
    let change = changes(&api).unwrap();
    assert_eq!(
        change.manifest.hosts["other-mac"],
        api.manifest.hosts["other-mac"]
    );
    assert!(
        !serde_json::to_value(&change.manifest).unwrap()["hosts"]["test-mac"]
            .as_object()
            .unwrap()
            .contains_key("activationReady")
    );
    assert_eq!(
        change.manifest.hosts["test-mac"].authorized_keys,
        ["ssh-ed25519 AAAA"]
    );
    assert_eq!(configuration_pr::publish(&api, &change).unwrap().number, 7);
    let writes = api.writes.borrow();
    let tree = &writes
        .iter()
        .find(|(path, _)| path.ends_with("/git/trees"))
        .unwrap()
        .1["tree"];
    assert_eq!(tree.as_array().unwrap().len(), 3);
    let rules = tree
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["path"] == ".sops.yaml")
        .unwrap()["content"]
        .as_str()
        .unwrap();
    let rules: Value = serde_yaml_ng::from_str(rules).unwrap();
    assert_eq!(rules["creation_rules"][0]["age"], "age1host,age1recovery");
    assert_eq!(rules["creation_rules"][1]["path_regex"], "^other/");
    assert!(
        !serde_json::to_string(&*writes)
            .unwrap()
            .contains("AGE-SECRET-KEY")
    );
}

#[test]
fn unknown_branch_or_pr_creation_is_reconciled_without_duplicate_publication() {
    for lost_pr in [false, true] {
        let api = GitHub::new();
        if lost_pr {
            api.lose_pr_response.set(true);
        } else {
            api.lose_reference_response.set(true);
        }
        let change = changes(&api).unwrap();
        assert_eq!(
            configuration_pr::publish(&api, &change).unwrap_err(),
            Error::Unconfirmed
        );
        assert_eq!(configuration_pr::publish(&api, &change).unwrap().number, 7);
        for endpoint in ["/git/refs", "/pulls"] {
            assert_eq!(
                api.writes
                    .borrow()
                    .iter()
                    .filter(|(path, _)| path.ends_with(endpoint))
                    .count(),
                1
            );
        }
    }
}

#[test]
fn existing_service_secrets_and_plaintext_are_rejected_before_writes() {
    let mut api = GitHub::new();
    api.existing_secret = Some("existing service ciphertext".into());
    assert!(matches!(changes(&api), Err(Error::Conflict)));
    api.existing_secret = None;
    let plaintext = ciphertext().replace("ENC[AES256_GCM,", "plaintext");
    assert!(matches!(
        configuration_pr::prepare(
            &api,
            &api.workspace(),
            "test-mac",
            "ssh-ed25519 AAAA",
            &plaintext,
            "age1host",
            "age1recovery"
        ),
        Err(Error::Invalid)
    ));
    assert!(api.writes.borrow().is_empty());
    let mut metadata: Value = serde_json::from_str(&ciphertext()).unwrap();
    metadata["sops"]["extra"] = json!("AGE-SECRET-KEY-not-for-git");
    assert!(matches!(
        configuration_pr::prepare(
            &api,
            &api.workspace(),
            "test-mac",
            "ssh-ed25519 AAAA",
            &metadata.to_string(),
            "age1host",
            "age1recovery"
        ),
        Err(Error::Invalid)
    ));
    metadata["sops"].as_object_mut().unwrap().remove("extra");
    metadata["sops"]["age"][0]["extra"] = json!("plaintext");
    assert!(matches!(
        configuration_pr::prepare(
            &api,
            &api.workspace(),
            "test-mac",
            "ssh-ed25519 AAAA",
            &metadata.to_string(),
            "age1host",
            "age1recovery"
        ),
        Err(Error::Invalid)
    ));
}

#[test]
fn merge_verification_rejects_altered_host_settings_or_wrong_base() {
    let mut api = GitHub::new();
    api.manifest.schema = 2;
    api.manifest.one_password = Some(homelab_client::config::OnePasswordConfig {
        backup_vault: "reviewed-backup-vault".into(),
    });
    let change = changes(&api).unwrap();
    let mut merged = pr();
    merged["state"] = json!("closed");
    merged["merged_at"] = json!("2026-11-06T00:00:00Z");
    merged["merge_commit_sha"] = json!("e".repeat(40));
    merged["head"] = json!({"ref":change.branch(),"repo":{"full_name":"example/config"}});
    *api.pull.borrow_mut() = Some(merged.clone());
    assert!(matches!(
        configuration_pr::approved_workspace(&api, &change, 7),
        Err(Error::Conflict)
    ));
    api.manifest = change.manifest.clone();
    api.existing_secret = Some(ciphertext());
    api.rules = "creation_rules:\n  - path_regex: '^projects/homelab/secrets/test-mac\\.sops\\.yaml$'\n    age: 'age1host,age1recovery'\n".into();
    assert_eq!(
        configuration_pr::approved_workspace(&api, &change, 7)
            .unwrap()
            .unwrap()
            .revision,
        "e".repeat(40)
    );
    // A merged PR's auto-deleted branch must stay deleted on resume.
    assert!(api.branch.borrow().is_none());
    assert_eq!(configuration_pr::publish(&api, &change).unwrap().number, 7);
    assert!(api.writes.borrow().is_empty());
    assert!(api.branch.borrow().is_none());
    api.manifest.tailscale = Some(homelab_client::config::TailscaleConfig {
        tag: "tag:changed-after-issuance".into(),
        oauth: None,
    });
    assert!(matches!(
        configuration_pr::approved_workspace(&api, &change, 7),
        Err(Error::Conflict)
    ));
    api.manifest.tailscale = change.manifest.tailscale.clone();
    api.manifest.one_password = Some(homelab_client::config::OnePasswordConfig {
        backup_vault: "another-backup-destination".into(),
    });
    assert!(matches!(
        configuration_pr::approved_workspace(&api, &change, 7),
        Err(Error::Conflict)
    ));
    api.manifest.one_password = change.manifest.one_password.clone();
    api.manifest.schema = 1;
    assert!(matches!(
        configuration_pr::approved_workspace(&api, &change, 7),
        Err(Error::Conflict)
    ));
    api.manifest = change.manifest.clone();
    merged["base"]["ref"] = json!("other");
    *api.pull.borrow_mut() = Some(merged);
    assert_eq!(
        configuration_pr::merged_revision(&api, "example/config", 7),
        Err(Error::Conflict)
    );
}

struct DirectGitHub {
    base: GitHub,
    current: Manifest,
    rules: String,
    protected: bool,
    active_rules: Value,
    classic: Option<Value>,
    candidate_files: RefCell<std::collections::BTreeMap<String, String>>,
    published: Cell<bool>,
    patch_count: Cell<usize>,
    lose_response: Cell<bool>,
    reject_patch: Cell<bool>,
    advance_during_write: Cell<bool>,
    main: RefCell<String>,
}

impl DirectGitHub {
    fn new() -> Self {
        let base = GitHub::new();
        Self {
            current: base.manifest.clone(),
            rules: base.rules.clone(),
            base,
            protected: false,
            active_rules: json!([]),
            classic: None,
            candidate_files: RefCell::new(Default::default()),
            published: Cell::new(false),
            patch_count: Cell::new(0),
            lose_response: Cell::new(false),
            reject_patch: Cell::new(false),
            advance_during_write: Cell::new(false),
            main: RefCell::new("e".repeat(40)),
        }
    }
}

impl Api for DirectGitHub {
    fn json(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, Error> {
        if path.ends_with("/branches/main") {
            return Ok(json!({"protected":self.protected,"commit":{"sha":*self.main.borrow()}}));
        }
        if path.contains("/rules/branches/main?") {
            assert!(
                self.protected,
                "unprotected free-plan repos need no rules API"
            );
            return Ok(self.active_rules.clone());
        }
        if path.ends_with("/branches/main/protection") {
            return self.classic.clone().ok_or(Error::Missing);
        }
        if path.contains("/compare/") {
            return Ok(json!({"status":if self.published.get() {"ahead"} else {"behind"}}));
        }
        if method == "POST" && path.ends_with("/git/trees") {
            let body = body.as_ref().unwrap();
            *self.candidate_files.borrow_mut() = body["tree"]
                .as_array()
                .unwrap()
                .iter()
                .map(|entry| {
                    (
                        entry["path"].as_str().unwrap().to_owned(),
                        entry["content"].as_str().unwrap().to_owned(),
                    )
                })
                .collect();
        }
        if method == "PATCH" && path.ends_with("/git/refs/heads/main") {
            assert_eq!(body.unwrap(), json!({"sha":"c".repeat(40),"force":false}));
            self.patch_count.set(self.patch_count.get() + 1);
            if self.advance_during_write.get() {
                *self.main.borrow_mut() = "f".repeat(40);
                return Err(Error::Access);
            }
            if self.reject_patch.get() {
                return Err(Error::Access);
            }
            self.published.set(true);
            *self.main.borrow_mut() = "c".repeat(40);
            return if self.lose_response.replace(false) {
                Err(Error::Access)
            } else {
                Ok(json!({"object":{"sha":"c".repeat(40)}}))
            };
        }
        self.base.json(method, path, body)
    }

    fn raw(&self, path: &str) -> Result<Vec<u8>, Error> {
        if path.ends_with(&format!("?ref={}", "c".repeat(40))) {
            let file = path
                .split("/contents/")
                .nth(1)
                .unwrap()
                .split('?')
                .next()
                .unwrap();
            return self
                .candidate_files
                .borrow()
                .get(file)
                .map(|text| text.as_bytes().to_vec())
                .ok_or(Error::Missing);
        }
        if path.ends_with(&format!("?ref={}", "e".repeat(40))) {
            if path.contains("/homelab.json?") {
                return Ok(serde_json::to_vec(&self.current).unwrap());
            }
            if path.contains("/.sops.yaml?") {
                return Ok(self.rules.as_bytes().to_vec());
            }
        }
        self.base.raw(path)
    }
}

fn receipt_directory() -> tempfile::TempDir {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    directory
}

#[test]
fn direct_publication_rebases_unrelated_changes_and_reconciles_lost_response() {
    let mut api = DirectGitHub::new();
    let proposal = changes(&api.base).unwrap();
    api.current.hosts.get_mut("other-mac").unwrap().admin_uid = 503;
    api.rules
        .push_str("  - path_regex: '^new-other/'\n    age: 'age1other'\n");
    api.lose_response.set(true);
    let directory = receipt_directory();
    let receipt = directory.path().join("publication.json");
    for _ in 0..2 {
        let configuration_pr::Publication::Published {
            workspace,
            html_url,
        } = configuration_pr::publish_configuration(&api, &proposal, &receipt).unwrap()
        else {
            panic!("unexpected PR");
        };
        assert_eq!(workspace.revision, "c".repeat(40));
        assert_eq!(workspace.manifest.hosts["other-mac"].admin_uid, 503);
        assert!(html_url.ends_with(&"c".repeat(40)));
    }
    assert_eq!(api.patch_count.get(), 1);
    assert!(api.candidate_files.borrow()[".sops.yaml"].contains("new-other"));
    assert!(
        configuration_pr::resolve_publication_for_renewal(&api, &proposal, &receipt)
            .unwrap()
            .is_some()
    );
}

#[test]
fn direct_publication_respects_rules_and_existing_prs_without_main_write() {
    for classic in [false, true] {
        let mut api = DirectGitHub::new();
        api.protected = true;
        if classic {
            api.classic = Some(json!({"required_pull_request_reviews":{}}));
        } else {
            api.active_rules = json!([{"type":"pull_request"}]);
        }
        let proposal = changes(&api.base).unwrap();
        let directory = receipt_directory();
        assert!(matches!(
            configuration_pr::publish_configuration(
                &api,
                &proposal,
                &directory.path().join("publication.json")
            )
            .unwrap(),
            configuration_pr::Publication::PullRequest(_)
        ));
        assert_eq!(api.patch_count.get(), 0);
    }
    let api = DirectGitHub::new();
    *api.base.pull.borrow_mut() = Some(pr());
    let proposal = changes(&api.base).unwrap();
    let directory = receipt_directory();
    assert!(matches!(
        configuration_pr::publish_configuration(
            &api,
            &proposal,
            &directory.path().join("publication.json")
        )
        .unwrap(),
        configuration_pr::Publication::PullRequest(_)
    ));
    assert!(api.base.writes.borrow().is_empty());
}

#[test]
fn conflicting_host_or_unhandled_rule_never_writes_main() {
    let mut api = DirectGitHub::new();
    let proposal = changes(&api.base).unwrap();
    let directory = receipt_directory();
    api.current.hosts.get_mut("test-mac").unwrap().admin_user = "changed".into();
    assert!(matches!(
        configuration_pr::publish_configuration(
            &api,
            &proposal,
            &directory.path().join("publication.json")
        ),
        Err(Error::Conflict)
    ));
    assert!(api.base.writes.borrow().is_empty());
    api.current = api.base.manifest.clone();
    api.protected = true;
    api.active_rules = json!([{"type":"required_signatures"}]);
    assert!(matches!(
        configuration_pr::publish_configuration(
            &api,
            &proposal,
            &directory.path().join("publication.json")
        ),
        Err(Error::Rules)
    ));
    assert!(api.base.writes.borrow().is_empty());
}

#[test]
fn uncertain_write_does_not_create_pr_or_retire_and_concurrent_main_is_not_overwritten() {
    let api = DirectGitHub::new();
    let proposal = changes(&api.base).unwrap();
    let directory = receipt_directory();
    let receipt = directory.path().join("publication.json");
    api.reject_patch.set(true);
    assert!(matches!(
        configuration_pr::publish_configuration(&api, &proposal, &receipt),
        Err(Error::Unconfirmed)
    ));
    assert!(matches!(
        configuration_pr::resolve_publication_for_renewal(&api, &proposal, &receipt),
        Err(Error::Unconfirmed)
    ));
    assert!(api.base.pull.borrow().is_none());
    api.reject_patch.set(false);
    api.advance_during_write.set(true);
    assert!(matches!(
        configuration_pr::publish_configuration(&api, &proposal, &receipt),
        Err(Error::Unconfirmed)
    ));
    let writes = api.patch_count.get();
    assert!(matches!(
        configuration_pr::publish_configuration(&api, &proposal, &receipt),
        Err(Error::Conflict)
    ));
    assert_eq!(api.patch_count.get(), writes);
}

#[test]
fn changed_host_rule_and_unsafe_receipt_are_refused_without_writes() {
    use std::os::unix::fs::symlink;
    let mut api = DirectGitHub::new();
    let proposal = changes(&api.base).unwrap();
    let directory = receipt_directory();
    let receipt = directory.path().join("publication.json");
    api.rules
        .push_str("  - path_regex: '^projects/homelab/secrets/test-mac\\.sops\\.yaml$'\n    age: 'age1other'\n");
    assert!(matches!(
        configuration_pr::publish_configuration(&api, &proposal, &receipt),
        Err(Error::Conflict)
    ));
    assert!(api.base.writes.borrow().is_empty());
    api.rules = api.base.rules.clone();
    let sentinel = directory.path().join("sentinel");
    std::fs::write(&sentinel, "preserve").unwrap();
    symlink(&sentinel, &receipt).unwrap();
    assert!(matches!(
        configuration_pr::publish_configuration(&api, &proposal, &receipt),
        Err(Error::State)
    ));
    assert_eq!(std::fs::read_to_string(sentinel).unwrap(), "preserve");
    assert!(api.base.writes.borrow().is_empty());
}

#[test]
fn known_protected_branch_without_explainable_rules_fails_closed() {
    let mut api = DirectGitHub::new();
    api.protected = true;
    let proposal = changes(&api.base).unwrap();
    let directory = receipt_directory();
    assert!(matches!(
        configuration_pr::publish_configuration(
            &api,
            &proposal,
            &directory.path().join("publication.json")
        ),
        Err(Error::Rules)
    ));
    assert!(api.base.writes.borrow().is_empty());
}
