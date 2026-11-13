//! Register target-generated public keys without exporting the operator's GitHub login.
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("The repository, host or deploy public key is invalid.")]
    InvalidRequest,
    #[error("GitHub deploy keys could not be read. Sign in with repository administration access.")]
    Access,
    #[error("An existing deploy key conflicts with this setup. It was not changed.")]
    Conflict,
    #[error("Deploy-key creation may have succeeded. Reconcile this attempt before retrying.")]
    Unconfirmed,
    #[error(
        "The deploy-key receipt is unsafe, unavailable or in use. Existing state was preserved."
    )]
    State,
    #[error(
        "GitHub rejected deploy-key creation. Check repository permissions or policy, then retry."
    )]
    Rejected,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Registration {
    pub id: u64,
    pub title: String,
    pub key: String,
    pub read_only: bool,
}

#[derive(Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub repository: String,
    pub host: String,
    pub public_key: String,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema: u8,
    request: Request,
    registration: Option<Registration>,
    #[serde(default)]
    rejected: bool,
}

struct ReceiptLock(File);

impl Drop for ReceiptLock {
    fn drop(&mut self) {
        let _ = rustix::fs::flock(&self.0, rustix::fs::FlockOperation::Unlock);
    }
}

/// Persist the intent before GitHub can create a key. An interrupted attempt is
/// reconciled by public identity, never retried as a second creation request.
pub fn register_saved(
    registry: &impl Registry,
    request: &Request,
    path: &Path,
) -> Result<Registration, Error> {
    let request = Request {
        public_key: request.key()?,
        ..request.clone()
    };
    let parent = path.parent().ok_or(Error::State)?;
    let metadata = std::fs::symlink_metadata(parent).map_err(|_| Error::State)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::State);
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path.with_extension("lock"))
        .map_err(|_| Error::State)?;
    check_private(&lock)?;
    rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| Error::State)?;
    let _lock = ReceiptLock(lock);
    let existing = match OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
    {
        Ok(file) => {
            check_private(&file)?;
            let mut bytes = Vec::new();
            file.take(8193)
                .read_to_end(&mut bytes)
                .map_err(|_| Error::State)?;
            if bytes.len() > 8192 {
                return Err(Error::State);
            }
            let receipt: Receipt = serde_json::from_slice(&bytes).map_err(|_| Error::State)?;
            if receipt.schema != 1 || receipt.request != request {
                return Err(Error::Conflict);
            }
            Some(receipt)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(_) => return Err(Error::State),
    };
    let mut receipt = existing.unwrap_or(Receipt {
        schema: 1,
        request,
        registration: None,
        rejected: false,
    });
    let fresh = !path.try_exists().map_err(|_| Error::State)?;
    let registration = if fresh || receipt.rejected {
        match register(registry, &receipt.request, Intent::ReconcileOnly) {
            Ok(registration) => registration,
            Err(Error::Unconfirmed) => {
                receipt.rejected = false;
                save_receipt(path, &receipt, fresh)?;
                let created = match registry.create(&receipt.request) {
                    Ok(created) => created,
                    Err(Error::Rejected) => {
                        receipt.rejected = true;
                        save_receipt(path, &receipt, false)?;
                        return Err(Error::Rejected);
                    }
                    Err(_) => return Err(Error::Unconfirmed),
                };
                verified(created, &receipt.request, &receipt.request.public_key)
                    .map_err(|_| Error::Unconfirmed)?
            }
            Err(error) => return Err(error),
        }
    } else {
        register(registry, &receipt.request, Intent::ReconcileOnly)?
    };
    if receipt
        .registration
        .as_ref()
        .is_some_and(|saved| *saved != registration)
    {
        return Err(Error::Conflict);
    }
    receipt.registration = Some(registration.clone());
    receipt.rejected = false;
    save_receipt(
        path,
        &receipt,
        !path.try_exists().map_err(|_| Error::State)?,
    )?;
    Ok(registration)
}

fn check_private(file: &File) -> Result<(), Error> {
    let metadata = file.metadata().map_err(|_| Error::State)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o600
        || metadata.len() > 8192
    {
        return Err(Error::State);
    }
    Ok(())
}

