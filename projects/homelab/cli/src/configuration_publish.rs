use super::*;

pub enum Publication {
    Published {
        workspace: Workspace,
        html_url: String,
    },
    PullRequest(PullRequest),
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema: u8,
    proposal: String,
    revision: String,
    changes: Changes,
}

fn read_receipt(path: &Path, original: &Changes) -> Result<Option<Receipt>, Error> {
    private_parent(path)?;
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::State),
    };
    let metadata = file.metadata().map_err(|_| Error::State)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o077 != 0
        || metadata.len() > 70_000
    {
        return Err(Error::State);
    }
    let mut bytes = Vec::new();
    file.take(70_001)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::State)?;
    if bytes.len() > 70_000 {
        return Err(Error::State);
    }
    let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| Error::State)?;
    receipt.changes.validate()?;
    if receipt.schema != 1
        || receipt.proposal != original.branch()
        || !config::valid_revision(&receipt.revision)
        || receipt.changes.repository != original.repository
        || receipt.changes.host != original.host
        || receipt.changes.manifest.schema != original.manifest.schema
        || receipt.changes.manifest.deployment != original.manifest.deployment
        || receipt.changes.manifest.one_password != original.manifest.one_password
        || receipt.changes.manifest.tailscale != original.manifest.tailscale
        || receipt.changes.manifest.hosts.get(&original.host)
            != original.manifest.hosts.get(&original.host)
        || receipt
            .changes
            .files
            .get(&format!("projects/homelab/secrets/{}.sops.yaml", original.host))
            != original
                .files
                .get(&format!("projects/homelab/secrets/{}.sops.yaml", original.host))
    {
        return Err(Error::Conflict);
    }
    Ok(Some(receipt))
}

fn save_receipt(path: &Path, receipt: &Receipt) -> Result<(), Error> {
    private_parent(path)?;
    let parent = path.parent().ok_or(Error::State)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
    serde_json::to_writer(&mut file, receipt).map_err(|_| Error::State)?;
    file.as_file().sync_all().map_err(|_| Error::State)?;
    file.persist_noclobber(path).map_err(|_| Error::State)?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::State)
}

fn main_branch(api: &impl Api, repository: &str) -> Result<(String, bool), Error> {
    let branch = api.json("GET", &format!("repos/{repository}/branches/main"), None)?;
    Ok((
        sha(&branch, "/commit/sha")?,
        branch
            .get("protected")
            .and_then(Value::as_bool)
            .ok_or(Error::Access)?,
    ))
}

fn requires_pull_request(api: &impl Api, repository: &str, protected: bool) -> Result<bool, Error> {
    // GitHub reports an unprotected branch even where private-repository rules
    // APIs are unavailable on the account's plan. Do not infer this from a 403.
    if !protected {
        return Ok(false);
    }
    let mut pull_request = false;
    let mut constraints = false;
    let mut observed_rule = false;
    for page in 1..=10 {
        let rules = api.json(
            "GET",
            &format!("repos/{repository}/rules/branches/main?per_page=100&page={page}"),
            None,
        )?;
        let rules = rules.as_array().ok_or(Error::Access)?;
        for rule in rules {
            observed_rule = true;
            match rule
                .get("type")
                .and_then(Value::as_str)
                .ok_or(Error::Access)?
            {
                "pull_request" => pull_request = true,
                "deletion" | "non_fast_forward" => (),
                _ => constraints = true,
            }
        }
        if rules.len() < 100 {
            break;
        }
        if page == 10 {
            return Err(Error::Rules);
        }
    }
    match api.json(
        "GET",
        &format!("repos/{repository}/branches/main/protection"),
        None,
    ) {
        Ok(protection) => {
            if protection
                .get("required_pull_request_reviews")
                .is_some_and(|value| value.is_object())
            {
                pull_request = true;
            } else {
                constraints = true;
            }
        }
        Err(Error::Missing) => (),
        Err(error) => return Err(error),
    }
    if pull_request {
        Ok(true)
    } else if constraints || !observed_rule {
        Err(Error::Rules)
    } else {
        Ok(false)
    }
}

