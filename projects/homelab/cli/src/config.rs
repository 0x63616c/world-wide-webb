//! Repository metadata is data; only an explicitly approved target executes Nix.
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use thiserror::Error;

pub fn setup_binding(repository: &str, host: &str, revision: &str) -> Option<String> {
    use sha2::{Digest, Sha256};

    if !valid_repository(repository) || !valid_host(host) || !valid_revision(revision) {
        return None;
    }
    Some(
        Sha256::digest(format!("{repository}\n{host}\n{revision}"))
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    )
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Host {
    /// Existing administrator account; setup never guesses or renames this user.
    #[schemars(length(min = 1, max = 253), pattern(r"^[A-Za-z0-9._][A-Za-z0-9._-]*$"))]
    pub admin_user: String,
    #[serde(rename = "adminUID")]
    /// Existing administrator UID, verified against the target before setup.
    #[schemars(range(min = 501, max = 4294967295u32))]
    pub admin_uid: u32,
    /// Public SSH keys only, never private keys.
    #[schemars(length(max = 32))]
    pub authorized_keys: Vec<String>,
    /// Names of services the target configuration must enable.
    #[schemars(length(max = 32))]
    pub services: Vec<String>,
}
// Historical setup journals contain this retired milestone. Accept it only when
// reading; it must never authorize activation or reappear in desired configuration.
impl<'de> Deserialize<'de> for Host {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        struct Input {
            admin_user: String,
            #[serde(rename = "adminUID")]
            admin_uid: u32,
            authorized_keys: Vec<String>,
            services: Vec<String>,
            #[serde(default, rename = "activationReady")]
            _legacy_activation_ready: bool,
        }
        let input = Input::deserialize(deserializer)?;
        Ok(Self {
            admin_user: input.admin_user,
            admin_uid: input.admin_uid,
            authorized_keys: input.authorized_keys,
            services: input.services,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct OAuthReference {
    /// 1Password vault containing the OAuth issuer item; not the backup destination.
    #[schemars(
        length(min = 1, max = 200),
        pattern(r"^(?!-)(?=.*\S)[^\x00-\x1F\x7F-\x9F]+$")
    )]
    pub vault: String,
    /// 1Password item reference; no OAuth secret belongs in this document.
    #[schemars(
        length(min = 1, max = 200),
        pattern(r"^(?!-)(?=.*\S)[^\x00-\x1F\x7F-\x9F]+$")
    )]
    pub item: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct TailscaleConfig {
    /// Tailscale device tag used for this enrollment.
    #[schemars(pattern(r"^tag:[a-z]([a-z0-9-]{0,61}[a-z0-9])?$"))]
    pub tag: String,
    pub oauth: Option<OAuthReference>,
}
/// The authoring branch discovers this policy; only the deployment branch installs hosts.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Deployment {
    #[schemars(pattern(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}/[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$"))]
    pub repository: String,
    #[schemars(pattern(r"^deploy/homelab$"))]
    pub branch: String,
}
impl Deployment {
    pub fn valid(&self) -> bool {
        valid_repository(&self.repository) && self.branch == "deploy/homelab"
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    /// Inert editor metadata. The CLI never fetches this URL.
    #[serde(rename = "$schema", default, skip_serializing_if = "Option::is_none")]
    pub schema_url: Option<String>,
    /// Version 2 requires an explicit, independent recovery-key backup vault.
    pub schema: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deployment: Option<Deployment>,
    #[serde(
        rename = "onePassword",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub one_password: Option<OnePasswordConfig>,
    pub hosts: BTreeMap<String, Host>,
    pub tailscale: Option<TailscaleConfig>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct OnePasswordConfig {
    /// Vault where host and recovery age identities are durably backed up.
    /// This is independent of tailscale.oauth.vault, which contains the issuer.
    #[schemars(
        length(min = 1, max = 200),
        pattern(r"^(?!-)(?=.*\S)[^\x00-\x1F\x7F-\x9F]+$")
    )]
    pub backup_vault: String,
}
#[derive(Clone, Debug)]
pub struct Workspace {
    pub repository: String,
    pub revision: String,
    pub manifest: Manifest,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    schema: u8,
    repository: String,
}
#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Use a GitHub repository in owner/name form.")]
    InvalidRepository,
    #[error("The repository's homelab.json is invalid or uses an unsupported schema.")]
    InvalidManifest,
    #[error(
        "GitHub could not read the configuration. Sign in with gh on this Mac and check repository access."
    )]
    Fetch,
    #[error("The saved repository binding is not a private, safely owned regular file.")]
    State,
    #[error(
        "This client is already attached to another repository. Preserve its keys and inventory; switching needs an explicit migration."
    )]
    DifferentRepository,
}
impl Error {
    pub fn next_action(&self) -> &'static str {
        match self {
            Self::Fetch => "Sign in to GitHub CLI, then retry. No target was changed.",
            Self::InvalidManifest => {
                "Review homelab.json in the selected repository; no Nix runs on this Mac."
            }
            Self::InvalidRepository => "Enter owner/repository, without a URL or token.",
            _ => "Preserve local state and inspect the saved repository binding before retrying.",
        }
    }
}
pub fn valid_host(s: &str) -> bool {
    let b = s.as_bytes();
    !b.is_empty()
        && b.len() <= 63
        && b[0].is_ascii_lowercase()
        && b.last().is_some_and(u8::is_ascii_alphanumeric)
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}
pub fn valid_repository(s: &str) -> bool {
    let p: Vec<_> = s.split('/').collect();
    p.len() == 2
        && p.iter().all(|s| {
            !s.is_empty()
                && s.len() <= 100
                && !s.starts_with('.')
                && !s.starts_with('-')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        })
}

