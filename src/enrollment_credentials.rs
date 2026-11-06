//! Automatic credential preparation behind the enrollment review.
use std::path::{Path, PathBuf};

use thiserror::Error;

use crate::config::Workspace;
use crate::provisioning::{BaseTokens, Details, Session, Tools};
use crate::{provisioning, secret_store, tailscale_oauth};

const INSTALLATION_MARGIN_SECONDS: i64 = 4 * 60 * 60;

#[derive(Debug, Error)]
pub enum Error {
    #[error(
        "The repository needs a Tailscale enrollment tag and a 1Password credential reference."
    )]
    Configuration,
    #[error(transparent)]
    Preparation(#[from] provisioning::Error),
    #[error(transparent)]
    Vault(#[from] secret_store::Error),
    #[error(transparent)]
    Tailscale(#[from] tailscale_oauth::Error),
    #[error(transparent)]
    Proposal(#[from] crate::configuration_pr::Error),
    #[error(
        "The enrollment key expired after setup started. Preserve this attempt; verify the target's enrollment and bootstrap phase before resuming or renewing it."
    )]
    ExpiredStartedSetup,
    #[error(
        "Encryption failed and enrollment-key cleanup could not be confirmed. Local state was preserved for recovery."
    )]
    Cleanup,
    #[error(
        "Could not save recovery evidence for Tailscale key ID {key_id} (expiry {expires_at}; revocation confirmed: {revoked}). Preserve this ID and inspect that key before retrying."
    )]
    RecoveryReceipt {
        key_id: String,
        expires_at: i64,
        revoked: bool,
    },
}

pub fn state_directory() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".local/state/homelab/provisioning"))
}

trait EnrollmentKey {
    fn id(&self) -> &str;
    fn expires_at(&self) -> i64;
    fn secret(&self) -> &str;
    fn revoke(&self) -> Result<(), tailscale_oauth::Error>;
}

impl EnrollmentKey for tailscale_oauth::IssuedKey {
    fn id(&self) -> &str {
        self.id()
    }
    fn expires_at(&self) -> i64 {
        self.expires_at()
    }
    fn secret(&self) -> &str {
        self.secret()
    }
    fn revoke(&self) -> Result<(), tailscale_oauth::Error> {
        self.revoke()
    }
}

/// The caller obtains approval once for the complete enrollment before this call.
/// Provider authentication can prompt, but no secret value enters the UI.
pub fn prepare(
    root: &Path,
    host: &str,
    workspace: &Workspace,
    bootstrap_started: bool,
    progress: impl Fn(&str),
) -> Result<Details, Error> {
    let tailscale = workspace
        .manifest
        .tailscale
        .as_ref()
        .ok_or(Error::Configuration)?;
    let reference = tailscale.oauth.as_ref().ok_or(Error::Configuration)?;
    let tools = Tools::discover()?;
    let executable = tailscale_oauth::discover_op()?;
    let store = secret_store::OnePassword {
        executable: executable.clone(),
    };
    progress("Verifying recovery backups in 1Password");
    let vault = store.vault_id(&reference.vault)?;
    let session =
        Session::open_with_store(host, &workspace.repository, root, &tools, &store, &vault)?;
    let (credentials, issuer) = tailscale_oauth::resolve_credentials(&executable, reference)?;
    if issuer.vault != vault {
        return Err(Error::Configuration);
    }
    session.bind_issuer(&issuer)?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let retained = retire_expired(session, bootstrap_started, now, || {
        progress("Renewing the expired enrollment preparation");
        let proposal_path = root.join("hosts").join(host).join("proposal.json");
        if proposal_path
            .try_exists()
            .map_err(|_| provisioning::Error::UnsafeState)?
        {
            let proposal = crate::configuration_pr::Changes::load(
                &proposal_path,
                &workspace.repository,
                host,
            )?;
            crate::configuration_pr::resolve_for_renewal(
                &crate::configuration_pr::GitHub {
                    executable: "gh".into(),
                },
                &proposal,
            )?;
        }
        Ok(())
    })?;
    let session = match retained {
        Some(session) => session,
        None => {
            Session::open_with_store(host, &workspace.repository, root, &tools, &store, &vault)?
        }
    };
    session.bind_enrollment_config(tailscale)?;
    complete(
        session,
        &store,
        &vault,
        || tailscale_oauth::create_auth_key_with(credentials, &tailscale.tag),
        progress,
    )
}