fn existing_pull(api: &impl Api, changes: &Changes) -> Result<bool, Error> {
    let owner = changes.repository.split('/').next().ok_or(Error::Invalid)?;
    let response = api.json(
        "GET",
        &format!(
            "repos/{}/pulls?state=all&head={owner}:{}&base=main",
            changes.repository,
            changes.branch()
        ),
        None,
    )?;
    let pulls = response.as_array().ok_or(Error::Access)?;
    if pulls.len() > 1 {
        return Err(Error::Conflict);
    }
    Ok(!pulls.is_empty())
}

fn manifest_at(api: &impl Api, repository: &str, revision: &str) -> Result<Manifest, Error> {
    let manifest: Manifest = serde_json::from_slice(&api.raw(&format!(
        "repos/{repository}/contents/projects/homelab/homelab.json?ref={revision}"
    ))?)
    .map_err(|_| Error::Invalid)?;
    manifest.validate().map_err(|_| Error::Invalid)?;
    if manifest
        .deployment
        .as_ref()
        .is_some_and(|policy| policy.repository != repository)
    {
        return Err(Error::Invalid);
    }
    Ok(manifest)
}

fn rebase(api: &impl Api, changes: &Changes, revision: &str) -> Result<Changes, Error> {
    let original = manifest_at(api, &changes.repository, &changes.base)?;
    let current = manifest_at(api, &changes.repository, revision)?;
    if original.hosts.get(&changes.host) != current.hosts.get(&changes.host)
        || original.tailscale != current.tailscale
        || original.one_password != current.one_password
        || original.schema != current.schema
        || original.deployment != current.deployment
    {
        return Err(Error::Conflict);
    }
    let host_rules = |revision: &str| -> Result<Vec<Value>, Error> {
        let bytes = api.raw(&format!(
            "repos/{}/contents/.sops.yaml?ref={revision}",
            changes.repository
        ))?;
        let rules: Value = serde_yaml_ng::from_slice(&bytes).map_err(|_| Error::Invalid)?;
        let pattern = format!("^projects/homelab/secrets/{}\\.sops\\.yaml$", changes.host);
        Ok(rules
            .get("creation_rules")
            .and_then(Value::as_array)
            .ok_or(Error::Invalid)?
            .iter()
            .filter(|rule| rule.get("path_regex").and_then(Value::as_str) == Some(pattern.as_str()))
            .cloned()
            .collect())
    };
    if host_rules(&changes.base)? != host_rules(revision)? {
        return Err(Error::Conflict);
    }
    let rules: Value =
        serde_yaml_ng::from_str(&changes.files[".sops.yaml"]).map_err(|_| Error::Invalid)?;
    let recipients: Vec<_> = rules
        .pointer("/creation_rules/0/age")
        .and_then(Value::as_str)
        .ok_or(Error::Invalid)?
        .split(',')
        .collect();
    let key = changes.manifest.hosts[&changes.host]
        .authorized_keys
        .last()
        .ok_or(Error::Invalid)?;
    let rebased = prepare_inner(
        api,
        &Workspace {
            repository: changes.repository.clone(),
            revision: revision.into(),
            manifest: current,
        },
        &changes.host,
        key,
        Encryption {
            ciphertext: &changes.files[&format!("projects/homelab/secrets/{}.sops.yaml", changes.host)],
            host_recipient: recipients[0],
            recovery_recipient: recipients[1],
        },
        changes.previous_ciphertext.as_deref(),
    )?;
    if rebased.manifest.hosts.get(&changes.host) != changes.manifest.hosts.get(&changes.host) {
        return Err(Error::Conflict);
    }
    Ok(rebased)
}