/// Normalize pasted GitHub addresses at the input boundary; stored references stay owner/repo.
pub fn parse_repository(input: &str) -> Result<String, Error> {
    let input = input.trim();
    if valid_repository(input) {
        return Ok(input.to_owned());
    }
    let path = [
        "https://github.com/",
        "http://github.com/",
        "github.com/",
        "git@github.com:",
        "ssh://git@github.com/",
    ]
    .iter()
    .find_map(|prefix| input.strip_prefix(prefix))
    .ok_or(Error::InvalidRepository)?;
    let path = path
        .split(['?', '#'])
        .next()
        .unwrap_or(path)
        .trim_end_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    if valid_repository(path) {
        Ok(path.to_owned())
    } else {
        Err(Error::InvalidRepository)
    }
}

pub fn valid_revision(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Manifest {
    pub fn deployment_branch(&self) -> &str {
        self.deployment
            .as_ref()
            .map_or("main", |policy| policy.branch.as_str())
    }

    pub fn validate(&self) -> Result<(), Error> {
        let label = |s: &str| {
            !s.is_empty()
                && s.len() <= 253
                && !s.starts_with('-')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        };
        if !matches!(self.schema, 1..=3)
            || (self.schema >= 2 && self.one_password.is_none())
            || (self.schema == 3 && !self.deployment.as_ref().is_some_and(Deployment::valid))
            || (self.schema < 3 && self.deployment.is_some())
            || self
                .one_password
                .as_ref()
                .is_some_and(|p| !valid_reference(&p.backup_vault))
            || self.hosts.is_empty()
            || self.hosts.len() > 32
            || self.hosts.iter().any(|(name, h)| {
                !valid_host(name)
                    || !label(&h.admin_user)
                    || h.admin_uid < 501
                    || h.authorized_keys.len() > 32
                    || h.authorized_keys.iter().any(|k| {
                        k.len() > 8192 || k.trim().is_empty() || k.chars().any(char::is_control)
                    })
                    || h.services.len() > 32
                    || h.services.iter().any(|s| !label(s))
            })
        {
            return Err(Error::InvalidManifest);
        }
        if let Some(t) = &self.tailscale {
            if !t.tag.strip_prefix("tag:").is_some_and(valid_host) {
                return Err(Error::InvalidManifest);
            }
            if let Some(o) = &t.oauth {
                for value in [&o.vault, &o.item] {
                    if !valid_reference(value) {
                        return Err(Error::InvalidManifest);
                    }
                }
            }
        }
        Ok(())
    }
}
pub fn valid_reference(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= 200
        && !value.starts_with('-')
        && !value.chars().any(char::is_control)
}

/// Generated from the same types used to parse repository configuration.
/// Only the current authoring version is published; historical v1 remains readable.
pub fn schema() -> serde_json::Value {
    let generated = schemars::generate::SchemaSettings::draft2020_12()
        .into_generator()
        .into_root_schema_for::<Manifest>();
    let mut schema = serde_json::to_value(generated).expect("derived schema is serializable");
    schema["$id"] = serde_json::json!("urn:homelab:configuration:v3");
    schema["properties"]["schema"] =
        serde_json::json!({"const":3,"description":"Current configuration version."});
    schema["properties"]["deployment"] = serde_json::json!({"$ref":"#/$defs/Deployment"});
    schema["required"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!("deployment"));
    schema["properties"]["onePassword"] = serde_json::json!({"$ref":"#/$defs/OnePasswordConfig"});
    schema["required"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!("onePassword"));
    schema["properties"]["hosts"]["minProperties"] = serde_json::json!(1);
    schema["properties"]["hosts"]["maxProperties"] = serde_json::json!(32);
    schema["properties"]["hosts"]["propertyNames"] =
        serde_json::json!({"pattern":"^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$"});
    schema["$defs"]["Host"]["properties"]["authorizedKeys"]["items"] = serde_json::json!({"type":"string","minLength":1,"maxLength":8192,"pattern":r"^(?=.*\S)[^\x00-\x1F\x7F-\x9F]+$"});
    schema["$defs"]["Host"]["properties"]["services"]["items"] = serde_json::json!({"type":"string","minLength":1,"maxLength":253,"pattern":"^[A-Za-z0-9._][A-Za-z0-9._-]*$"});
    schema
}

/// Diagnostics use fixed paths, never Serde's error message or caller-controlled keys.
#[derive(Debug, Error)]
#[error("Invalid configuration at {path}. {message}")]
pub struct Diagnostic {
    pub path: &'static str,
    pub message: &'static str,
}

pub fn parse(bytes: &[u8]) -> Result<Manifest, Diagnostic> {
    let fail = |path, message| Diagnostic { path, message };
    if bytes.len() > 65536 {
        return Err(fail("$", "Configuration exceeds 64 KiB."));
    }
    let mut deserializer = serde_json::Deserializer::from_slice(bytes);
    let manifest: Manifest =
        serde_path_to_error::deserialize(&mut deserializer).map_err(|error| {
            let path = match error.path().to_string().as_str() {
                "schema" => "$.schema",
                "onePassword" | "onePassword.backupVault" => "$.onePassword.backupVault",
                "tailscale.tag" => "$.tailscale.tag",
                "tailscale.oauth.vault" => "$.tailscale.oauth.vault",
                "tailscale.oauth.item" => "$.tailscale.oauth.item",
                "hosts" => "$.hosts",
                _ => {
                    use serde_path_to_error::Segment;
                    let segments: Vec<_> = error.path().iter().collect();
                    match segments.as_slice() {
                        [
                            Segment::Map { key },
                            Segment::Map { .. },
                            Segment::Map { key: field },
                            ..,
                        ] if key == "hosts" => match field.as_str() {
                            "adminUser" => "$.hosts.*.adminUser",
                            "adminUID" => "$.hosts.*.adminUID",
                            "authorizedKeys" => "$.hosts.*.authorizedKeys",
                            "activationReady" => "$.hosts.*.activationReady",
                            "services" => "$.hosts.*.services",
                            _ => "$",
                        },
                        _ => "$",
                    }
                }
            };
            fail(path, "Check the documented fields and their types.")
        })?;
    deserializer
        .end()
        .map_err(|_| fail("$", "Expected one JSON document."))?;
    if !matches!(manifest.schema, 1..=3) {
        return Err(fail("$.schema", "Use configuration version 3."));
    }
    if manifest.schema >= 2 && manifest.one_password.is_none() {
        return Err(fail(
            "$.onePassword.backupVault",
            "Versions 2 and 3 require an explicit backup vault.",
        ));
    }
    if manifest
        .one_password
        .as_ref()
        .is_some_and(|p| !valid_reference(&p.backup_vault))
    {
        return Err(fail(
            "$.onePassword.backupVault",
            "Use a nonempty vault name or ID without control characters.",
        ));
    }
    manifest.validate().map_err(|_| {
        fail(
            "$",
            "Configuration violates the documented host, key or Tailscale constraints.",
        )
    })?;
    Ok(manifest)
}

pub fn validate_file(path: &Path) -> Result<Manifest, Diagnostic> {
    let unavailable = || Diagnostic {
        path: "$",
        message: "Could not read a regular configuration file (maximum 64 KiB).",
    };
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(rustix::fs::OFlags::NONBLOCK.bits() as i32)
        .open(path)
        .map_err(|_| unavailable())?;
    if !file.metadata().map_err(|_| unavailable())?.is_file() {
        return Err(unavailable());
    }
    let mut bytes = Vec::new();
    file.take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| unavailable())?;
    parse(&bytes)
}

