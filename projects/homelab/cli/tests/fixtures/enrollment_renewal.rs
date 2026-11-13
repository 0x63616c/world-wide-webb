//! Real encryption/state transitions against an in-memory, revision-aware GitHub.
use super::*;
use crate::configuration_pr::{self, Api, Changes};
use crate::provisioning::BaseTokens;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fs;

const REPOSITORY: &str = "example/config";
const HOST: &str = "test-mac";
const PUBLIC_KEY: &str = "ssh-ed25519 AAAA chosen";

struct MergedRepository {
    current: Workspace,
    files: BTreeMap<String, BTreeMap<String, String>>,
    pulls: Vec<Value>,
}

struct ArchivedPreparation {
    directory: std::path::PathBuf,
    ciphertext: Vec<u8>,
    evidence: BTreeMap<&'static str, Vec<u8>>,
}

impl MergedRepository {
    fn new() -> Self {
        let manifest = serde_json::from_value(json!({"schema":1,"hosts":{
            HOST:{"adminUser":"admin","adminUID":501,"authorizedKeys":[],
                  "activationReady":false,"services":[]}
        }}))
        .unwrap();
        let current = Workspace {
            repository: REPOSITORY.into(),
            revision: "a".repeat(40),
            manifest,
        };
        let files = BTreeMap::from([(
            current.revision.clone(),
            BTreeMap::from([
                (
                    "projects/homelab/homelab.json".into(),
                    serde_json::to_string(&current.manifest).unwrap(),
                ),
                (".sops.yaml".into(), "creation_rules: []\n".into()),
            ]),
        )]);
        Self {
            current,
            files,
            pulls: vec![],
        }
    }

    fn merge(&mut self, proposal: &Changes, revision: String) -> u64 {
        assert_eq!(
            proposal.base, self.current.revision,
            "renewal must use current main"
        );
        let number = self.pulls.len() as u64 + 1;
        let serialized = serde_json::to_value(proposal).unwrap();
        self.files.insert(
            revision.clone(),
            serde_json::from_value(serialized["files"].clone()).unwrap(),
        );
        self.current = Workspace {
            repository: REPOSITORY.into(),
            revision: revision.clone(),
            manifest: proposal.manifest.clone(),
        };
        self.pulls.push(json!({
            "number":number,"html_url":format!("https://github.com/{REPOSITORY}/pull/{number}"),
            "state":"closed","merged_at":"2026-11-06T00:00:00Z","merge_commit_sha":revision,
            "head":{"ref":proposal.branch(),"repo":{"full_name":REPOSITORY}},
            "base":{"ref":"main","repo":{"full_name":REPOSITORY}}
        }));
        number
    }
}

impl Api for MergedRepository {
    fn json(
        &self,
        method: &str,
        path: &str,
        _: Option<Value>,
    ) -> Result<Value, configuration_pr::Error> {
        assert_eq!(
            method, "GET",
            "reconciling merged proposals must not mutate them"
        );
        if path.contains("/compare/") {
            return Ok(json!({"status":"ahead"}));
        }
        if let Some(query) = path.split("/pulls?").nth(1) {
            let branch = query
                .split("head=example:")
                .nth(1)
                .unwrap()
                .split('&')
                .next()
                .unwrap();
            return Ok(Value::Array(
                self.pulls
                    .iter()
                    .filter(|pull| pull["head"]["ref"] == branch)
                    .cloned()
                    .collect(),
            ));
        }
        if let Some(number) = path.split("/pulls/").nth(1) {
            return Ok(self.pulls[number.parse::<usize>().unwrap() - 1].clone());
        }
        panic!("unexpected synthetic GitHub request: {path}");
    }

    fn raw(&self, path: &str) -> Result<Vec<u8>, configuration_pr::Error> {
        let (file, revision) = path
            .split("/contents/")
            .nth(1)
            .unwrap()
            .split_once("?ref=")
            .unwrap();
        self.files
            .get(revision)
            .and_then(|files| files.get(file))
            .map(|value| value.as_bytes().to_vec())
            .ok_or(configuration_pr::Error::Missing)
    }
}