fn save_receipt(path: &Path, receipt: &Receipt, first: bool) -> Result<(), Error> {
    let parent = path.parent().ok_or(Error::State)?;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
    serde_json::to_writer(&mut file, receipt).map_err(|_| Error::State)?;
    file.flush()
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| Error::State)?;
    if first {
        file.persist_noclobber(path)
    } else {
        file.persist(path)
    }
    .map_err(|_| Error::State)?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::State)
}

impl Request {
    fn title(&self) -> String {
        let key = crate::ssh_identity::canonical_key(&self.public_key).unwrap_or_default();
        let digest: String = Sha256::digest(key.as_bytes())[..8]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        format!("homelab:{}:{digest}", self.host)
    }

    fn key(&self) -> Result<String, Error> {
        if !crate::config::valid_repository(&self.repository)
            || !crate::config::valid_host(&self.host)
            || self.public_key.len() > 1024
        {
            return Err(Error::InvalidRequest);
        }
        crate::ssh_identity::canonical_key(&self.public_key)
            .filter(|key| key.starts_with("ssh-ed25519 "))
            .ok_or(Error::InvalidRequest)
    }
}

pub trait Registry {
    fn list(&self, repository: &str) -> Result<Vec<Registration>, Error>;
    fn create(&self, request: &Request) -> Result<Registration, Error>;
}

/// The caller must durably record its creation attempt before using `CreateRecorded`.
/// After a lost response, use `ReconcileOnly`; absence is not proof that no write ran.
#[derive(Clone, Copy)]
pub enum Intent {
    CreateRecorded,
    ReconcileOnly,
}

pub fn register(
    registry: &impl Registry,
    request: &Request,
    intent: Intent,
) -> Result<Registration, Error> {
    let key = request.key()?;
    let entries = registry.list(&request.repository)?;
    let mut matches = entries.iter().filter(|entry| {
        entry.title == request.title()
            || crate::ssh_identity::canonical_key(&entry.key).as_deref() == Some(&key)
    });
    if let Some(entry) = matches.next() {
        if matches.next().is_some() {
            return Err(Error::Conflict);
        }
        return verified(entry.clone(), request, &key);
    }
    if matches!(intent, Intent::ReconcileOnly) {
        return Err(Error::Unconfirmed);
    }
    let created = registry.create(request).map_err(|error| {
        if error == Error::Rejected {
            error
        } else {
            Error::Unconfirmed
        }
    })?;
    verified(created, request, &key).map_err(|_| Error::Unconfirmed)
}

fn verified(entry: Registration, request: &Request, key: &str) -> Result<Registration, Error> {
    if entry.id == 0
        || !entry.read_only
        || entry.title != request.title()
        || crate::ssh_identity::canonical_key(&entry.key).as_deref() != Some(key)
    {
        return Err(Error::Conflict);
    }
    Ok(entry)
}

pub struct GitHub {
    executable: PathBuf,
}

impl GitHub {
    pub fn new(executable: &Path) -> Self {
        Self {
            executable: executable.into(),
        }
    }

    fn command(&self, endpoint: &str) -> Command {
        let mut command = Command::new(&self.executable);
        // Keep gh's authenticated desktop session local. No token is extracted.
        command
            .args(["api", "--hostname", "github.com", endpoint])
            .env("GH_PROMPT_DISABLED", "1")
            .stdin(Stdio::null());
        command
    }
}

impl Registry for GitHub {
    fn list(&self, repository: &str) -> Result<Vec<Registration>, Error> {
        if !crate::config::valid_repository(repository) {
            return Err(Error::InvalidRequest);
        }
        let mut command = self.command(&format!("repos/{repository}/keys?per_page=100"));
        command.args(["--paginate", "--slurp"]);
        let output = crate::provider_diagnostics::observe(
            crate::provider_diagnostics::Operation::GitHubRead,
            crate::process::capture(&mut command, Duration::from_secs(60)),
        )
        .map_err(|_| Error::Access)?;
        if !output.status.success() {
            return Err(Error::Access);
        }
        let pages: Vec<Vec<Registration>> =
            serde_json::from_slice(&output.stdout).map_err(|_| {
                crate::provider_diagnostics::invalid_response(
                    crate::provider_diagnostics::Operation::GitHubRead,
                );
                Error::Access
            })?;
        Ok(pages.into_iter().flatten().collect())
    }