fn gh() -> Result<PathBuf, Error> {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>())
        .filter(|p| p.is_absolute())
        .map(|p| p.join("gh"))
        .chain([
            PathBuf::from("/opt/homebrew/bin/gh"),
            PathBuf::from("/usr/local/bin/gh"),
        ])
        .find(|p| p.is_file())
        .ok_or(Error::Fetch)
}
fn api(path: &str, raw: bool) -> Result<Vec<u8>, Error> {
    let mut c = Command::new(gh()?);
    c.args(["api", "--hostname", "github.com", path])
        .stdin(Stdio::null());
    if raw {
        c.args(["--header", "Accept: application/vnd.github.raw+json"]);
    } else {
        c.args(["--jq", ".sha"]);
    }
    let out = crate::provider_diagnostics::observe(
        crate::provider_diagnostics::Operation::GitHubRead,
        crate::process::capture(&mut c, Duration::from_secs(30)),
    )
    .map_err(|_| Error::Fetch)?;
    if !out.status.success() {
        return Err(Error::Fetch);
    }
    Ok(out.stdout)
}
pub fn fetch(repository: &str) -> Result<Workspace, Error> {
    if !valid_repository(repository) {
        return Err(Error::InvalidRepository);
    }
    let revision = String::from_utf8(api(&format!("repos/{repository}/commits/main"), false)?)
        .map_err(|_| Error::Fetch)?
        .trim()
        .to_owned();
    if !valid_revision(&revision) {
        return Err(Error::Fetch);
    }
    let authoring = fetch_revision(repository, &revision)?;
    select_deployment(authoring, || {
        let deployed_revision = String::from_utf8(api(
            &format!("repos/{repository}/commits/deploy%2Fhomelab"),
            false,
        )?)
        .map_err(|_| Error::Fetch)?
        .trim()
        .to_owned();
        fetch_revision(repository, &deployed_revision)
    })
}

