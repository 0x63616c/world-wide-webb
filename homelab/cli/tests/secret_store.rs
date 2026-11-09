use homelab_client::secret_store::{Backup, Error, Item, Store, ensure};
use std::cell::{Cell, RefCell};
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};

const VAULT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
const ID: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
const SECRET: &str = "AGE-SECRET-KEY-1SYNTHETIC";

struct Fake {
    item: RefCell<Option<Item>>,
    creates: Cell<usize>,
    lose_response: bool,
    wrong_value: bool,
    locked: bool,
    duplicate: bool,
}
impl Fake {
    fn new() -> Self {
        Self {
            item: RefCell::new(None),
            creates: Cell::new(0),
            lose_response: false,
            wrong_value: false,
            locked: false,
            duplicate: false,
        }
    }
}
impl Store for Fake {
    fn find(&self, _: &str, _: &str) -> Result<Vec<String>, Error> {
        if self.locked {
            return Err(Error::Access);
        }
        if self.duplicate {
            return Ok(vec![ID.into(), ID.into()]);
        }
        Ok(self
            .item
            .borrow()
            .as_ref()
            .map(|item| vec![item.id.clone()])
            .unwrap_or_default())
    }
    fn create(&self, vault: &str, backup: &Backup<'_>, _: &str) -> Result<String, Error> {
        self.creates.set(self.creates.get() + 1);
        self.item.replace(Some(Item {
            id: ID.into(),
            vault: vault.into(),
            repository: backup.repository.into(),
            role: backup.role.into(),
            recipient: backup.recipient.into(),
            identity: backup.identity.into(),
        }));
        if self.lose_response {
            Err(Error::Unconfirmed)
        } else {
            Ok(ID.into())
        }
    }
    fn read(&self, _: &str, _: &str) -> Result<Item, Error> {
        let item = self.item.borrow();
        let item = item.as_ref().ok_or(Error::Access)?;
        Ok(Item {
            id: item.id.clone(),
            vault: item.vault.clone(),
            repository: item.repository.clone(),
            role: item.role.clone(),
            recipient: item.recipient.clone(),
            identity: if self.wrong_value {
                "wrong".into()
            } else {
                item.identity.clone()
            },
        })
    }
}
fn backup() -> Backup<'static> {
    Backup {
        repository: "example/config",
        role: "recovery",
        recipient: "age1synthetic",
        identity: SECRET,
    }
}
fn directory() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    directory
}