fn retire_expired(
    session: Session,
    bootstrap_started: bool,
    now: i64,
    resolve_proposal: impl FnOnce() -> Result<(), Error>,
) -> Result<Option<Session>, Error> {
    if !session.details().completed
        || session.enrollment_valid_for(now, INSTALLATION_MARGIN_SECONDS)?
    {
        return Ok(Some(session));
    }
    if bootstrap_started {
        return Err(Error::ExpiredStartedSetup);
    }
    resolve_proposal()?;
    session.retire_for_renewal(now, INSTALLATION_MARGIN_SECONDS)?;
    Ok(None)
}

pub fn valid_for_installation(root: &Path, host: &str, repository: &str) -> Result<bool, Error> {
    let session = Session::open(host, repository, root, &Tools::discover()?)?;
    Ok(session.enrollment_valid_for(
        time::OffsetDateTime::now_utc().unix_timestamp(),
        INSTALLATION_MARGIN_SECONDS,
    )?)
}

pub fn proposal(
    root: &Path,
    host: &str,
    workspace: &Workspace,
    public_key: &str,
    api: &impl crate::configuration_pr::Api,
) -> Result<crate::configuration_pr::Changes, Error> {
    let session = Session::open(host, &workspace.repository, root, &Tools::discover()?)?;
    let details = session.details();
    if !details.completed {
        return Err(provisioning::Error::Interrupted.into());
    }
    let ciphertext = std::fs::read_to_string(&details.ciphertext_path)
        .map_err(|_| provisioning::Error::UnsafeState)?;
    let existing = api.raw(&format!(
        "repos/{}/contents/secrets/{host}.sops.yaml?ref={}",
        workspace.repository, workspace.revision
    ));
    match existing {
        Ok(previous) if previous != ciphertext.as_bytes() => {
            if !session.matches_retired_ciphertext(&previous)? {
                return Err(crate::configuration_pr::Error::Conflict.into());
            }
            let previous =
                std::str::from_utf8(&previous).map_err(|_| provisioning::Error::UnsafeState)?;
            Ok(crate::configuration_pr::prepare_renewal(
                api,
                workspace,
                host,
                public_key,
                crate::configuration_pr::Encryption {
                    ciphertext: &ciphertext,
                    host_recipient: &details.host_recipient,
                    recovery_recipient: &details.recovery_recipient,
                },
                previous,
            )?)
        }
        Ok(_) | Err(crate::configuration_pr::Error::Missing) => {
            Ok(crate::configuration_pr::prepare(
                api,
                workspace,
                host,
                public_key,
                &ciphertext,
                &details.host_recipient,
                &details.recovery_recipient,
            )?)
        }
        Err(error) => Err(error.into()),
    }
}

