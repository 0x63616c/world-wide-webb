//! Explicit Git-published repairs preserve the original enrollment and credentials.
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::config::{self, Workspace};
use crate::configuration_pr::{Api, Error};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Selection {
    pub schema: u8,
    pub repository: String,
    pub host: String,
    pub original_revision: String,
    pub repaired_revision: String,
    pub descriptor_commit: String,
}

impl Selection {
    pub fn matches(&self, repository: &str, host: &str, original: &str) -> bool {
        self.schema == 1
            && self.repository == repository
            && self.host == host
            && self.original_revision == original
            && config::valid_revision(original)
            && config::valid_revision(&self.repaired_revision)
            && config::valid_revision(&self.descriptor_commit)
            && original != self.repaired_revision
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct Descriptor {
    schema: u8,
    repository: String,
    host: String,
    original_revision: String,
    repaired_revision: String,
}

pub fn resolve(
    api: &impl Api,
    root: &Path,
    approved: Workspace,
    host: &str,
) -> Result<(Workspace, Option<String>), Error> {
    let saved = crate::provisioning::approved_installation(root, host)
        .map_err(|_| Error::State)?
        .ok_or(Error::State)?;
    if saved.repository != approved.repository || saved.revision != approved.revision {
        return Err(Error::Conflict);
    }
    let selection = match saved.repair {
        Some(selection) => selection,
        None => {
            let head = api.json(
                "GET",
                &format!("repos/{}/git/ref/heads/main", approved.repository),
                None,
            )?;
            let commit = head["object"]["sha"]
                .as_str()
                .filter(|sha| config::valid_revision(sha))
                .ok_or(Error::Invalid)?;
            let descriptor = api.raw(&format!(
                "repos/{}/contents/setup-repairs/{}.json?ref={commit}",
                approved.repository, approved.revision
            ));
            let descriptor: Descriptor = match descriptor {
                Err(Error::Missing) => return Ok((approved, None)),
                Err(error) => return Err(error),
                Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?,
            };
            Selection {
                schema: descriptor.schema,
                repository: descriptor.repository,
                host: descriptor.host,
                original_revision: descriptor.original_revision,
                repaired_revision: descriptor.repaired_revision,
                descriptor_commit: commit.into(),
            }
        }
    };
    if !selection.matches(&approved.repository, host, &approved.revision) {
        return Err(Error::Conflict);
    }
    let base = format!("repos/{}", approved.repository);
    let comparison = api.json(
        "GET",
        &format!(
            "{base}/compare/{}...{}",
            approved.revision, selection.repaired_revision
        ),
        None,
    )?;
    if comparison["status"] != "ahead" {
        return Err(Error::Conflict);
    }
    // Compare raw bytes as well as parsed configuration: a repair cannot hide
    // key rotation or a desired-state change behind normalization.
    for path in [
        "homelab.json".to_owned(),
        ".sops.yaml".into(),
        "flake.lock".into(),
        "bootstrap/installer.json".into(),
        format!("secrets/{host}.sops.yaml"),
    ] {
        let before = api.raw(&format!("{base}/contents/{path}?ref={}", approved.revision))?;
        let after = api.raw(&format!(
            "{base}/contents/{path}?ref={}",
            selection.repaired_revision
        ))?;
        if before != after {
            return Err(Error::Conflict);
        }
    }
    crate::provisioning::save_installation_repair(root, host, &selection)
        .map_err(|_| Error::State)?;
    Ok((
        Workspace {
            repository: approved.repository,
            revision: selection.repaired_revision,
            manifest: approved.manifest,
        },
        Some(approved.revision),
    ))
}