#[test]
fn verified_backup_is_reused_and_receipt_contains_no_secret() {
    let directory = directory();
    let path = directory.path().join("receipt");
    let store = Fake::new();
    assert_eq!(ensure(&store, VAULT, &backup(), &path).unwrap(), ID);
    assert_eq!(ensure(&store, VAULT, &backup(), &path).unwrap(), ID);
    assert_eq!(store.creates.get(), 1);
    assert!(!fs::read_to_string(&path).unwrap().contains(SECRET));
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[test]
fn lost_create_response_reconciles_saved_item_without_reissuing() {
    let directory = directory();
    let path = directory.path().join("receipt");
    let store = Fake {
        lose_response: true,
        ..Fake::new()
    };
    assert_eq!(
        ensure(&store, VAULT, &backup(), &path),
        Err(Error::Unconfirmed)
    );
    assert_eq!(ensure(&store, VAULT, &backup(), &path).unwrap(), ID);
    assert_eq!(store.creates.get(), 1);
}

#[test]
fn missing_item_after_uncertain_write_stops_without_another_write() {
    let directory = directory();
    let path = directory.path().join("receipt");
    let store = Fake {
        lose_response: true,
        ..Fake::new()
    };
    assert_eq!(
        ensure(&store, VAULT, &backup(), &path),
        Err(Error::Unconfirmed)
    );
    store.item.replace(None);
    assert_eq!(
        ensure(&store, VAULT, &backup(), &path),
        Err(Error::Unconfirmed)
    );
    assert_eq!(store.creates.get(), 1);
}

#[test]
fn failed_readback_never_confirms_success_and_retry_does_not_duplicate() {
    let directory = directory();
    let path = directory.path().join("receipt");
    let store = Fake {
        wrong_value: true,
        ..Fake::new()
    };
    assert_eq!(
        ensure(&store, VAULT, &backup(), &path),
        Err(Error::Conflict)
    );
    assert!(fs::read_to_string(&path).unwrap().contains("\"item\":null"));
    assert_eq!(
        ensure(&store, VAULT, &backup(), &path),
        Err(Error::Conflict)
    );
    assert_eq!(store.creates.get(), 1);
}

#[test]
fn locked_vault_and_duplicate_matches_do_not_write() {
    for store in [
        Fake {
            locked: true,
            ..Fake::new()
        },
        Fake {
            duplicate: true,
            ..Fake::new()
        },
    ] {
        let directory = directory();
        let path = directory.path().join("receipt");
        assert!(ensure(&store, VAULT, &backup(), &path).is_err());
        assert_eq!(store.creates.get(), 0);
        assert!(!path.exists());
    }
}

#[test]
fn changed_identity_and_receipt_symlinks_preserve_existing_backup() {
    let directory = directory();
    let path = directory.path().join("receipt");
    let store = Fake::new();
    ensure(&store, VAULT, &backup(), &path).unwrap();
    let changed = Backup {
        recipient: "age1different",
        ..backup()
    };
    assert_eq!(ensure(&store, VAULT, &changed, &path), Err(Error::Conflict));
    let link = directory.path().join("link");
    symlink(&path, &link).unwrap();
    assert_eq!(ensure(&store, VAULT, &backup(), &link), Err(Error::State));
    assert_eq!(store.creates.get(), 1);
}

#[test]
fn onepassword_adapter_uses_private_temporary_template_and_checks_readback() {
    use homelab_client::secret_store::OnePassword;
    use std::process::Command;
    let directory = directory();
    let executable = directory.path().join("op");
    let output = Command::new("rustc")
        .arg(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/secret_store.rs"),
        )
        .arg("-o")
        .arg(&executable)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let item = serde_json::json!({"id":ID,"vault":{"id":VAULT},"fields":[
        {"id":"repository","type":"STRING","value":"example/config"},
        {"id":"role","type":"STRING","value":"recovery"},
        {"id":"recipient","type":"STRING","value":"age1synthetic"},
        {"id":"identity","type":"CONCEALED","value":SECRET}
    ]});
    fs::write(
        directory.path().join("item"),
        serde_json::to_vec(&item).unwrap(),
    )
    .unwrap();
    fs::write(
        directory.path().join("listing"),
        serde_json::to_vec(&serde_json::json!([
            {"id":ID,"vault":{"id":VAULT},"tags":["TAG"]}
        ]))
        .unwrap(),
    )
    .unwrap();
    let store = OnePassword { executable };
    assert_eq!(store.vault_id("homelab").unwrap(), VAULT);
    let receipt = directory.path().join("receipt");
    assert_eq!(ensure(&store, VAULT, &backup(), &receipt).unwrap(), ID);
    let template = fs::read_to_string(directory.path().join("template-path")).unwrap();
    assert!(!std::path::Path::new(&template).exists());
    assert_eq!(ensure(&store, VAULT, &backup(), &receipt).unwrap(), ID);
    let mut wrong = item;
    wrong["fields"][3]["type"] = serde_json::json!("STRING");
    fs::write(
        directory.path().join("item"),
        serde_json::to_vec(&wrong).unwrap(),
    )
    .unwrap();
    assert_eq!(
        ensure(&store, VAULT, &backup(), &receipt),
        Err(Error::Conflict)
    );
}

#[test]
fn replacement_client_restores_verified_identity_and_never_overwrites_local_key() {
    use homelab_client::secret_store::restore;
    use std::process::Command;
    let keygen = std::env::var_os("HOMELAB_TEST_AGE_KEYGEN")
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::split_paths(&std::env::var_os("PATH")?)
                .map(|path| path.join("age-keygen"))
                .find(|path| path.is_file())
        })
        .expect("age-keygen is required for recovery verification");
    let directory = directory();
    let original = directory.path().join("original");
    assert!(
        Command::new(&keygen)
            .arg("-o")
            .arg(&original)
            .output()
            .unwrap()
            .status
            .success()
    );
    let public = Command::new(&keygen)
        .arg("-y")
        .arg(&original)
        .output()
        .unwrap();
    assert!(public.status.success());
    let identity = fs::read_to_string(&original).unwrap();
    let recipient = String::from_utf8(public.stdout).unwrap().trim().to_owned();
    let store = Fake::new();
    store.item.replace(Some(Item {
        id: ID.into(),
        vault: VAULT.into(),
        repository: "example/config".into(),
        role: "recovery".into(),
        recipient,
        identity: identity.clone(),
    }));
    let destination = directory.path().join("restored");
    assert!(
        restore(
            &store,
            VAULT,
            "example/config",
            "recovery",
            &destination,
            &keygen
        )
        .unwrap()
    );
    assert_eq!(fs::read_to_string(&destination).unwrap(), identity);
    assert!(
        restore(
            &store,
            VAULT,
            "example/config",
            "recovery",
            &destination,
            &keygen
        )
        .unwrap()
    );
    fs::write(&destination, "existing different identity").unwrap();
    assert_eq!(
        restore(
            &store,
            VAULT,
            "example/config",
            "recovery",
            &destination,
            &keygen
        ),
        Err(Error::Conflict)
    );
    assert_eq!(
        fs::read_to_string(&destination).unwrap(),
        "existing different identity"
    );
    assert_eq!(store.creates.get(), 0);
}