fn select_deployment(
    authoring: Workspace,
    lookup: impl FnOnce() -> Result<Workspace, Error>,
) -> Result<Workspace, Error> {
    let Some(policy) = &authoring.manifest.deployment else {
        return Ok(authoring);
    };
    let deployed = lookup()?;
    // Never fall back to authoring main when the deployment ref is absent/stale.
    if deployed.repository != authoring.repository
        || deployed.manifest.deployment.as_ref() != Some(policy)
    {
        return Err(Error::InvalidManifest);
    }
    Ok(deployed)
}

pub fn fetch_revision(repository: &str, revision: &str) -> Result<Workspace, Error> {
    if !valid_repository(repository) || !valid_revision(revision) {
        return Err(Error::InvalidRepository);
    }
    let bytes = revision_manifest(repository, revision, |path| api(path, true))?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| Error::InvalidManifest)?;
    manifest.validate()?;
    if manifest
        .deployment
        .as_ref()
        .is_some_and(|policy| policy.repository != repository)
    {
        return Err(Error::InvalidManifest);
    }
    Ok(Workspace {
        repository: repository.into(),
        revision: revision.into(),
        manifest,
    })
}

fn revision_manifest(
    repository: &str,
    revision: &str,
    mut read: impl FnMut(&str) -> Result<Vec<u8>, Error>,
) -> Result<Vec<u8>, Error> {
    let current =
        format!("repos/{repository}/contents/projects/homelab/homelab.json?ref={revision}");
    let legacy = format!("repos/{repository}/contents/homelab.json?ref={revision}");
    read(&current).or_else(|_| read(&legacy))
}

