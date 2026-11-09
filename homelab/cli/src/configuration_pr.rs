//! Publish only enrollment configuration and ciphertext, preserving GitHub rules.
#[path = "configuration_publish.rs"]
mod direct;
pub use direct::{Publication, publish_configuration, resolve_publication_for_renewal};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::config::{self, Manifest, Workspace};

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("The enrollment configuration is invalid or contains unexpected secret fields.")]
    Invalid,
    #[error(
        "GitHub branch rules require a publishing method this client cannot safely perform. No rule bypass was attempted."
    )]
    Rules,
    #[error("GitHub access failed. Check your local GitHub sign-in and repository permissions.")]
    Access,
    #[error("A repository file was not found at the reviewed revision.")]
    Missing,
    #[error("Existing configuration conflicts with this enrollment. Nothing was overwritten.")]
    Conflict,
    #[error(
        "Publishing could not be confirmed. Resume this saved setup to check the exact commit or pull request."
    )]
    Unconfirmed,
    #[error(
        "The saved configuration proposal is unavailable or unsafe. Existing state was preserved."
    )]
    State,
}

pub trait Api {
    fn json(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, Error>;
    fn raw(&self, path: &str) -> Result<Vec<u8>, Error>;
}

pub struct GitHub {
    pub executable: PathBuf,
}

impl GitHub {
    fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<Value>,
        raw: bool,
    ) -> Result<Vec<u8>, Error> {
        let mut command = Command::new(&self.executable);
        command
            .args(["api", "--hostname", "github.com", "--method", method, path])
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(Stdio::null());
        if raw {
            command.args(["--header", "Accept: application/vnd.github.raw+json"]);
        } else {
            let projection = if path.contains("/rules/branches/") {
                "map({type})"
            } else if path.ends_with("/branches/main/protection") {
                "{required_pull_request_reviews}"
            } else if path.ends_with("/branches/main") {
                "{protected,commit:{sha:.commit.sha}}"
            } else if path.contains("/git/ref/heads/") || path.contains("/git/refs/heads/") {
                "{ref,object:{sha:.object.sha}}"
            } else if path.contains("/git/matching-refs/") {
                "map({ref,object:{sha:.object.sha}})"
            } else if path.contains("/git/commits") {
                "{sha,tree:{sha:.tree.sha}}"
            } else if path.ends_with("/git/trees") {
                "{sha}"
            } else if path.ends_with("/git/refs") {
                "{ref,object:{sha:.object.sha}}"
            } else if path.contains("/compare/") {
                "{status}"
            } else if path.contains("/pulls?") {
                "map({number,html_url,state,merged_at,merge_commit_sha})"
            } else if path.contains("/pulls") {
                "{number,html_url,state,merged_at,merge_commit_sha,base:{ref:.base.ref,repo:{full_name:.base.repo.full_name}},head:{ref:.head.ref,repo:{full_name:.head.repo.full_name}}}"
            } else {
                return Err(Error::Invalid);
            };
            command.args(["--jq", projection]);
        }
        let input = if let Some(body) = body {
            let mut file = tempfile::NamedTempFile::new().map_err(|_| Error::Access)?;
            serde_json::to_writer(&mut file, &body).map_err(|_| Error::Invalid)?;
            file.flush().map_err(|_| Error::Access)?;
            command.arg("--input").arg(file.path());
            Some(file)
        } else {
            None
        };
        let operation = if method == "GET" {
            crate::provider_diagnostics::Operation::GitHubRead
        } else {
            crate::provider_diagnostics::Operation::GitHubWrite
        };
        let output = crate::provider_diagnostics::observe(
            operation,
            crate::process::capture(&mut command, Duration::from_secs(60)),
        )
        .map_err(|_| Error::Access)?;
        drop(input);
        if !output.status.success() {
            return Err(
                if method == "GET" && String::from_utf8_lossy(&output.stderr).contains("HTTP 404") {
                    Error::Missing
                } else {
                    Error::Access
                },
            );
        }
        Ok(output.stdout)
    }
}
impl Api for GitHub {
    fn json(&self, method: &str, path: &str, body: Option<Value>) -> Result<Value, Error> {
        serde_json::from_slice(&self.request(method, path, body, false)?).map_err(|_| {
            crate::provider_diagnostics::invalid_response(if method == "GET" {
                crate::provider_diagnostics::Operation::GitHubRead
            } else {
                crate::provider_diagnostics::Operation::GitHubWrite
            });
            Error::Access
        })
    }
    fn raw(&self, path: &str) -> Result<Vec<u8>, Error> {
        self.request("GET", path, None, true)
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Changes {
    pub repository: String,
    pub base: String,
    pub host: String,
    pub manifest: Manifest,
    files: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    previous_ciphertext: Option<String>,
}

impl Changes {
    fn validate(&self) -> Result<(), Error> {
        if serde_json::to_vec(self).map_err(|_| Error::Invalid)?.len() > 65536 {
            return Err(Error::Invalid);
        }
        if !config::valid_repository(&self.repository)
            || !config::valid_revision(&self.base)
            || !config::valid_host(&self.host)
            || self.files.len() != 3
        {
            return Err(Error::Invalid);
        }
        self.manifest.validate().map_err(|_| Error::Invalid)?;
        let manifest: Manifest =
            serde_json::from_str(self.files.get("homelab.json").ok_or(Error::Invalid)?)
                .map_err(|_| Error::Invalid)?;
        if manifest != self.manifest
            || manifest
                .deployment
                .as_ref()
                .is_some_and(|policy| policy.repository != self.repository)
            || manifest
                .hosts
                .get(&self.host)
                .is_none_or(|host| host.authorized_keys.is_empty())
        {
            return Err(Error::Invalid);
        }
        let rules: Value =
            serde_yaml_ng::from_str(self.files.get(".sops.yaml").ok_or(Error::Invalid)?)
                .map_err(|_| Error::Invalid)?;
        let rule = rules.pointer("/creation_rules/0").ok_or(Error::Invalid)?;
        let pattern = format!("^secrets/{}\\.sops\\.yaml$", self.host);
        if rule.get("path_regex").and_then(Value::as_str) != Some(pattern.as_str()) {
            return Err(Error::Invalid);
        }
        let recipients: Vec<_> = rule
            .get("age")
            .and_then(Value::as_str)
            .ok_or(Error::Invalid)?
            .split(',')
            .collect();
        if recipients.len() != 2 || recipients[0] == recipients[1] {
            return Err(Error::Invalid);
        }
        let ciphertext = self
            .files
            .get(&format!("secrets/{}.sops.yaml", self.host))
            .ok_or(Error::Invalid)?;
        crate::provisioning::validate_ciphertext_for(
            ciphertext.as_bytes(),
            recipients[0],
            recipients[1],
        )
        .map_err(|_| Error::Invalid)?;
        if let Some(previous) = &self.previous_ciphertext {
            crate::provisioning::validate_ciphertext_for(
                previous.as_bytes(),
                recipients[0],
                recipients[1],
            )
            .map_err(|_| Error::Invalid)?;
        }
        Ok(())
    }

    /// Freeze the proposal before any remote write. A retry must use this base,
    /// even when main has advanced, or it could create a second enrollment PR.
    pub fn save(&self, path: &Path) -> Result<(), Error> {
        self.validate()?;
        private_parent(path)?;
        let bytes = serde_json::to_vec(self).map_err(|_| Error::Invalid)?;
        if bytes.len() > 65536 {
            return Err(Error::Invalid);
        }
        if path.try_exists().map_err(|_| Error::State)? {
            let saved = Self::load(path, &self.repository, &self.host)?;
            return if serde_json::to_vec(&saved).map_err(|_| Error::State)? == bytes {
                Ok(())
            } else {
                Err(Error::Conflict)
            };
        }
        let parent = path.parent().ok_or(Error::State)?;
        let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
        temporary.write_all(&bytes).map_err(|_| Error::State)?;
        temporary.as_file().sync_all().map_err(|_| Error::State)?;
        temporary
            .persist_noclobber(path)
            .map_err(|_| Error::State)?;
        File::open(parent)
            .and_then(|file| file.sync_all())
            .map_err(|_| Error::State)
    }

    pub fn load(path: &Path, repository: &str, host: &str) -> Result<Self, Error> {
        private_parent(path)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(
                (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
            )
            .open(path)
            .map_err(|_| Error::State)?;
        let metadata = file.metadata().map_err(|_| Error::State)?;
        if !metadata.is_file()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o077 != 0
            || metadata.len() > 65536
        {
            return Err(Error::State);
        }
        let mut bytes = Vec::new();
        file.take(65537)
            .read_to_end(&mut bytes)
            .map_err(|_| Error::State)?;
        if bytes.len() > 65536 {
            return Err(Error::State);
        }
        let changes: Self = serde_json::from_slice(&bytes).map_err(|_| Error::State)?;
        changes.validate()?;
        if changes.repository != repository || changes.host != host {
            return Err(Error::Conflict);
        }
        Ok(changes)
    }

    pub fn branch(&self) -> String {
        let mut hash = Sha256::new();
        hash.update(self.base.as_bytes());
        for (path, content) in &self.files {
            hash.update(path.as_bytes());
            hash.update([0]);
            hash.update(content.as_bytes());
        }
        let digest: String = hash.finalize()[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        format!("codex/enroll-{}-{digest}", self.host)
    }
}

fn private_parent(path: &Path) -> Result<(), Error> {
    let metadata =
        std::fs::symlink_metadata(path.parent().ok_or(Error::State)?).map_err(|_| Error::State)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::State);
    }
    Ok(())
}

pub fn prepare(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    public_key: &str,
    ciphertext: &str,
    host_recipient: &str,
    recovery_recipient: &str,
) -> Result<Changes, Error> {
    prepare_inner(
        api,
        workspace,
        host,
        public_key,
        Encryption {
            ciphertext,
            host_recipient,
            recovery_recipient,
        },
        None,
    )
}

pub struct Encryption<'a> {
    pub ciphertext: &'a str,
    pub host_recipient: &'a str,
    pub recovery_recipient: &'a str,
}

/// Renewal may replace only the exact archived enrollment ciphertext. Both
/// versions must contain enrollment secrets for the same recovery identities.
pub fn prepare_renewal(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    public_key: &str,
    encryption: Encryption<'_>,
    previous_ciphertext: &str,
) -> Result<Changes, Error> {
    prepare_inner(
        api,
        workspace,
        host,
        public_key,
        encryption,
        Some(previous_ciphertext),
    )
}

fn prepare_inner(
    api: &impl Api,
    workspace: &Workspace,
    host: &str,
    public_key: &str,
    encryption: Encryption<'_>,
    previous_ciphertext: Option<&str>,
) -> Result<Changes, Error> {
    let Encryption {
        ciphertext,
        host_recipient,
        recovery_recipient,
    } = encryption;
    workspace.manifest.validate().map_err(|_| Error::Invalid)?;
    if !config::valid_repository(&workspace.repository)
        || !config::valid_revision(&workspace.revision)
        || !config::valid_host(host)
        || ciphertext.len() > 16384
    {
        return Err(Error::Invalid);
    }
    let key = crate::ssh_identity::canonical_key(public_key).ok_or(Error::Invalid)?;
    for recipient in [host_recipient, recovery_recipient] {
        if !recipient.starts_with("age1")
            || recipient.len() > 128
            || !recipient
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        {
            return Err(Error::Invalid);
        }
    }
    if host_recipient == recovery_recipient {
        return Err(Error::Invalid);
    }
    crate::provisioning::validate_ciphertext_for(
        ciphertext.as_bytes(),
        host_recipient,
        recovery_recipient,
    )
    .map_err(|_| Error::Invalid)?;
    if let Some(previous) = previous_ciphertext {
        crate::provisioning::validate_ciphertext_for(
            previous.as_bytes(),
            host_recipient,
            recovery_recipient,
        )
        .map_err(|_| Error::Invalid)?;
    }
    let prefix = format!("repos/{}/contents", workspace.repository);
    let suffix = format!("?ref={}", workspace.revision);
    let original: Manifest =
        serde_json::from_slice(&api.raw(&format!("{prefix}/homelab.json{suffix}"))?)
            .map_err(|_| Error::Invalid)?;
    if original != workspace.manifest {
        return Err(Error::Conflict);
    }
    let mut manifest = original;
    let configuration = manifest.hosts.get_mut(host).ok_or(Error::Invalid)?;
    if !configuration
        .authorized_keys
        .iter()
        .any(|existing| crate::ssh_identity::canonical_key(existing).as_ref() == Some(&key))
    {
        configuration.authorized_keys.push(key);
    }
    manifest.validate().map_err(|_| Error::Invalid)?;
    let path = format!("secrets/{host}.sops.yaml");
    match api.raw(&format!("{prefix}/{path}{suffix}")) {
        Ok(existing) if existing == ciphertext.as_bytes() => {}
        Ok(existing)
            if previous_ciphertext.is_some_and(|previous| previous.as_bytes() == existing) => {}
        Ok(_) => return Err(Error::Conflict),
        Err(Error::Missing) if previous_ciphertext.is_none() => {}
        Err(error) => return Err(error),
    }
    let rules_bytes = api.raw(&format!("{prefix}/.sops.yaml{suffix}"))?;
    let mut rules: Value = serde_yaml_ng::from_slice(&rules_bytes).map_err(|_| Error::Invalid)?;
    let creation = rules
        .get_mut("creation_rules")
        .and_then(Value::as_array_mut)
        .ok_or(Error::Invalid)?;
    let pattern = format!("^secrets/{host}\\.sops\\.yaml$");
    let rule = json!({"path_regex":pattern,"age":format!("{host_recipient},{recovery_recipient}")});
    if creation
        .iter()
        .any(|existing| existing.get("path_regex") == rule.get("path_regex") && *existing != rule)
    {
        return Err(Error::Conflict);
    }
    creation.retain(|existing| existing.get("path_regex") != rule.get("path_regex"));
    creation.insert(0, rule);
    let files = BTreeMap::from([
        (path, ciphertext.into()),
        (
            "homelab.json".into(),
            serde_json::to_string_pretty(&manifest).map_err(|_| Error::Invalid)? + "\n",
        ),
        (
            ".sops.yaml".into(),
            serde_yaml_ng::to_string(&rules).map_err(|_| Error::Invalid)?,
        ),
    ]);
    Ok(Changes {
        repository: workspace.repository.clone(),
        base: workspace.revision.clone(),
        host: host.into(),
        manifest,
        files,
        previous_ciphertext: previous_ciphertext.map(str::to_owned),
    })
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PullRequest {
    pub number: u64,
    pub html_url: String,
    pub state: String,
    pub merged_at: Option<String>,
    pub merge_commit_sha: Option<String>,
}

fn sha(value: &Value, pointer: &str) -> Result<String, Error> {
    value
        .pointer(pointer)
        .and_then(Value::as_str)
        .filter(|sha| config::valid_revision(sha))
        .map(str::to_owned)
        .ok_or(Error::Access)
}

fn validate_delta(api: &impl Api, changes: &Changes) -> Result<(), Error> {
    let original: Manifest = serde_json::from_slice(&api.raw(&format!(
        "repos/{}/contents/homelab.json?ref={}",
        changes.repository, changes.base,
    ))?)
    .map_err(|_| Error::Invalid)?;
    let key = changes
        .manifest
        .hosts
        .get(&changes.host)
        .and_then(|host| host.authorized_keys.last())
        .ok_or(Error::Invalid)?;
    let rules: Value =
        serde_yaml_ng::from_str(changes.files.get(".sops.yaml").ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
    let recipients: Vec<_> = rules
        .pointer("/creation_rules/0/age")
        .and_then(Value::as_str)
        .ok_or(Error::Invalid)?
        .split(',')
        .collect();
    if recipients.len() != 2 {
        return Err(Error::Invalid);
    }
    let expected = prepare_inner(
        api,
        &Workspace {
            repository: changes.repository.clone(),
            revision: changes.base.clone(),
            manifest: original,
        },
        &changes.host,
        key,
        Encryption {
            ciphertext: changes
                .files
                .get(&format!("secrets/{}.sops.yaml", changes.host))
                .ok_or(Error::Invalid)?,
            host_recipient: recipients[0],
            recovery_recipient: recipients[1],
        },
        changes.previous_ciphertext.as_deref(),
    )?;
    // Old saved proposals retain their original manifest bytes and branch identity.
    // Only the retired milestone/formatting may differ from a newly prepared file;
    // every desired field and both encrypted-input files must still match.
    let saved_manifest: Manifest =
        serde_json::from_str(changes.files.get("homelab.json").ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
    if expected.manifest != changes.manifest
        || expected.manifest != saved_manifest
        || expected.files.len() != changes.files.len()
        || expected.files.iter().any(|(path, contents)| {
            path != "homelab.json" && changes.files.get(path) != Some(contents)
        })
    {
        return Err(Error::Conflict);
    }
    Ok(())
}

pub fn publish(api: &impl Api, changes: &Changes) -> Result<PullRequest, Error> {
    changes.validate()?;
    if !config::valid_repository(&changes.repository)
        || !config::valid_revision(&changes.base)
        || !config::valid_host(&changes.host)
        || changes.files.len() != 3
        || ![
            "homelab.json".to_owned(),
            ".sops.yaml".to_owned(),
            format!("secrets/{}.sops.yaml", changes.host),
        ]
        .iter()
        .all(|path| changes.files.contains_key(path))
    {
        return Err(Error::Invalid);
    }
    let root = format!("repos/{}", changes.repository);
    let branch = changes.branch();
    let owner = changes.repository.split('/').next().ok_or(Error::Invalid)?;
    let existing = api.json(
        "GET",
        &format!("{root}/pulls?state=all&head={owner}:{branch}&base=main"),
        None,
    )?;
    let requests = existing.as_array().ok_or(Error::Access)?;
    if requests.len() > 1 {
        return Err(Error::Conflict);
    }
    if let Some(request) = requests.first() {
        let request: PullRequest =
            serde_json::from_value(request.clone()).map_err(|_| Error::Access)?;
        if request.merged_at.is_some() {
            approved_workspace(api, changes, request.number)?.ok_or(Error::Conflict)?;
        } else if request.state != "open" {
            return Err(Error::Conflict);
        }
        // GitHub may have updated or deleted the branch after review. The merged
        // configuration is checked independently; resuming must not recreate it.
        return Ok(request);
    }
    validate_delta(api, changes)?;
    let base = api.json("GET", &format!("{root}/git/commits/{}", changes.base), None)?;
    let tree = api.json("POST", &format!("{root}/git/trees"), Some(json!({
        "base_tree":sha(&base, "/tree/sha")?,
        "tree":changes.files.iter().map(|(path, content)| json!({"path":path,"mode":"100644","type":"blob","content":content})).collect::<Vec<_>>()
    })))?;
    let tree_sha = sha(&tree, "/sha")?;
    let refs = api.json(
        "GET",
        &format!("{root}/git/matching-refs/heads/{branch}"),
        None,
    )?;
    let references = refs.as_array().ok_or(Error::Access)?;
    let exact: Vec<_> = references
        .iter()
        .filter(|entry| entry["ref"] == format!("refs/heads/{branch}"))
        .collect();
    if exact.len() > 1 {
        return Err(Error::Conflict);
    }
    if let Some(reference) = exact.first() {
        let commit = api.json(
            "GET",
            &format!("{root}/git/commits/{}", sha(reference, "/object/sha")?),
            None,
        )?;
        if sha(&commit, "/tree/sha")? != tree_sha {
            return Err(Error::Conflict);
        }
    } else {
        let commit = api.json("POST", &format!("{root}/git/commits"), Some(json!({
            "message":format!("Enroll {}", changes.host),"tree":tree_sha,"parents":[changes.base]
        })))?;
        api.json(
            "POST",
            &format!("{root}/git/refs"),
            Some(json!({"ref":format!("refs/heads/{branch}"),"sha":sha(&commit,"/sha")?})),
        )
        .map_err(|_| Error::Unconfirmed)?;
    }
    let request = api.json("POST", &format!("{root}/pulls"), Some(json!({
            "title":format!("Enroll {}", changes.host), "head":branch, "base":"main",
            "body":"Prepare this Mac for enrollment: enable its reviewed host configuration, authorize the selected SSH public key and add encrypted host secrets with recovery recipients. No private identity or plaintext credential is included. Merging authorizes the setup wizard to install this configuration; existing repository checks and review requirements still apply."
        }))).map_err(|_| Error::Unconfirmed)?;
    serde_json::from_value(request).map_err(|_| Error::Access)
}

/// Resolve the old proposal before retiring its local attempt. A lost close
/// response is reconciled by reading the same PR, never by publishing another.
pub fn resolve_for_renewal(api: &impl Api, changes: &Changes) -> Result<Option<Workspace>, Error> {
    changes.validate()?;
    let root = format!("repos/{}", changes.repository);
    let owner = changes.repository.split('/').next().ok_or(Error::Invalid)?;
    let branch = changes.branch();
    let result = api.json(
        "GET",
        &format!("{root}/pulls?state=all&head={owner}:{branch}&base=main"),
        None,
    )?;
    let requests = result.as_array().ok_or(Error::Access)?;
    let number = match requests.as_slice() {
        [] => return Ok(None),
        [request] => request
            .get("number")
            .and_then(Value::as_u64)
            .filter(|number| *number > 0)
            .ok_or(Error::Access)?,
        _ => return Err(Error::Conflict),
    };
    let path = format!("{root}/pulls/{number}");
    let read = || -> Result<PullRequest, Error> {
        let value = api.json("GET", &path, None)?;
        for (pointer, expected) in [
            ("/head/ref", branch.as_str()),
            ("/head/repo/full_name", changes.repository.as_str()),
            ("/base/ref", "main"),
            ("/base/repo/full_name", changes.repository.as_str()),
        ] {
            if value.pointer(pointer).and_then(Value::as_str) != Some(expected) {
                return Err(Error::Conflict);
            }
        }
        if value.get("number").and_then(Value::as_u64) != Some(number) {
            return Err(Error::Conflict);
        }
        serde_json::from_value(value).map_err(|_| Error::Access)
    };
    let mut request = read()?;
    if request.merged_at.is_none() && request.state == "open" {
        let _ = api.json("PATCH", &path, Some(json!({"state":"closed"})));
        request = read().map_err(|_| Error::Unconfirmed)?;
    }
    if request.merged_at.is_some() {
        return approved_workspace(api, changes, number)?
            .map(Some)
            .ok_or(Error::Unconfirmed);
    }
    if request.state != "closed" {
        return Err(Error::Unconfirmed);
    }
    Ok(None)
}

pub fn merged_revision(
    api: &impl Api,
    repository: &str,
    number: u64,
) -> Result<Option<String>, Error> {
    if !config::valid_repository(repository) || number == 0 {
        return Err(Error::Invalid);
    }
    let raw = api.json("GET", &format!("repos/{repository}/pulls/{number}"), None)?;
    if raw.pointer("/base/ref").and_then(Value::as_str) != Some("main")
        || raw.pointer("/base/repo/full_name").and_then(Value::as_str) != Some(repository)
        || raw.get("number").and_then(Value::as_u64) != Some(number)
    {
        return Err(Error::Conflict);
    }
    let request: PullRequest = serde_json::from_value(raw).map_err(|_| Error::Access)?;
    if request.merged_at.is_none() {
        return if request.state == "open" {
            Ok(None)
        } else {
            Err(Error::Conflict)
        };
    }
    let revision = request
        .merge_commit_sha
        .filter(|sha| config::valid_revision(sha))
        .ok_or(Error::Access)?;
    let comparison = api.json(
        "GET",
        &format!("repos/{repository}/compare/{revision}...main"),
        None,
    )?;
    if !matches!(
        comparison.get("status").and_then(Value::as_str),
        Some("ahead" | "identical")
    ) {
        return Err(Error::Conflict);
    }
    Ok(Some(revision))
}

pub fn approved_workspace(
    api: &impl Api,
    changes: &Changes,
    number: u64,
) -> Result<Option<Workspace>, Error> {
    let request = api.json(
        "GET",
        &format!("repos/{}/pulls/{number}", changes.repository),
        None,
    )?;
    if request.pointer("/head/ref").and_then(Value::as_str) != Some(changes.branch().as_str())
        || request
            .pointer("/head/repo/full_name")
            .and_then(Value::as_str)
            != Some(changes.repository.as_str())
    {
        return Err(Error::Conflict);
    }
    let Some(revision) = merged_revision(api, &changes.repository, number)? else {
        return Ok(None);
    };
    let prefix = format!("repos/{}/contents", changes.repository);
    let manifest: Manifest =
        serde_json::from_slice(&api.raw(&format!("{prefix}/homelab.json?ref={revision}"))?)
            .map_err(|_| Error::Invalid)?;
    manifest.validate().map_err(|_| Error::Invalid)?;
    if manifest.hosts.get(&changes.host) != changes.manifest.hosts.get(&changes.host)
        || manifest.tailscale != changes.manifest.tailscale
        || manifest.schema != changes.manifest.schema
        || manifest.deployment != changes.manifest.deployment
        || manifest.one_password != changes.manifest.one_password
    {
        return Err(Error::Conflict);
    }
    let path = format!("secrets/{}.sops.yaml", changes.host);
    let ciphertext = api.raw(&format!("{prefix}/{path}?ref={revision}"))?;
    if Some(ciphertext.as_slice()) != changes.files.get(&path).map(|value| value.as_bytes()) {
        return Err(Error::Conflict);
    }
    let actual_rules: Value =
        serde_yaml_ng::from_slice(&api.raw(&format!("{prefix}/.sops.yaml?ref={revision}"))?)
            .map_err(|_| Error::Invalid)?;
    let expected_rules: Value =
        serde_yaml_ng::from_str(changes.files.get(".sops.yaml").ok_or(Error::Invalid)?)
            .map_err(|_| Error::Invalid)?;
    // The exact host rule must stay first so a broader rule cannot override it.
    if actual_rules.pointer("/creation_rules/0") != expected_rules.pointer("/creation_rules/0") {
        return Err(Error::Conflict);
    }
    Ok(Some(Workspace {
        repository: changes.repository.clone(),
        revision,
        manifest,
    }))
}