fn published(api: &impl Api, receipt: &Receipt) -> Result<Option<Workspace>, Error> {
    let comparison = api.json(
        "GET",
        &format!(
            "repos/{}/compare/{}...main",
            receipt.changes.repository, receipt.revision
        ),
        None,
    )?;
    if !matches!(
        comparison.get("status").and_then(Value::as_str),
        Some("ahead" | "identical")
    ) {
        return Ok(None);
    }
    // Verify the immutable commit, not today's main, which can already be newer.
    for (path, expected) in &receipt.changes.files {
        if api.raw(&format!(
            "repos/{}/contents/{path}?ref={}",
            receipt.changes.repository, receipt.revision
        ))? != expected.as_bytes()
        {
            return Err(Error::Conflict);
        }
    }
    Ok(Some(Workspace {
        repository: receipt.changes.repository.clone(),
        revision: receipt.revision.clone(),
        manifest: receipt.changes.manifest.clone(),
    }))
}

fn result(workspace: Workspace) -> Publication {
    let html_url = format!(
        "https://github.com/{}/commit/{}",
        workspace.repository, workspace.revision
    );
    Publication::Published {
        workspace,
        html_url,
    }
}

/// Called after Begin setup authorizes publication. Never force-push or bypass a
/// known PR requirement. A durable candidate reconciles uncertain responses.
pub fn publish_configuration(
    api: &impl Api,
    changes: &Changes,
    receipt_path: &Path,
) -> Result<Publication, Error> {
    changes.validate()?;
    private_parent(receipt_path)?;
    if existing_pull(api, changes)? {
        return publish(api, changes).map(Publication::PullRequest);
    }
    let receipt = if let Some(receipt) = read_receipt(receipt_path, changes)? {
        receipt
    } else {
        validate_delta(api, changes)?;
        let (head, protected) = main_branch(api, &changes.repository)?;
        if requires_pull_request(api, &changes.repository, protected)? {
            return publish(api, changes).map(Publication::PullRequest);
        }
        let candidate = rebase(api, changes, &head)?;
        let root = format!("repos/{}", changes.repository);
        let base = api.json("GET", &format!("{root}/git/commits/{head}"), None)?;
        let entries: Vec<Value> = candidate
            .files
            .iter()
            .map(|(path, content)| {
                json!({
                    "path": path,
                    "mode": "100644",
                    "type": "blob",
                    "content": content,
                })
            })
            .collect();
        let tree_request = json!({
            "base_tree": sha(&base, "/tree/sha")?,
            "tree": entries,
        });
        let tree = api.json("POST", &format!("{root}/git/trees"), Some(tree_request))?;
        let commit_request = json!({
            "message": format!("Enroll {}", changes.host),
            "tree": sha(&tree, "/sha")?,
            "parents": [head],
        });
        let commit = api.json("POST", &format!("{root}/git/commits"), Some(commit_request))?;
        let receipt = Receipt {
            schema: 1,
            proposal: changes.branch(),
            revision: sha(&commit, "/sha")?,
            changes: candidate,
        };
        save_receipt(receipt_path, &receipt)?;
        receipt
    };
    validate_delta(api, &receipt.changes)?;
    if let Some(workspace) = published(api, &receipt)? {
        return Ok(result(workspace));
    }
    let (head, protected) = main_branch(api, &changes.repository)?;
    if head != receipt.changes.base {
        return Err(Error::Conflict);
    }
    if requires_pull_request(api, &changes.repository, protected)? {
        return publish(api, changes).map(Publication::PullRequest);
    }
    let _ = api.json(
        "PATCH",
        &format!("repos/{}/git/refs/heads/main", changes.repository),
        Some(json!({"sha":receipt.revision,"force":false})),
    );
    match published(api, &receipt)? {
        Some(workspace) => Ok(result(workspace)),
        None => Err(Error::Unconfirmed),
    }
}

/// Resolve an uncertain direct update before archiving an expired preparation.
/// The enclosing session archival also preserves publication.json as evidence.
pub fn resolve_publication_for_renewal(
    api: &impl Api,
    changes: &Changes,
    receipt_path: &Path,
) -> Result<Option<Workspace>, Error> {
    changes.validate()?;
    if let Some(receipt) = read_receipt(receipt_path, changes)? {
        return published(api, &receipt)?
            .map(Some)
            .ok_or(Error::Unconfirmed);
    }
    resolve_for_renewal(api, changes)
}
