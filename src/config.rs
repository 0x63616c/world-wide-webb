//! Repository metadata is data; only an explicitly approved target executes Nix.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
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

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Host {
    pub admin_user: String,
    #[serde(rename = "adminUID")]
    pub admin_uid: u32,
    pub authorized_keys: Vec<String>,
    pub activation_ready: bool,
    pub services: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct OAuthReference {
    pub vault: String,
    pub item: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TailscaleConfig {
    pub tag: String,
    pub oauth: Option<OAuthReference>,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub schema: u8,
    pub hosts: BTreeMap<String, Host>,
    pub tailscale: Option<TailscaleConfig>,
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
pub fn valid_revision(s: &str) -> bool {
    s.len() == 40
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
impl Manifest {
    pub fn validate(&self) -> Result<(), Error> {
        let label = |s: &str| {
            !s.is_empty()
                && s.len() <= 253
                && !s.starts_with('-')
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
        };
        if self.schema != 1
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
                    if value.trim().is_empty()
                        || value.len() > 200
                        || value.starts_with('-')
                        || value.chars().any(char::is_control)
                    {
                        return Err(Error::InvalidManifest);
                    }
                }
            }
        }
        Ok(())
    }
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
    let out = crate::process::capture(&mut c, Duration::from_secs(30)).map_err(|_| Error::Fetch)?;
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
    fetch_revision(repository, &revision)
}

pub fn fetch_revision(repository: &str, revision: &str) -> Result<Workspace, Error> {
    if !valid_repository(repository) || !valid_revision(revision) {
        return Err(Error::InvalidRepository);
    }
    let manifest: Manifest = serde_json::from_slice(&api(
        &format!("repos/{repository}/contents/homelab.json?ref={revision}"),
        true,
    )?)
    .map_err(|_| Error::InvalidManifest)?;
    manifest.validate()?;
    Ok(Workspace {
        repository: repository.into(),
        revision: revision.into(),
        manifest,
    })
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
pub fn attach(repository: &str, path: &Path) -> Result<Workspace, Error> {
    if let Some(b) = binding(path)? {
        if b.repository != repository {
            return Err(Error::DifferentRepository);
        }
        return fetch(repository);
    }
    let workspace = fetch(repository)?;
    let parent = path.parent().ok_or(Error::State)?;
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