#[cfg(test)]
mod revision_manifest_tests {
    use super::*;

    #[test]
    fn old_approved_revision_uses_root_manifest_after_project_path_is_absent() {
        let revision = "a".repeat(40);
        let mut paths = Vec::new();
        let bytes = revision_manifest("example/config", &revision, |path| {
            paths.push(path.to_owned());
            if path.contains("/projects/homelab/") {
                Err(Error::Fetch)
            } else {
                Ok(b"old approved manifest".to_vec())
            }
        })
        .unwrap();
        assert_eq!(bytes, b"old approved manifest");
        assert_eq!(
            paths,
            [
                format!(
                    "repos/example/config/contents/projects/homelab/homelab.json?ref={revision}"
                ),
                format!("repos/example/config/contents/homelab.json?ref={revision}"),
            ]
        );
    }
}
fn binding(path: &Path) -> Result<Option<Binding>, Error> {
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags(
            rustix::fs::OFlags::NOFOLLOW.bits() as i32 | rustix::fs::OFlags::NONBLOCK.bits() as i32,
        )
        .open(path)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::State),
    };
    let m = file.metadata().map_err(|_| Error::State)?;
    if !m.is_file()
        || m.uid() != rustix::process::geteuid().as_raw()
        || m.mode() & 0o077 != 0
        || m.len() > 4096
    {
        return Err(Error::State);
    }
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::State)?;
    let b: Binding = serde_json::from_slice(&bytes).map_err(|_| Error::State)?;
    if b.schema != 1 || !valid_repository(&b.repository) {
        return Err(Error::State);
    }
    Ok(Some(b))
}
pub fn load(path: &Path) -> Result<Option<Workspace>, Error> {
    binding(path)?.map(|b| fetch(&b.repository)).transpose()
}
pub fn attached_repository(path: &Path) -> Result<Option<String>, Error> {
    binding(path).map(|binding| binding.map(|binding| binding.repository))
}
pub fn attach(repository: &str, path: &Path) -> Result<Workspace, Error> {
    if let Some(b) = binding(path)? {
        if b.repository != repository {
            return Err(Error::DifferentRepository);
        }
        return fetch(repository);
    }
    let workspace = fetch(repository)?;
    let parent = path.parent().ok_or(Error::State)?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)
        .map_err(|_| Error::State)?;
    let m = fs::symlink_metadata(parent).map_err(|_| Error::State)?;
    if !m.is_dir() || m.uid() != rustix::process::geteuid().as_raw() || m.mode() & 0o077 != 0 {
        return Err(Error::State);
    }
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|_| Error::State)?;
    serde_json::to_writer(
        &mut f,
        &Binding {
            schema: 1,
            repository: repository.into(),
        },
    )
    .map_err(|_| Error::State)?;
    f.flush()
        .and_then(|_| f.sync_all())
        .map_err(|_| Error::State)?;
    File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|_| Error::State)?;
    Ok(workspace)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_binding_cannot_be_reused_for_another_selection() {
        let revision = "a".repeat(40);
        let binding = setup_binding("example/config", "macbook", &revision).unwrap();
        assert_eq!(binding.len(), 64);
        assert_eq!(
            Some(binding.clone()),
            setup_binding("example/config", "macbook", &revision)
        );
        for changed in [
            setup_binding("example/other", "macbook", &revision),
            setup_binding("example/config", "mini", &revision),
            setup_binding("example/config", "macbook", &"b".repeat(40)),
        ] {
            assert_ne!(Some(binding.clone()), changed);
        }
        assert_eq!(
            None,
            setup_binding("example/config\nother", "macbook", &revision)
        );
        assert_eq!(None, setup_binding("example/config", "macbook", "main"));
    }
    #[test]
    fn rejects_repository_shell_or_url_input() {
        for s in [
            "https://github.com/example/config",
            "a/b/c",
            "a/--help",
            "a/b?token=x",
            "../b",
            "a/$(id)",
        ] {
            assert!(!valid_repository(s));
        }
        assert!(valid_repository("example/mac-config"));
    }
    #[test]
    fn rejects_paths_and_injections_as_hosts() {
        for s in ["../host", "-host", "host;id", "Host", "host_2", ""] {
            assert!(!valid_host(s));
        }
        assert!(valid_host("build-mac"));
    }
    #[test]
    fn binding_rejects_links_and_cross_repo_without_network() {
        use std::os::unix::fs::symlink;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("repository.json");
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&p)
            .unwrap();
        f.write_all(br#"{"schema":1,"repository":"example/first"}"#)
            .unwrap();
        assert_eq!(
            attach("example/second", &p).unwrap_err(),
            Error::DifferentRepository
        );
        let link = d.path().join("link");
        symlink(&p, &link).unwrap();
        assert!(matches!(load(&link), Err(Error::State)));
    }
}