#[test]
#[ignore = "explicit opt-in: creates and deletes one synthetic item in the selected test vault"]
fn real_onepassword_roundtrip() {
    use homelab_client::secret_store::OnePassword;
    let executable = std::env::var_os("HOMELAB_TEST_OP").expect("explicit op executable required");
    let vault_name = std::env::var("HOMELAB_TEST_VAULT").expect("explicit test vault required");
    let store = OnePassword {
        executable: executable.into(),
    };
    let vault = store
        .vault_id(&vault_name)
        .expect("test vault access unavailable");
    let directory = directory();
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let role = format!("synthetic-schema-test-{unique}");
    let backup = Backup {
        role: &role,
        identity: "# Synthetic schema check; not a real identity\nAGE-SECRET-KEY-1SYNTHETIC\n",
        ..backup()
    };
    let receipt = directory.path().join("receipt");
    let id = match ensure(&store, &vault, &backup, &receipt) {
        Ok(id) => id,
        Err(error) => {
            let preserved = directory.keep();
            panic!(
                "Synthetic backup not verified: {error}; receipt preserved at {} (role {role})",
                preserved.display()
            );
        }
    };
    let repeated = ensure(&store, &vault, &backup, &receipt);
    let mut cleanup = std::process::Command::new(&store.executable);
    cleanup.args(["item", "delete", &id, "--vault", &vault]);
    let status =
        homelab_client::process::run_silent(&mut cleanup, std::time::Duration::from_secs(90))
            .expect("synthetic item cleanup could not be confirmed");
    assert!(status.success(), "synthetic item cleanup failed");
    assert_eq!(repeated.unwrap(), id);
}

#[test]
fn denied_access_can_return_then_retry_without_losing_or_reissuing_identity() {
    let directory = directory();
    let receipt = directory.path().join("receipt");
    let mut store = Fake {
        locked: true,
        ..Fake::new()
    };
    assert_eq!(
        ensure(&store, VAULT, &backup(), &receipt),
        Err(Error::Access)
    );
    assert_eq!(store.creates.get(), 0);
    assert!(!receipt.exists());
    store.locked = false;
    assert_eq!(ensure(&store, VAULT, &backup(), &receipt).unwrap(), ID);
    assert_eq!(ensure(&store, VAULT, &backup(), &receipt).unwrap(), ID);
    assert_eq!(store.creates.get(), 1);
    assert!(!fs::read_to_string(receipt).unwrap().contains(SECRET));
}
