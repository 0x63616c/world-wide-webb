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
        if path.contains("/secrets/test-mac.sops.yaml?") {
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
    corrupted["files"]["secrets/test-mac.sops.yaml"] = json!("plaintext-secret");
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
    edited["files"]["homelab.json"] =
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
fn publishes_only_three_allowed_files_and_preserves_other_hosts_and_rules() {
    let api = GitHub::new();
    let change = changes(&api).unwrap();
    assert_eq!(
        change.manifest.hosts["other-mac"],
        api.manifest.hosts["other-mac"]
    );
    assert!(change.manifest.hosts["test-mac"].activation_ready);
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
    api.rules = "creation_rules:\n  - path_regex: '^secrets/test-mac\\.sops\\.yaml$'\n    age: 'age1host,age1recovery'\n".into();
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