fn complete<K: EnrollmentKey>(
    mut session: Session,
    store: &impl secret_store::Store,
    vault: &str,
    issue: impl FnOnce() -> Result<K, tailscale_oauth::Error>,
    progress: impl Fn(&str),
) -> Result<Details, Error> {
    session.backup(store, vault)?;
    if session.details().completed {
        return Ok(session.details());
    }

    progress("Creating the scoped Tailscale enrollment key");
    session.claim_enrollment()?;
    let issued = match issue() {
        Ok(issued) => issued,
        Err(error) => {
            if error != tailscale_oauth::Error::IssuanceUnknown {
                session.finish_enrollment()?;
            }
            return Err(error.into());
        }
    };
    if let Err(error) = session.record_issuance(issued.id(), issued.expires_at()) {
        let confirmed = issued.revoke().is_ok();
        save_revocation(&session, &issued, confirmed)?;
        return Err(if confirmed {
            error.into()
        } else {
            Error::Cleanup
        });
    }
    progress("Encrypting and verifying host configuration");
    if let Err(error) = session.encrypt(BaseTokens {
        tailscale_auth: issued.secret().to_owned(),
    }) {
        // Publishing can fail after ciphertext becomes visible. Keep the attempt
        // marker so a revoked key cannot be mistaken for completed preparation.
        let confirmed = issued.revoke().is_ok();
        save_revocation(&session, &issued, confirmed)?;
        if !confirmed {
            return Err(Error::Cleanup);
        }
        return Err(error.into());
    }
    session.record_enrollment(issued.id(), issued.expires_at())?;
    session.finish_enrollment()?;
    Ok(session.details())
}

