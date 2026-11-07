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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous: Option<Box<Selection>>,
}

impl Selection {
    pub fn matches(&self, repository: &str, host: &str, original: &str) -> bool {
        let mut chain = self.previous.as_deref();
        let mut count = 0;
        while let Some(previous) = chain {
            count += 1;
            if count > 4 || previous.repaired_revision == self.repaired_revision {
                return false;
            }
            chain = previous.previous.as_deref();
        }
        self.schema == 1
            && self.repository == repository
            && self.host == host
            && self.original_revision == original
            && config::valid_revision(original)
            && config::valid_revision(&self.repaired_revision)
            && config::valid_revision(&self.descriptor_commit)
            && original != self.repaired_revision
            && self
                .previous
                .as_ref()
                .is_none_or(|previous| previous.matches(repository, host, original))
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
        Some(selection) => {
            match discover(
                api,
                &approved.repository,
                host,
                &selection.repaired_revision,
            )? {
                Some(mut next) => {
                    next.original_revision = approved.revision.clone();
                    next.previous = Some(Box::new(selection));
                    next
                }
                None => selection,
            }
        }
        None => match discover(api, &approved.repository, host, &approved.revision)? {
            Some(selection) => selection,
            None => return Ok((approved, None)),
        },
    };
    if !selection.matches(&approved.repository, host, &approved.revision) {
        return Err(Error::Conflict);
    }
    for from in std::iter::once(approved.revision.as_str()).chain(
        selection
            .previous
            .as_ref()
            .map(|previous| previous.repaired_revision.as_str()),
    ) {
        let base = format!("repos/{}", approved.repository);
        let comparison = api.json(
            "GET",
            &format!("{base}/compare/{}...{}", from, selection.repaired_revision),
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
            let before = api.raw(&format!("{base}/contents/{path}?ref={}", from))?;
            let after = api.raw(&format!(
                "{base}/contents/{path}?ref={}",
                selection.repaired_revision
            ))?;
            if before != after {
                return Err(Error::Conflict);
            }
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

fn discover(
    api: &impl Api,
    repository: &str,
    host: &str,
    from: &str,
) -> Result<Option<Selection>, Error> {
    let head = api.json(
        "GET",
        &format!("repos/{repository}/git/ref/heads/main"),
        None,
    )?;
    let commit = head["object"]["sha"]
        .as_str()
        .filter(|sha| config::valid_revision(sha))
        .ok_or(Error::Invalid)?;
    let bytes = match api.raw(&format!(
        "repos/{repository}/contents/setup-repairs/{from}.json?ref={commit}"
    )) {
        Err(Error::Missing) => return Ok(None),
        result => result?,
    };
    let descriptor: Descriptor = serde_json::from_slice(&bytes).map_err(|_| Error::Invalid)?;
    let selection = Selection {
        schema: descriptor.schema,
        repository: descriptor.repository,
        host: descriptor.host,
        original_revision: descriptor.original_revision,
        repaired_revision: descriptor.repaired_revision,
        descriptor_commit: commit.into(),
        previous: None,
    };
    if !selection.matches(repository, host, from) {
        return Err(Error::Conflict);
    }
    Ok(Some(selection))
}