#[test]
fn two_merged_expirations_preserve_receipts_and_create_distinct_renewals() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("state");
    let tools = Tools::discover().unwrap();
    let mut repository = MergedRepository::new();
    let mut branches = vec![];
    let mut archives: Vec<ArchivedPreparation> = vec![];
    let mut original_recipients = None;

    for generation in 0..3 {
        let mut session = Session::open(HOST, REPOSITORY, &root, &tools).unwrap();
        let key_id = format!("synthetic-issued-{generation}");
        session.record_issuance(&key_id, 2000).unwrap();
        let details = session
            .encrypt(BaseTokens {
                tailscale_auth: format!("synthetic-enrollment-secret-{generation}"),
            })
            .unwrap();
        session.record_enrollment(&key_id, 2000).unwrap();
        let recipients = (
            details.host_recipient.clone(),
            details.recovery_recipient.clone(),
        );
        assert_eq!(
            original_recipients.get_or_insert(recipients.clone()),
            &recipients
        );
        for archive in &archives {
            assert!(
                session
                    .matches_retired_ciphertext(&archive.ciphertext)
                    .unwrap()
            );
        }
        drop(session);

        let proposal = proposal(&root, HOST, &repository.current, PUBLIC_KEY, &repository).unwrap();
        assert_eq!(proposal.base, repository.current.revision);
        assert!(
            !branches.contains(&proposal.branch()),
            "never reuse a merged enrollment branch"
        );
        branches.push(proposal.branch());
        let proposal_path = root.join("hosts").join(HOST).join("proposal.json");
        proposal.save(&proposal_path).unwrap();
        let number = repository.merge(
            &proposal,
            char::from(b'b' + generation).to_string().repeat(40),
        );
        let approved = configuration_pr::approved_workspace(&repository, &proposal, number)
            .unwrap()
            .unwrap();
        assert_eq!(approved.revision, repository.current.revision);
        assert_eq!(
            configuration_pr::publish(&repository, &proposal)
                .unwrap()
                .number,
            number
        );

        let session = Session::open(HOST, REPOSITORY, &root, &tools).unwrap();
        if generation == 2 {
            assert!(session.enrollment_valid_for(1000, 60).unwrap());
            break;
        }
        // Preserve both kinds of historical recovery receipt, including an
        // unconfirmed revocation; retirement must never rewrite that evidence.
        session
            .record_revocation(&key_id, 2000, generation == 0)
            .unwrap();
        let directory = root.join("hosts").join(HOST);
        let evidence: BTreeMap<_, _> = [
            "issuance.json",
            "revocation.json",
            "enrollment.json",
            "proposal.json",
        ]
        .into_iter()
        .map(|name| (name, fs::read(directory.join(name)).unwrap()))
        .collect();
        let ciphertext = fs::read(&details.ciphertext_path).unwrap();
        assert!(
            retire_expired(session, false, false, 2001, || {
                let merged =
                    configuration_pr::resolve_for_renewal(&repository, &proposal)?.unwrap();
                assert_eq!(merged.revision, repository.current.revision);
                Ok(())
            })
            .unwrap()
            .is_none()
        );
        assert!(
            !proposal_path.exists(),
            "the next attempt must not load the old merged proposal"
        );
        let archived = fs::read_dir(root.join("retired").join(HOST))
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .find(|path| fs::read(path.join("issuance.json")).unwrap() == evidence["issuance.json"])
            .unwrap();
        archives.push(ArchivedPreparation {
            directory: archived,
            ciphertext,
            evidence,
        });
    }

    assert_eq!(archives.len(), 2);
    for archive in archives {
        for (name, bytes) in archive.evidence {
            assert_eq!(fs::read(archive.directory.join(name)).unwrap(), bytes);
        }
        assert_eq!(
            fs::read(archive.directory.join("review/test-mac.sops.yaml")).unwrap(),
            archive.ciphertext
        );
    }
}
