//! Cooperative deployment fencing; historical setup records keep their original path.
use crate::config::Workspace;
use crate::configuration_pr::Api;
use serde::{Deserialize, Serialize};
use serde_json::json;
use thiserror::Error;

const CONTROL: &str = "control/homelab";
const INTERVAL: u64 = 7200;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Waiting for the exact approved revision to pass checks and reach deploy/homelab.")]
    NotPromoted,
    #[error("Setup stopped; saved progress is retained.")]
    Cancelled,
    #[error(
        "A newer host revision is already deployed. Preserve this attempt and revalidate before installation."
    )]
    Superseded,
    #[error("Another enrollment owns deployment promotion. Resume that attempt first.")]
    Busy,
    #[error(
        "The deployment hold expired. Verify the same host and source before explicit recovery."
    )]
    Expired,
    #[error(
        "The deployment journal could not be confirmed. Preserve this attempt and retry; no installation is authorized."
    )]
    Unconfirmed,
    #[error("Deployment hold identity or verification does not match this setup.")]
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Intent {
    source: String,
    run_id: u64,
    attempt: u64,
    inputs: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Prepared,
    Activating,
    Expired,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Lease {
    id: String,
    host: String,
    source: String,
    expires: u64,
    phase: Phase,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct State {
    schema: u8,
    deployed: Option<String>,
    receipt: Option<Intent>,
    lease: Option<Lease>,
    pending: Option<Intent>,
}
fn token(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_state(value: serde_json::Value) -> Result<State, Error> {
    if value.as_object().is_none_or(|v| v.len() != 5) {
        return Err(Error::Invalid);
    }
    let state: State = serde_json::from_value(value).map_err(|_| Error::Invalid)?;
    if state.schema != 1
        || state
            .deployed
            .as_deref()
            .is_some_and(|s| !crate::config::valid_revision(s))
        || state.receipt.as_ref().map(|r| &r.source) != state.deployed.as_ref()
        || [&state.receipt, &state.pending]
            .into_iter()
            .flatten()
            .any(|r| {
                !crate::config::valid_revision(&r.source)
                    || !token(&r.inputs)
                    || r.run_id == 0
                    || r.attempt == 0
            })
        || state.lease.as_ref().is_some_and(|l| {
            !token(&l.id)
                || !crate::config::valid_host(&l.host)
                || Some(&l.source) != state.deployed.as_ref()
        })
    {
        return Err(Error::Invalid);
    }
    Ok(state)
}
fn identity(api: &impl Api, path: &str) -> Result<String, Error> {
    let value = api
        .json("GET", path, None)
        .map_err(|_| Error::Unconfirmed)?;
    let sha = value
        .pointer("/object/sha")
        .and_then(|v| v.as_str())
        .ok_or(Error::Unconfirmed)?;
    crate::config::valid_revision(sha)
        .then(|| sha.into())
        .ok_or(Error::Invalid)
}
fn read(api: &impl Api, repository: &str) -> Result<(String, State), Error> {
    let root = format!("repos/{repository}");
    let head = identity(api, &format!("{root}/git/ref/heads/{CONTROL}"))?;
    let bytes = api
        .raw(&format!("{root}/contents/state.json?ref={head}"))
        .map_err(|_| Error::Unconfirmed)?;
    if bytes.len() > 65536 {
        return Err(Error::Invalid);
    }
    let state = valid_state(serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?)?;
    let deployed = identity(api, &format!("{root}/git/ref/heads/deploy/homelab"))?;
    if state.deployed.as_deref() != Some(deployed.as_str()) {
        return Err(Error::Unconfirmed);
    }
    Ok((head, state))
}

#[derive(Clone, Copy)]
enum Action {
    Acquire,
    Activate,
    Renew,
    Release,
    RecoverRelease,
    RecoverResume,
    CancelPrepared,
}

/// Returns false for historical manifests without contacting a provider.
/// Release is private to the verified-report entrypoint below.
fn transition(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
    action: Action,
    now: u64,
) -> Result<bool, Error> {
    workspace.manifest.validate().map_err(|_| Error::Invalid)?;
    let Some(policy) = &workspace.manifest.deployment else {
        return Ok(false);
    };
    if policy.repository != workspace.repository
        || !token(id)
        || !crate::config::valid_revision(&workspace.revision)
        || !workspace.manifest.hosts.contains_key(host)
    {
        return Err(Error::Invalid);
    }
    let (head, before) = read(api, &workspace.repository)?;
    if before.deployed.as_deref() != Some(workspace.revision.as_str()) {
        let deployed = before.deployed.as_ref().ok_or(Error::NotPromoted)?;
        let comparison = api
            .json(
                "GET",
                &format!(
                    "repos/{}/compare/{}...{deployed}",
                    workspace.repository, workspace.revision
                ),
                None,
            )
            .map_err(|_| Error::Unconfirmed)?;
        return Err(match comparison.get("status").and_then(|v| v.as_str()) {
            Some("ahead") => Error::Superseded,
            Some("behind") => Error::NotPromoted,
            _ => Error::Invalid,
        });
    }
    let mut after = before.clone();
    if let Some(lease) = &before.lease {
        if lease.id != id || lease.host != host || lease.source != workspace.revision {
            return Err(Error::Busy);
        }
        if (lease.expires <= now || lease.phase == Phase::Expired)
            && !matches!(
                action,
                Action::RecoverRelease | Action::RecoverResume | Action::CancelPrepared
            )
        {
            return Err(Error::Expired);
        }
    }
    match action {
        Action::Acquire if after.lease.is_some() => return Ok(true),
        Action::Acquire => {
            after.lease = Some(Lease {
                id: id.into(),
                host: host.into(),
                source: workspace.revision.clone(),
                expires: now.checked_add(INTERVAL).ok_or(Error::Invalid)?,
                phase: Phase::Prepared,
            })
        }
        Action::Activate | Action::Renew | Action::RecoverResume => {
            let lease = after.lease.as_mut().ok_or(Error::Invalid)?;
            lease.expires = now.checked_add(INTERVAL).ok_or(Error::Invalid)?;
            if matches!(action, Action::Activate | Action::RecoverResume) {
                lease.phase = Phase::Activating;
            }
        }
        Action::CancelPrepared => {
            if after
                .lease
                .as_ref()
                .is_some_and(|l| l.phase != Phase::Prepared)
            {
                return Err(Error::Busy);
            }
            after.lease = None;
        }
        Action::Release | Action::RecoverRelease => {
            after.lease = None;
        }
    }
    if before == after {
        return Ok(true);
    }
    let root = format!("repos/{}", workspace.repository);
    let content = serde_json::to_string(&after).map_err(|_| Error::Invalid)?;
    let tree = api.json("POST", &format!("{root}/git/trees"), Some(json!({"tree":[{"path":"state.json","mode":"100644","type":"blob","content":content}]}))).map_err(|_| Error::Unconfirmed)?;
    let tree = tree
        .get("sha")
        .and_then(|v| v.as_str())
        .filter(|s| crate::config::valid_revision(s))
        .ok_or(Error::Unconfirmed)?;
    let commit = api
        .json(
            "POST",
            &format!("{root}/git/commits"),
            Some(
                json!({"message": match action {
            Action::RecoverResume => "Recover enrollment deployment hold after target inspection",
            Action::RecoverRelease => "Release expired deployment hold after exact-source verification",
            _ => "Record enrollment deployment hold",
        },"tree":tree,"parents":[head]}),
            ),
        )
        .map_err(|_| Error::Unconfirmed)?;
    let commit = commit
        .get("sha")
        .and_then(|v| v.as_str())
        .filter(|s| crate::config::valid_revision(s))
        .ok_or(Error::Unconfirmed)?;
    // A sibling based on a stale head is not a fast-forward. This makes the API
    // update a CAS against cooperative atomic promoters without force permission.
    let _response = api.json(
        "PATCH",
        &format!("{root}/git/refs/heads/{CONTROL}"),
        Some(json!({"sha":commit,"force":false})),
    );
    let (observed, state) = read(api, &workspace.repository)?;
    let releasing = matches!(
        action,
        Action::Release | Action::RecoverRelease | Action::CancelPrepared
    );
    if !releasing && (state.lease != after.lease || state.deployed != after.deployed) {
        return Err(Error::Unconfirmed);
    }
    if observed == commit && state != after {
        return Err(Error::Unconfirmed);
    }
    if observed != commit {
        let comparison = api
            .json(
                "GET",
                &format!("{root}/compare/{commit}...{observed}"),
                None,
            )
            .map_err(|_| Error::Unconfirmed)?;
        if comparison.get("status").and_then(|v| v.as_str()) != Some("ahead") {
            return Err(Error::Unconfirmed);
        }
    }
    Ok(true)
}
fn now() -> Result<u64, Error> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .map_err(|_| Error::Invalid)
}
pub fn acquire(api: &impl Api, workspace: &Workspace, host: &str, id: &str) -> Result<bool, Error> {
    transition(api, workspace, host, id, Action::Acquire, now()?)
}
pub fn activate(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
) -> Result<bool, Error> {
    transition(api, workspace, host, id, Action::Activate, now()?)
}
pub fn renew(api: &impl Api, workspace: &Workspace, host: &str, id: &str) -> Result<bool, Error> {
    transition(api, workspace, host, id, Action::Renew, now()?)
}
/// Called only with a fresh, pinned-SSH response for this same target reservation.
pub fn recover_resume(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
    proof: &crate::deploy_identity::PreparedIdentity,
) -> Result<bool, Error> {
    let expected = std::path::PathBuf::from(crate::deploy_identity::repository_directory(
        &workspace.repository,
    ))
    .join("key.txt");
    if proof.activated_revision.is_some() || !proof.path.ends_with(expected) {
        return Err(Error::Invalid);
    }
    transition(api, workspace, host, id, Action::RecoverResume, now()?)
}

pub fn release_verified(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
    report: &crate::bootstrap_privileged::VerifiedSetup,
) -> Result<bool, Error> {
    workspace.manifest.validate().map_err(|_| Error::Invalid)?;
    if workspace.manifest.deployment.is_none() {
        return Ok(false);
    }
    if !report.completed
        || report.reconciled_revision.as_deref() != Some(workspace.revision.as_str())
        || crate::config::setup_binding(&workspace.repository, host, &workspace.revision).as_deref()
            != Some(report.binding.as_str())
    {
        return Err(Error::Invalid);
    }
    let now = now()?;
    let released = match transition(api, workspace, host, id, Action::Release, now) {
        Err(Error::Expired) => transition(api, workspace, host, id, Action::RecoverRelease, now),
        result => result,
    }?;
    if released {
        // This only requests fresh CI reconciliation; the dispatcher cannot
        // promote unchecked source. A transient error leaves scheduled recovery.
        if let Ok((_, state)) = read(api, &workspace.repository)
            && let Some(pending) = state.pending
        {
            let _ = api.json("POST", &format!("repos/{}/actions/workflows/homelab-delivery.yml/dispatches", workspace.repository),
                Some(json!({"ref":"main", "inputs": {"source": pending.source, "run_id": pending.run_id.to_string(), "attempt": pending.attempt.to_string(), "reconcile":true}})));
        }
    }
    Ok(released)
}

pub fn cancel_prepared(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
) -> Result<bool, Error> {
    transition(api, workspace, host, id, Action::CancelPrepared, now()?)
}

pub fn recover_verification(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    id: &str,
    proof: &crate::deploy_identity::PreparedIdentity,
) -> Result<bool, Error> {
    let expected = std::path::PathBuf::from(crate::deploy_identity::repository_directory(
        &workspace.repository,
    ))
    .join("key.txt");
    if proof.activated_revision.as_deref() != Some(workspace.revision.as_str())
        || !proof.path.ends_with(expected)
    {
        return Err(Error::Invalid);
    }
    transition(api, workspace, host, id, Action::RecoverResume, now()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::configuration_pr::Error as ApiError;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    struct Fake {
        head: RefCell<String>,
        states: RefCell<BTreeMap<String, State>>,
        tree: RefCell<Option<State>>,
        parent: RefCell<String>,
        commits: Cell<u64>,
        posts: Cell<u64>,
        lost_response: Cell<bool>,
        stale: Cell<bool>,
        comparison: RefCell<String>,
        dispatched: RefCell<Option<serde_json::Value>>,
        after_patch: RefCell<Option<State>>,
    }
    impl Fake {
        fn new() -> Self {
            let source = "a".repeat(40);
            let state = State {
                schema: 1,
                deployed: Some(source.clone()),
                receipt: Some(Intent {
                    source,
                    run_id: 1,
                    attempt: 1,
                    inputs: "b".repeat(64),
                }),
                lease: None,
                pending: None,
            };
            Self {
                head: RefCell::new("c".repeat(40)),
                states: RefCell::new([("c".repeat(40), state)].into()),
                tree: RefCell::new(None),
                parent: RefCell::new(String::new()),
                commits: Cell::new(0),
                posts: Cell::new(0),
                lost_response: Cell::new(false),
                stale: Cell::new(false),
                comparison: RefCell::new("ahead".into()),
                dispatched: RefCell::new(None),
                after_patch: RefCell::new(None),
            }
        }
        fn state(&self) -> State {
            self.states.borrow()[&*self.head.borrow()].clone()
        }
        fn set_state(&self, change: impl FnOnce(&mut State)) {
            let mut states = self.states.borrow_mut();
            change(states.get_mut(&*self.head.borrow()).unwrap());
        }
    }
    impl Api for Fake {
        fn json(
            &self,
            method: &str,
            path: &str,
            body: Option<serde_json::Value>,
        ) -> Result<serde_json::Value, ApiError> {
            if method == "GET" {
                if path.contains("/compare/") {
                    return Ok(json!({"status":*self.comparison.borrow()}));
                }
                let sha = if path.ends_with("/deploy/homelab") {
                    self.state().deployed.unwrap()
                } else {
                    self.head.borrow().clone()
                };
                return Ok(json!({"object":{"sha":sha}}));
            }
            self.posts.set(self.posts.get() + 1);
            let body = body.unwrap();
            if path.ends_with("/dispatches") {
                self.dispatched.replace(Some(body));
                return Ok(json!(null));
            }

            if path.ends_with("/git/trees") {
                self.tree.replace(Some(
                    serde_json::from_str(body["tree"][0]["content"].as_str().unwrap()).unwrap(),
                ));
                return Ok(json!({"sha":"d".repeat(40)}));
            }
            if path.ends_with("/git/commits") {
                self.commits.set(self.commits.get() + 1);
                self.parent
                    .replace(body["parents"][0].as_str().unwrap().into());
                let commit = format!("{:040x}", self.commits.get());
                self.states
                    .borrow_mut()
                    .insert(commit.clone(), self.tree.borrow().clone().unwrap());
                return Ok(json!({"sha":commit}));
            }
            assert_eq!(body["force"], false);
            if self.stale.get() || *self.parent.borrow() != *self.head.borrow() {
                return Err(ApiError::Conflict);
            }
            self.head.replace(body["sha"].as_str().unwrap().into());
            if let Some(next) = self.after_patch.borrow_mut().take() {
                let descendant = "9".repeat(40);
                self.states.borrow_mut().insert(descendant.clone(), next);
                self.head.replace(descendant);
            }
            if self.lost_response.get() {
                return Err(ApiError::Unconfirmed);
            }
            Ok(json!({"object":{"sha":*self.head.borrow()}}))
        }
        fn raw(&self, path: &str) -> Result<Vec<u8>, ApiError> {
            let commit = path.split("?ref=").nth(1).unwrap();
            Ok(serde_json::to_vec(&self.states.borrow()[commit]).unwrap())
        }
    }
    fn workspace() -> Workspace {
        let mut manifest: crate::config::Manifest =
            serde_json::from_str(include_str!("../examples/homelab-v3.json")).unwrap();
        manifest.hosts = [(
            "test-mac".into(),
            manifest.hosts.values().next().unwrap().clone(),
        )]
        .into();
        Workspace {
            repository: "example/config".into(),
            revision: "a".repeat(40),
            manifest,
        }
    }
    fn change(api: &Fake, action: Action, now: u64) -> Result<bool, Error> {
        transition(api, &workspace(), "test-mac", &"e".repeat(64), action, now)
    }
    #[test]
    fn acquire_is_idempotent_and_activation_keeps_pending_source() {
        let api = Fake::new();
        api.set_state(|s| {
            s.pending = Some(Intent {
                source: "f".repeat(40),
                run_id: 2,
                attempt: 1,
                inputs: "b".repeat(64),
            })
        });
        change(&api, Action::Acquire, 100).unwrap();
        let expires = api.state().lease.unwrap().expires;
        let posts = api.posts.get();
        change(&api, Action::Acquire, 200).unwrap();
        assert_eq!(api.posts.get(), posts);
        assert_eq!(api.state().lease.unwrap().expires, expires);
        change(&api, Action::Activate, 300).unwrap();
        assert_eq!(api.state().lease.unwrap().phase, Phase::Activating);
        assert_eq!(api.state().pending.unwrap().source, "f".repeat(40));
    }
    #[test]
    fn lost_success_response_reconciles_and_stale_parent_never_claims_ownership() {
        let api = Fake::new();
        api.lost_response.set(true);
        change(&api, Action::Acquire, 100).unwrap();
        assert!(api.state().lease.is_some());
        let stale = Fake::new();
        stale.stale.set(true);
        assert_eq!(
            change(&stale, Action::Acquire, 100),
            Err(Error::Unconfirmed)
        );
        assert!(stale.state().lease.is_none());
    }
    #[test]
    fn release_accepts_confirmed_descendant_promotion_and_next_enrollment() {
        for next_enrollment in [false, true] {
            let api = Fake::new();
            change(&api, Action::Acquire, 100).unwrap();
            change(&api, Action::Activate, 101).unwrap();
            let mut next = api.state();
            next.deployed = Some("f".repeat(40));
            next.receipt.as_mut().unwrap().source = "f".repeat(40);
            next.lease = next_enrollment.then(|| Lease {
                id: "1".repeat(64),
                host: "test-mac".into(),
                source: "f".repeat(40),
                expires: 8000,
                phase: Phase::Prepared,
            });
            api.after_patch.replace(Some(next.clone()));
            assert_eq!(change(&api, Action::Release, 200), Ok(true));
            assert_eq!(api.state(), next);
        }
    }
    #[test]
    fn a_changed_readback_needs_ancestry_and_cannot_authorize_acquisition() {
        let api = Fake::new();
        change(&api, Action::Acquire, 100).unwrap();
        let mut next = api.state();
        next.lease = None;
        api.after_patch.replace(Some(next));
        api.comparison.replace("behind".into());
        assert_eq!(change(&api, Action::Release, 200), Err(Error::Unconfirmed));

        let api = Fake::new();
        let mut next = api.state();
        next.lease = Some(Lease {
            id: "1".repeat(64),
            host: "test-mac".into(),
            source: "a".repeat(40),
            expires: 8000,
            phase: Phase::Prepared,
        });
        api.after_patch.replace(Some(next));
        assert_eq!(change(&api, Action::Acquire, 100), Err(Error::Unconfirmed));
    }
    #[test]
    fn another_attempt_expiry_and_source_supersession_preserve_state() {
        let api = Fake::new();
        change(&api, Action::Acquire, 100).unwrap();
        assert_eq!(
            transition(
                &api,
                &workspace(),
                "test-mac",
                &"d".repeat(64),
                Action::Activate,
                200
            ),
            Err(Error::Busy)
        );
        assert_eq!(change(&api, Action::Activate, 7300), Err(Error::Expired));
        api.set_state(|s| {
            s.deployed = Some("f".repeat(40));
            s.receipt.as_mut().unwrap().source = "f".repeat(40);
            s.lease = None;
        });
        assert_eq!(change(&api, Action::Acquire, 200), Err(Error::Superseded));
        *api.comparison.borrow_mut() = "behind".into();
        assert_eq!(change(&api, Action::Acquire, 200), Err(Error::NotPromoted));
    }
    #[test]
    fn historical_manifest_does_not_contact_or_mutate_provider() {
        let api = Fake::new();
        let mut old = workspace();
        old.manifest.schema = 2;
        old.manifest.deployment = None;
        assert_eq!(
            transition(&api, &old, "test-mac", "historical", Action::Acquire, 100),
            Ok(false)
        );
        assert_eq!(api.posts.get(), 0);
    }
    #[test]
    fn incomplete_or_retargeted_report_cannot_release_a_live_hold() {
        let api = Fake::new();
        let now = super::now().unwrap();
        change(&api, Action::Acquire, now).unwrap();
        api.set_state(|s| {
            s.pending = Some(Intent {
                source: "f".repeat(40),
                run_id: 2,
                attempt: 3,
                inputs: "b".repeat(64),
            })
        });
        let workspace = workspace();
        let mut report = crate::bootstrap_privileged::VerifiedSetup {
            request_id: "a".repeat(64),
            schema: 1,
            main_revision: "a".repeat(40),
            system: "/nix/store/test".into(),
            binding: crate::config::setup_binding(
                &workspace.repository,
                "test-mac",
                &workspace.revision,
            )
            .unwrap(),
            rebooted: true,
            completed: false,
            completed_at: Some(now as i64),
            reconciled_revision: Some(workspace.revision.clone()),
            boot_session: "test".into(),
            tailscale: crate::tailscale::VerifiedNode {
                dns_name: "test-mac.example.ts.net".into(),
                addresses: vec![],
            },
        };
        assert_eq!(
            release_verified(&api, &workspace, "test-mac", &"e".repeat(64), &report),
            Err(Error::Invalid)
        );
        report.completed = true;
        report.reconciled_revision = Some("f".repeat(40));
        assert_eq!(
            release_verified(&api, &workspace, "test-mac", &"e".repeat(64), &report),
            Err(Error::Invalid)
        );
        assert!(api.state().lease.is_some());
        report.reconciled_revision = Some(workspace.revision.clone());
        api.set_state(|s| {
            let lease = s.lease.as_mut().unwrap();
            lease.expires = now - 1;
            lease.phase = Phase::Expired;
        });
        release_verified(&api, &workspace, "test-mac", &"e".repeat(64), &report).unwrap();
        assert!(api.state().lease.is_none());
        assert_eq!(
            api.dispatched.borrow().as_ref().unwrap()["inputs"]["source"],
            "f".repeat(40)
        );
        assert_eq!(
            api.dispatched.borrow().as_ref().unwrap()["inputs"]["attempt"],
            "3"
        );
    }
    #[test]
    fn interrupted_installation_recovers_only_same_inspected_target_and_source() {
        let api = Fake::new();
        let now = super::now().unwrap();
        change(&api, Action::Acquire, now - 8000).unwrap();
        let workspace = workspace();
        let mut proof = crate::deploy_identity::PreparedIdentity {
            path: std::path::PathBuf::from("/Users/admin")
                .join(crate::deploy_identity::repository_directory(
                    &workspace.repository,
                ))
                .join("key.txt"),
            public_key: "synthetic-public-identity".into(),
            bootstrap_started: true,
            activated_revision: None,
        };
        recover_resume(&api, &workspace, "test-mac", &"e".repeat(64), &proof).unwrap();
        assert_eq!(api.state().lease.unwrap().phase, Phase::Activating);
        assert_eq!(
            recover_resume(&api, &workspace, "test-mac", &"f".repeat(64), &proof),
            Err(Error::Busy)
        );
        proof.activated_revision = Some(workspace.revision.clone());
        assert_eq!(
            recover_resume(&api, &workspace, "test-mac", &"e".repeat(64), &proof),
            Err(Error::Invalid)
        );
        proof.activated_revision = None;
        proof.path = "/Users/admin/other/key.txt".into();
        assert_eq!(
            recover_resume(&api, &workspace, "test-mac", &"e".repeat(64), &proof),
            Err(Error::Invalid)
        );
    }

    #[test]
    fn expired_prepared_hold_is_fenced_again_before_verifying_an_activated_host() {
        let api = Fake::new();
        let now = super::now().unwrap();
        change(&api, Action::Acquire, now - 8000).unwrap();
        assert_eq!(api.state().lease.unwrap().phase, Phase::Prepared);
        let workspace = workspace();
        let proof = crate::deploy_identity::PreparedIdentity {
            path: std::path::PathBuf::from("/Users/admin")
                .join(crate::deploy_identity::repository_directory(
                    &workspace.repository,
                ))
                .join("key.txt"),
            public_key: "synthetic-public-identity".into(),
            bootstrap_started: true,
            activated_revision: Some(workspace.revision.clone()),
        };
        recover_verification(&api, &workspace, "test-mac", &"e".repeat(64), &proof).unwrap();
        let lease = api.state().lease.unwrap();
        assert_eq!(lease.phase, Phase::Activating);
        assert!(lease.expires > now);
    }

    #[test]
    fn malformed_or_inconsistent_journal_is_rejected() {
        let api = Fake::new();
        let good = serde_json::to_value(api.state()).unwrap();
        let mut missing = good.clone();
        missing.as_object_mut().unwrap().remove("pending");
        assert!(valid_state(missing).is_err());
        let mut wrong = good;
        wrong["receipt"]["source"] = json!("f".repeat(40));
        assert!(valid_state(wrong).is_err());
    }
}