fn save_revocation(
    session: &Session,
    issued: &impl EnrollmentKey,
    confirmed: bool,
) -> Result<(), Error> {
    session
        .record_revocation(issued.id(), issued.expires_at(), confirmed)
        .map_err(|_| {
            // IDs are public provider references; never include token contents or
            // unvalidated provider text when durable recovery evidence cannot be saved.
            let id = issued.id();
            if !id.is_empty()
                && id.len() <= 128
                && issued.expires_at() > 0
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_".contains(&b))
            {
                Error::RecoveryReceipt {
                    key_id: id.into(),
                    expires_at: issued.expires_at(),
                    revoked: confirmed,
                }
            } else {
                Error::Cleanup
            }
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secret_store::{Backup, Item, Store};
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;

    const VAULT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    #[derive(Default)]
    struct MemoryStore {
        items: RefCell<BTreeMap<String, Item>>,
        locked: Cell<bool>,
    }
    impl Store for MemoryStore {
        fn find(&self, _: &str, tag: &str) -> Result<Vec<String>, secret_store::Error> {
            if self.locked.get() {
                return Err(secret_store::Error::Access);
            }
            Ok(self
                .items
                .borrow()
                .get(tag)
                .map(|item| vec![item.id.clone()])
                .unwrap_or_default())
        }
        fn read(&self, _: &str, id: &str) -> Result<Item, secret_store::Error> {
            let items = self.items.borrow();
            let item = items
                .values()
                .find(|item| item.id == id)
                .ok_or(secret_store::Error::Access)?;
            Ok(Item {
                id: item.id.clone(),
                vault: item.vault.clone(),
                repository: item.repository.clone(),
                role: item.role.clone(),
                recipient: item.recipient.clone(),
                identity: item.identity.clone(),
            })
        }
        fn create(
            &self,
            vault: &str,
            backup: &Backup<'_>,
            tag: &str,
        ) -> Result<String, secret_store::Error> {
            let id = if backup.role == "recovery" {
                "b".repeat(26)
            } else {
                "c".repeat(26)
            };
            self.items.borrow_mut().insert(
                tag.into(),
                Item {
                    id: id.clone(),
                    vault: vault.into(),
                    repository: backup.repository.into(),
                    role: backup.role.into(),
                    recipient: backup.recipient.into(),
                    identity: backup.identity.into(),
                },
            );
            Ok(id)
        }
    }
    struct SyntheticKey<'a> {
        revoked: &'a Cell<bool>,
    }
    impl EnrollmentKey for SyntheticKey<'_> {
        fn id(&self) -> &str {
            "synthetic-key-id"
        }
        fn expires_at(&self) -> i64 {
            time::OffsetDateTime::now_utc().unix_timestamp() + 86400
        }
        fn secret(&self) -> &str {
            "synthetic-enrollment-key"
        }
        fn revoke(&self) -> Result<(), tailscale_oauth::Error> {
            self.revoked.set(true);
            Ok(())
        }
    }

    #[test]
    fn failed_issuance_receipt_retains_public_identity_in_fallback_or_typed_error() {
        struct Key;
        impl EnrollmentKey for Key {
            fn id(&self) -> &str {
                "known-fallback-id"
            }
            fn expires_at(&self) -> i64 {
                4000000000
            }
            fn secret(&self) -> &str {
                "never-log-this-token"
            }
            fn revoke(&self) -> Result<(), tailscale_oauth::Error> {
                Err(tailscale_oauth::Error::Revocation)
            }
        }
        for fail_fallback in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let root = temporary.path().join("state");
            let tools = Tools::discover().unwrap();
            let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
            let directory = root.join("hosts/test-mac");
            let error = complete(
                session,
                &MemoryStore::default(),
                VAULT,
                || {
                    std::fs::create_dir(directory.join("issuance.json")).unwrap();
                    if fail_fallback {
                        std::fs::create_dir(directory.join("revocation.json")).unwrap();
                    }
                    Ok(Key)
                },
                |stage| {
                    assert_ne!(stage, "Encrypting and verifying host configuration");
                },
            )
            .unwrap_err();
            assert!(!error.to_string().contains("never-log-this-token"));
            assert!(!format!("{error:?}").contains("never-log-this-token"));
            if fail_fallback {
                match error {
                    Error::RecoveryReceipt {
                        key_id,
                        expires_at,
                        revoked,
                    } => {
                        assert_eq!(key_id, "known-fallback-id");
                        assert_eq!(expires_at, 4000000000);
                        assert!(!revoked);
                    }
                    _ => panic!("missing typed recovery identity"),
                }
            } else {
                assert!(matches!(error, Error::Cleanup));
                let text = std::fs::read_to_string(directory.join("revocation.json")).unwrap();
                let receipt: serde_json::Value = serde_json::from_str(&text).unwrap();
                assert_eq!(receipt["keyId"], "known-fallback-id");
                assert_eq!(receipt["expiresAt"], 4000000000_i64);
                assert_eq!(receipt["confirmed"], false);
                assert!(!text.contains("never-log-this-token"));
            }
            assert!(directory.join(".enrollment-attempt").exists());
            assert!(Session::open("test-mac", "example/config", &root, &tools).is_err());
        }
    }

    #[test]
    fn encryption_failure_retains_issuance_and_revocation_evidence_without_secrets() {
        struct InvalidKey(bool);
        impl EnrollmentKey for InvalidKey {
            fn id(&self) -> &str {
                "known-issued-id"
            }
            fn expires_at(&self) -> i64 {
                4000000000
            }
            fn secret(&self) -> &str {
                "invalid\nsecret-sentinel"
            }
            fn revoke(&self) -> Result<(), tailscale_oauth::Error> {
                if self.0 {
                    Ok(())
                } else {
                    Err(tailscale_oauth::Error::Revocation)
                }
            }
        }
        for confirmed in [false, true] {
            let temporary = tempfile::tempdir().unwrap();
            let root = temporary.path().join("state");
            let tools = Tools::discover().unwrap();
            let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
            let directory = root.join("hosts/test-mac");
            let result = complete(
                session,
                &MemoryStore::default(),
                VAULT,
                || Ok(InvalidKey(confirmed)),
                |stage| {
                    if stage == "Encrypting and verifying host configuration" {
                        let receipt =
                            std::fs::read_to_string(directory.join("issuance.json")).unwrap();
                        assert!(receipt.contains("known-issued-id"));
                        assert!(!receipt.contains("secret-sentinel"));
                    }
                },
            );
            assert!(result.is_err());
            let receipt: serde_json::Value =
                serde_json::from_slice(&std::fs::read(directory.join("revocation.json")).unwrap())
                    .unwrap();
            assert_eq!(receipt["confirmed"], confirmed);
            assert!(directory.join(".enrollment-attempt").exists());
            assert!(Session::open("test-mac", "example/config", &root, &tools).is_err());
        }
    }

    #[test]
    fn renewal_preserves_started_setup_and_requires_resolving_the_old_proposal() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("state");
        let tools = Tools::discover().unwrap();
        let open = || Session::open("test-mac", "example/config", &root, &tools).unwrap();
        let mut session = open();
        let issuer = tailscale_oauth::ResolvedIdentity {
            vault: VAULT.into(),
            item: "bbbbbbbbbbbbbbbbbbbbbbbbbb".into(),
        };
        session.bind_issuer(&issuer).unwrap();
        let original = session
            .encrypt(BaseTokens {
                tailscale_auth: "synthetic-expired-key".into(),
            })
            .unwrap();
        session.record_enrollment("key-old", 2000).unwrap();
        let retained = retire_expired(session, true, 3000, || {
            panic!("started setup must not resolve its PR")
        });
        assert!(matches!(retained, Err(Error::ExpiredStartedSetup)));
        assert!(original.ciphertext_path.exists());
        assert!(
            retire_expired(open(), false, 3000, || Err(
                crate::configuration_pr::Error::Unconfirmed.into()
            ))
            .is_err()
        );
        assert!(original.ciphertext_path.exists());
        assert!(open().details().completed);
        let retired = retire_expired(open(), false, 3000, || {
            assert!(
                original.ciphertext_path.exists(),
                "resolve PR before moving preparation"
            );
            Ok(())
        })
        .unwrap();
        assert!(retired.is_none());
        let renewed = open();
        assert!(!renewed.details().completed);
        renewed.bind_issuer(&issuer).unwrap();
        let changed = tailscale_oauth::ResolvedIdentity {
            item: "cccccccccccccccccccccccccc".into(),
            ..issuer
        };
        assert!(renewed.bind_issuer(&changed).is_err());
        assert_eq!(renewed.details().host_recipient, original.host_recipient);
        assert_eq!(
            renewed.details().recovery_recipient,
            original.recovery_recipient
        );
    }

    #[test]
    fn backup_failure_prevents_issuance_and_resume_does_not_issue_again() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("state");
        let tools = Tools::discover().expect("age and SOPS are required for credential tests");
        let store = MemoryStore::default();
        store.locked.set(true);
        let issued = Cell::new(0);
        let revoked = Cell::new(false);
        let issue = || {
            issued.set(issued.get() + 1);
            Ok(SyntheticKey { revoked: &revoked })
        };
        let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
        assert!(complete(session, &store, VAULT, issue, |_| {}).is_err());
        assert_eq!(issued.get(), 0);
        store.locked.set(false);
        let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
        let details = complete(session, &store, VAULT, issue, |_| {}).unwrap();
        assert!(details.completed);
        assert_eq!(issued.get(), 1);
        assert!(!revoked.get());
        let ciphertext = std::fs::read(&details.ciphertext_path).unwrap();
        let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
        complete(session, &store, VAULT, issue, |_| {}).unwrap();
        assert_eq!(issued.get(), 1);
        assert_eq!(std::fs::read(&details.ciphertext_path).unwrap(), ciphertext);

        let session = Session::open("test-mac", "example/config", &root, &tools).unwrap();
        let later = time::OffsetDateTime::now_utc().unix_timestamp() + 172800;
        session.retire_for_renewal(later, 3600).unwrap();
        store.items.borrow_mut().clear();
        let renewed =
            Session::open_with_store("test-mac", "example/config", &root, &tools, &store, VAULT)
                .unwrap();
        assert_eq!(renewed.details().host_recipient, details.host_recipient);
        assert_eq!(
            renewed.details().recovery_recipient,
            details.recovery_recipient
        );
        assert!(!renewed.details().completed);
        assert!(renewed.matches_retired_ciphertext(&ciphertext).unwrap());
        assert_eq!(issued.get(), 1);
    }
}