    fn create(&self, request: &Request) -> Result<Registration, Error> {
        let key = request.key()?;
        let mut command = self.command(&format!("repos/{}/keys", request.repository));
        command
            .args(["--method", "POST", "--raw-field"])
            .arg(format!("title={}", request.title()))
            .arg("--raw-field")
            .arg(format!("key={key}"))
            .args(["--field", "read_only=true"]);
        let output = crate::provider_diagnostics::observe(
            crate::provider_diagnostics::Operation::GitHubWrite,
            crate::process::capture(&mut command, Duration::from_secs(60)),
        )
        .map_err(|_| Error::Unconfirmed)?;
        if !output.status.success() {
            let diagnostic = String::from_utf8_lossy(&output.stderr);
            return Err(
                if [400, 401, 403, 404, 422]
                    .iter()
                    .any(|status| diagnostic.contains(&format!("(HTTP {status})")))
                {
                    Error::Rejected
                } else {
                    Error::Unconfirmed
                },
            );
        }
        serde_json::from_slice(&output.stdout).map_err(|_| {
            crate::provider_diagnostics::invalid_response(
                crate::provider_diagnostics::Operation::GitHubWrite,
            );
            Error::Unconfirmed
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn github_list_accepts_unprojected_paginated_responses() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("gh");
        std::fs::write(&executable, r#"#!/bin/sh
[ "$#" = 6 ] || exit 1
[ "$1" = api ] && [ "$2" = --hostname ] && [ "$3" = github.com ] || exit 1
[ "$4" = 'repos/example/config/keys?per_page=100' ] || exit 1
[ "$5" = --paginate ] && [ "$6" = --slurp ] || exit 1
printf '%s' '[[{"id":7,"title":"first","key":"ssh-ed25519 first","read_only":true,"url":"ignored","verified":true}],[{"id":8,"title":"second","key":"ssh-ed25519 second","read_only":false,"created_at":"ignored"}]]'
"#).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        let entries = GitHub::new(&executable).list("example/config").unwrap();
        assert_eq!(
            entries.iter().map(|entry| entry.id).collect::<Vec<_>>(),
            vec![7, 8]
        );
        assert!(entries[0].read_only);
        assert!(!entries[1].read_only);
    }

    #[test]
    fn dropping_receipt_guard_unlocks_even_when_a_duplicate_descriptor_survives() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.path().join("deploy-key.json");
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(path.with_extension("lock"))
            .unwrap();
        rustix::fs::flock(&file, rustix::fs::FlockOperation::NonBlockingLockExclusive).unwrap();
        let guard = ReceiptLock(file);
        // A child retaining the open file description must not retain guard ownership.
        let retained = guard.0.try_clone().unwrap();
        let registry = fake(vec![]);

        assert_eq!(
            register_saved(&registry, &request(), &path),
            Err(Error::State)
        );
        assert_eq!(registry.creates.get(), 0);
        drop(guard);

        assert_eq!(register_saved(&registry, &request(), &path).unwrap().id, 7);
        assert_eq!(registry.creates.get(), 1);
        assert!(retained.metadata().is_ok());
        drop(retained);
    }

    struct Fake {
        entries: Vec<Registration>,
        creates: Cell<usize>,
        lose_response: bool,
        reject: bool,
    }
    impl Registry for Fake {
        fn list(&self, _: &str) -> Result<Vec<Registration>, Error> {
            Ok(self.entries.clone())
        }
        fn create(&self, request: &Request) -> Result<Registration, Error> {
            self.creates.set(self.creates.get() + 1);
            if self.reject {
                return Err(Error::Rejected);
            }
            if self.lose_response {
                return Err(Error::Unconfirmed);
            }
            Ok(Registration {
                id: 7,
                title: request.title(),
                key: request.key()?,
                read_only: true,
            })
        }
    }
    fn request() -> Request {
        Request {
            repository: "example/config".into(),
            host: "test-mac".into(),
            public_key: "ssh-ed25519 AAAA comment".into(),
        }
    }
    fn fake(entries: Vec<Registration>) -> Fake {
        Fake {
            entries,
            creates: Cell::new(0),
            lose_response: false,
            reject: false,
        }
    }

    #[test]
    fn resume_reuses_matching_key_without_another_write() {
        let first = fake(vec![]);
        let entry = register(&first, &request(), Intent::CreateRecorded).unwrap();
        let resumed = fake(vec![entry.clone()]);
        assert_eq!(
            register(&resumed, &request(), Intent::ReconcileOnly).unwrap(),
            entry
        );
        assert_eq!(resumed.creates.get(), 0);
    }

    #[test]
    fn absent_key_after_uncertain_write_never_creates_again() {
        let registry = Fake {
            lose_response: true,
            ..fake(vec![])
        };
        assert_eq!(
            register(&registry, &request(), Intent::CreateRecorded),
            Err(Error::Unconfirmed)
        );
        assert_eq!(
            register(&registry, &request(), Intent::ReconcileOnly),
            Err(Error::Unconfirmed)
        );
        assert_eq!(registry.creates.get(), 1);
    }

    #[test]
    fn durable_receipt_reconciles_a_lost_response_and_rejects_rebinding() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.path().join("deploy-key.json");
        let uncertain = Fake {
            lose_response: true,
            ..fake(vec![])
        };
        assert_eq!(
            register_saved(&uncertain, &request(), &path),
            Err(Error::Unconfirmed)
        );
        assert_eq!(
            register_saved(&uncertain, &request(), &path),
            Err(Error::Unconfirmed)
        );
        assert_eq!(uncertain.creates.get(), 1);
        let entry = Registration {
            id: 7,
            title: request().title(),
            key: request().key().unwrap(),
            read_only: true,
        };
        let resumed = fake(vec![entry.clone()]);
        assert_eq!(register_saved(&resumed, &request(), &path).unwrap(), entry);
        assert_eq!(resumed.creates.get(), 0);
        let mut different = request();
        different.repository = "example/other".into();
        assert_eq!(
            register_saved(&resumed, &different, &path),
            Err(Error::Conflict)
        );
        let replaced = fake(vec![Registration { id: 8, ..entry }]);
        assert_eq!(
            register_saved(&replaced, &request(), &path),
            Err(Error::Conflict)
        );
    }

    #[test]
    fn unsafe_receipt_is_rejected_without_creating_a_key() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.path().join("deploy-key.json");
        symlink(directory.path().join("missing"), &path).unwrap();
        let registry = fake(vec![]);
        assert_eq!(
            register_saved(&registry, &request(), &path),
            Err(Error::State)
        );
        assert_eq!(registry.creates.get(), 0);
    }