#[cfg(test)]
mod repository_input_tests {
    use super::*;
    #[test]
    fn accepts_repository_names_and_github_browser_or_clone_urls() {
        for input in [
            "example/config",
            " https://github.com/example/config/ ",
            "https://github.com/example/config.git",
            "https://github.com/example/config?tab=readme-ov-file",
            "git@github.com:example/config.git",
            "ssh://git@github.com/example/config.git",
        ] {
            assert_eq!(parse_repository(input).unwrap(), "example/config");
        }
        for input in [
            "https://github.com.evil.test/example/config",
            "https://github.com@evil.test/example/config",
            "example/config/tree/main",
            "https://gitlab.com/example/config",
            "../config",
            "example/config\nmalicious",
        ] {
            assert!(parse_repository(input).is_err());
        }
    }
}

#[cfg(test)]
mod deployment_policy_tests {
    use super::*;
    fn workspace(current: bool, revision: char) -> Workspace {
        let mut value: serde_json::Value =
            serde_json::from_str(include_str!("../examples/homelab.json")).unwrap();
        if current {
            value["schema"] = serde_json::json!(3);
            value["deployment"] =
                serde_json::json!({"repository":"example/config", "branch":"deploy/homelab"});
        }
        Workspace {
            repository: "example/config".into(),
            revision: revision.to_string().repeat(40),
            manifest: parse(&serde_json::to_vec(&value).unwrap()).unwrap(),
        }
    }
    #[test]
    fn ordinary_main_commits_select_only_the_deployed_revision() {
        let selected =
            select_deployment(workspace(true, 'b'), || Ok(workspace(true, 'a'))).unwrap();
        assert_eq!(selected.revision, "a".repeat(40));
        assert_eq!(selected.manifest.deployment_branch(), "deploy/homelab");
        let legacy = select_deployment(workspace(false, 'b'), || {
            panic!("legacy must not look up deployment")
        })
        .unwrap();
        assert_eq!(legacy.revision, "b".repeat(40));
        assert_eq!(legacy.manifest.deployment_branch(), "main");
    }
    #[test]
    fn missing_stale_or_retargeted_deployment_never_falls_back_to_main() {
        assert!(select_deployment(workspace(true, 'b'), || Err(Error::Fetch)).is_err());
        assert!(select_deployment(workspace(true, 'b'), || Ok(workspace(false, 'a'))).is_err());
        let mut other = workspace(true, 'a');
        other.repository = "example/other".into();
        assert!(select_deployment(workspace(true, 'b'), || Ok(other)).is_err());
    }
    #[test]
    fn version_three_requires_exact_policy_and_recovery_configuration() {
        let base = serde_json::to_value(workspace(true, 'a').manifest).unwrap();
        for (field, value) in [
            ("/deployment", serde_json::Value::Null),
            ("/deployment/branch", serde_json::json!("main")),
            ("/deployment/repository", serde_json::json!("-bad/name")),
            ("/onePassword", serde_json::Value::Null),
            ("/schema", serde_json::json!(2)),
        ] {
            let mut invalid = base.clone();
            *invalid.pointer_mut(field).unwrap() = value;
            assert!(
                parse(&serde_json::to_vec(&invalid).unwrap()).is_err(),
                "{field}"
            );
        }
        let mut current = workspace(true, 'a').manifest;
        current.deployment.as_mut().unwrap().repository = "example/other".into();
        assert!(current.validate().is_ok()); // Matching the fetched repository is checked at fetch_revision.
    }
}