    #[test]
    fn definite_rejection_can_retry_but_lock_contention_cannot_write() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.path().join("deploy-key.json");
        let rejected = Fake {
            reject: true,
            ..fake(vec![])
        };
        assert_eq!(
            register_saved(&rejected, &request(), &path),
            Err(Error::Rejected)
        );
        let allowed = fake(vec![]);
        assert_eq!(register_saved(&allowed, &request(), &path).unwrap().id, 7);
        assert_eq!(allowed.creates.get(), 1);
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .open(path.with_extension("lock"))
            .unwrap();
        rustix::fs::flock(&lock, rustix::fs::FlockOperation::NonBlockingLockExclusive).unwrap();
        assert_eq!(
            register_saved(&allowed, &request(), &path),
            Err(Error::State)
        );
        assert_eq!(allowed.creates.get(), 1);
    }

    #[test]
    fn writable_wrong_and_duplicate_keys_are_not_adopted() {
        let entry = Registration {
            id: 7,
            title: request().title(),
            key: request().key().unwrap(),
            read_only: true,
        };
        for entries in [
            vec![Registration {
                read_only: false,
                ..entry.clone()
            }],
            vec![Registration {
                key: "ssh-ed25519 BBBB".into(),
                ..entry.clone()
            }],
            vec![entry.clone(), entry],
        ] {
            let registry = fake(entries);
            assert_eq!(
                register(&registry, &request(), Intent::CreateRecorded),
                Err(Error::Conflict)
            );
            assert_eq!(registry.creates.get(), 0);
        }
    }

    #[test]
    fn rejects_private_key_and_repository_injection_before_provider_access() {
        let registry = fake(vec![]);
        let mut invalid = request();
        invalid.public_key = "-----BEGIN OPENSSH PRIVATE KEY-----".into();
        assert_eq!(
            register(&registry, &invalid, Intent::CreateRecorded),
            Err(Error::InvalidRequest)
        );
        invalid = request();
        invalid.repository = "../other?token=x".into();
        assert_eq!(
            register(&registry, &invalid, Intent::CreateRecorded),
            Err(Error::InvalidRequest)
        );
        assert_eq!(registry.creates.get(), 0);
    }
}
