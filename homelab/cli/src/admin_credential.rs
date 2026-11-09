//! Repository/host-bound administrator credentials, stored only in 1Password.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt},
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, Copy, Debug, thiserror::Error, PartialEq, Eq)]
pub enum Error {
    #[error("Unlock 1Password and allow access to the configured backup vault, then retry setup.")]
    Access,
    #[error(
        "The saved administrator credential belongs to a different repository, Mac, login, or SSH identity. It was preserved."
    )]
    Conflict,
    #[error(
        "The administrator credential could not be saved with certainty. Inspect the canonical 1Password item before retrying; no duplicate was created."
    )]
    Unconfirmed,
    #[error(
        "Administrator credential state is unsafe or invalid. Existing setup progress was preserved."
    )]
    State,
    #[error(
        "The target Mac's verified SSH identity is unavailable. Reconnect before entering its password."
    )]
    Target,
    #[error(
        "Could not validate administrator access on the target Mac. Check its connection and sudo policy, then retry."
    )]
    Validation,
    #[error(
        "The administrator password must contain 1–1024 UTF-8 bytes without control characters."
    )]
    Password,
    #[error(
        "Setup needs onePassword.backupVault in its Git configuration to save the administrator credential."
    )]
    Configuration,
    #[error("Administrator authentication was cancelled. Saved setup progress was preserved.")]
    Cancelled,
}

/// Deliberately lacks Debug, Display, Serialize and Clone.
pub struct Secret(Zeroizing<Vec<u8>>);
impl Secret {
    pub fn new(bytes: &[u8]) -> Result<Self, Error> {
        let text = std::str::from_utf8(bytes).map_err(|_| Error::Password)?;
        if bytes.is_empty() || bytes.len() > 1024 || text.chars().any(char::is_control) {
            return Err(Error::Password);
        }
        Ok(Self(Zeroizing::new(bytes.to_vec())))
    }
    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    fn as_str(&self) -> &str {
        std::str::from_utf8(&self.0).expect("validated secret")
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub repository: String,
    pub host: String,
    pub user: String,
    pub ssh_host_key: String,
}
impl Binding {
    fn valid(&self) -> bool {
        crate::config::valid_repository(&self.repository)
            && crate::config::valid_host(&self.host)
            && !self.user.is_empty()
            && self.user.len() <= 253
            && self
                .user
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
            && crate::ssh_identity::canonical_key(&self.ssh_host_key).as_ref()
                == Some(&self.ssh_host_key)
            && self.ssh_host_key.starts_with("ssh-ed25519 ")
    }
    pub fn tag(&self) -> String {
        let digest = Sha256::digest(format!(
            "{}\n{}\n{}",
            self.repository.to_ascii_lowercase(),
            self.host,
            self.user
        ));
        format!(
            "homelab-admin-{}",
            digest
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        )
    }
}
pub struct Item {
    pub id: String,
    pub vault: String,
    pub binding: Binding,
    pub password: Secret,
}
pub trait Store {
    fn vault_id(&self, reference: &str) -> Result<String, Error>;
    fn find(&self, vault: &str, tag: &str) -> Result<Vec<String>, Error>;
    fn read(&self, vault: &str, item: &str) -> Result<Item, Error>;
    fn write(
        &self,
        vault: &str,
        item: Option<&str>,
        binding: &Binding,
        password: &Secret,
    ) -> Result<String, Error>;
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema: u8,
    vault: String,
    tag: String,
    item: Option<String>,
    pending: bool,
}
fn identifier(s: &str) -> bool {
    s.len() == 26
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}
fn private_directory(path: &Path) -> Result<(), Error> {
    if let Err(error) = fs::symlink_metadata(path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            return Err(Error::State);
        }
        let parent = path.parent().ok_or(Error::State)?;
        private_directory(parent)?;
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| Error::State)?;
        File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| Error::State)?;
    }
    let m = fs::symlink_metadata(path).map_err(|_| Error::State)?;
    if !m.is_dir() || m.uid() != rustix::process::geteuid().as_raw() || m.mode() & 0o7777 != 0o700 {
        return Err(Error::State);
    }
    Ok(())
}
fn read_receipt(path: &Path) -> Result<Option<Receipt>, Error> {
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
    {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(Error::State),
    };
    let m = file.metadata().map_err(|_| Error::State)?;
    if !m.is_file()
        || m.nlink() != 1
        || m.uid() != rustix::process::geteuid().as_raw()
        || m.mode() & 0o077 != 0
    {
        return Err(Error::State);
    }
    let mut bytes = Vec::new();
    file.take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::State)?;
    if bytes.len() > 4096 {
        return Err(Error::State);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| Error::State)
}
fn save(path: &Path, receipt: &Receipt) -> Result<(), Error> {
    let parent = path.parent().ok_or(Error::State)?;
    private_directory(parent)?;
    // Validate any existing file before atomic replacement.
    read_receipt(path)?;
    let mut pending = tempfile::NamedTempFile::new_in(parent).map_err(|_| Error::State)?;
    serde_json::to_writer(&mut pending, receipt).map_err(|_| Error::State)?;
    pending.as_file().sync_all().map_err(|_| Error::State)?;
    pending.persist(path).map_err(|_| Error::State)?;
    File::open(parent)
        .and_then(|f| f.sync_all())
        .map_err(|_| Error::State)
}

/// The caller holds the enrollment lock. Validation always precedes mutation of
/// 1Password. A pending creation is reconciled by its stable tag, never repeated.
pub fn ensure(
    store: &dyn Store,
    vault_reference: &str,
    binding: &Binding,
    receipt_path: &Path,
    mut validate: impl FnMut(&Secret) -> Result<bool, Error>,
    mut prompt: impl FnMut(bool) -> Result<Option<Secret>, Error>,
) -> Result<Secret, Error> {
    if !binding.valid() {
        return Err(Error::Target);
    }
    let vault = store.vault_id(vault_reference)?;
    if !identifier(&vault) {
        return Err(Error::State);
    }
    let tag = binding.tag();
    let previous = read_receipt(receipt_path)?;
    if previous.as_ref().is_some_and(|r| {
        r.schema != 1
            || r.vault != vault
            || r.tag != tag
            || r.item.as_ref().is_some_and(|id| !identifier(id))
    }) {
        return Err(Error::Conflict);
    }
    let matches = store.find(&vault, &tag)?;
    if matches.len() > 1 || matches.iter().any(|id| !identifier(id)) {
        return Err(Error::Conflict);
    }
    let id = matches.first();
    if previous
        .as_ref()
        .and_then(|r| r.item.as_ref())
        .is_some_and(|saved| Some(saved) != id)
    {
        return Err(Error::Conflict);
    }
    if id.is_none() && previous.is_some() {
        return Err(Error::Unconfirmed);
    }
    let mut rejected = false;
    if let Some(id) = id {
        let item = store.read(&vault, id)?;
        if item.id != *id || item.vault != vault || item.binding != *binding {
            return Err(Error::Conflict);
        }
        if validate(&item.password)? {
            save(
                receipt_path,
                &Receipt {
                    schema: 1,
                    vault,
                    tag,
                    item: Some(id.clone()),
                    pending: false,
                },
            )?;
            return Ok(item.password);
        }
        rejected = true;
    }
    let password = loop {
        let value = prompt(rejected)?.ok_or(Error::Cancelled)?;
        if validate(&value)? {
            break value;
        }
        rejected = true;
    };
    save(
        receipt_path,
        &Receipt {
            schema: 1,
            vault: vault.clone(),
            tag: tag.clone(),
            item: id.cloned(),
            pending: true,
        },
    )?;
    let saved = store
        .write(&vault, id.map(String::as_str), binding, &password)
        .map_err(|_| Error::Unconfirmed)?;
    if !identifier(&saved) || id.is_some_and(|id| *id != saved) {
        return Err(Error::Unconfirmed);
    }
    let checked = store.read(&vault, &saved).map_err(|_| Error::Unconfirmed)?;
    if checked.id != saved
        || checked.vault != vault
        || checked.binding != *binding
        || checked.password.as_bytes() != password.as_bytes()
    {
        return Err(Error::Unconfirmed);
    }
    save(
        receipt_path,
        &Receipt {
            schema: 1,
            vault,
            tag,
            item: Some(saved),
            pending: false,
        },
    )?;
    Ok(password)
}

pub struct OnePassword<'a> {
    pub executable: &'a Path,
}
impl OnePassword<'_> {
    fn run(&self, args: &[&str], input: Option<&[u8]>) -> Result<Zeroizing<Vec<u8>>, Error> {
        let mut command = Command::new(self.executable);
        command.args(args).stdin(Stdio::null());
        let result = match input {
            Some(input) => {
                crate::process::capture_input(&mut command, input, Duration::from_secs(90))
            }
            None => crate::process::capture(&mut command, Duration::from_secs(90)),
        };
        let mut output =
            crate::provider_diagnostics::observe(crate::provider_diagnostics::op(args), result)
                .map_err(|_| Error::Access)?;
        output.stderr.zeroize();
        let bytes = Zeroizing::new(std::mem::take(&mut output.stdout));
        if !output.status.success() {
            return Err(Error::Access);
        }
        Ok(bytes)
    }
}
#[derive(Deserialize)]
struct RawVault {
    id: String,
}
#[derive(Deserialize)]
struct RawField {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    value: String,
}
impl Drop for RawField {
    fn drop(&mut self) {
        self.value.zeroize();
    }
}
struct SensitiveJson(serde_json::Value);
impl Drop for SensitiveJson {
    fn drop(&mut self) {
        fn clear(value: &mut serde_json::Value) {
            match value {
                serde_json::Value::String(s) => s.zeroize(),
                serde_json::Value::Array(values) => values.iter_mut().for_each(clear),
                serde_json::Value::Object(values) => values.values_mut().for_each(clear),
                _ => {}
            }
        }
        clear(&mut self.0);
    }
}
#[derive(Deserialize)]
struct RawItem {
    id: String,
    vault: RawVault,
    #[serde(default)]
    category: String,
    #[serde(default)]
    fields: Vec<RawField>,
    #[serde(default)]
    tags: Vec<String>,
}
impl Store for OnePassword<'_> {
    fn vault_id(&self, reference: &str) -> Result<String, Error> {
        if reference.is_empty()
            || reference.starts_with('-')
            || reference.len() > 200
            || reference.chars().any(char::is_control)
        {
            return Err(Error::Configuration);
        }
        let bytes = self.run(&["vault", "get", reference, "--format", "json"], None)?;
        let vault: RawVault = serde_json::from_slice(&bytes).map_err(|_| {
            crate::provider_diagnostics::invalid_response(
                crate::provider_diagnostics::Operation::OpVault,
            );
            Error::Access
        })?;
        if !identifier(&vault.id) {
            return Err(Error::Access);
        }
        Ok(vault.id)
    }
    fn find(&self, vault: &str, tag: &str) -> Result<Vec<String>, Error> {
        let bytes = self.run(
            &[
                "item", "list", "--vault", vault, "--tags", tag, "--format", "json",
            ],
            None,
        )?;
        let items: Vec<RawItem> = serde_json::from_slice(&bytes).map_err(|_| {
            crate::provider_diagnostics::invalid_response(
                crate::provider_diagnostics::Operation::OpList,
            );
            Error::Access
        })?;
        items
            .into_iter()
            .map(|item| {
                if item.vault.id != vault
                    || !item.tags.iter().any(|t| t == tag)
                    || !identifier(&item.id)
                {
                    return Err(Error::Conflict);
                }
                Ok(item.id)
            })
            .collect()
    }
    fn read(&self, vault: &str, item: &str) -> Result<Item, Error> {
        if !identifier(vault) || !identifier(item) {
            return Err(Error::State);
        }
        let bytes = self.run(
            &[
                "item", "get", item, "--vault", vault, "--format", "json", "--reveal",
            ],
            None,
        )?;
        let raw: RawItem = serde_json::from_slice(&bytes).map_err(|_| {
            crate::provider_diagnostics::invalid_response(
                crate::provider_diagnostics::Operation::OpRead,
            );
            Error::Access
        })?;
        if raw.category != "LOGIN" {
            return Err(Error::Conflict);
        }
        let field = |id: &str, kind: &str| -> Result<&str, Error> {
            let fields: Vec<_> = raw.fields.iter().filter(|f| f.id == id).collect();
            if fields.len() != 1 || fields[0].kind != kind {
                return Err(Error::Conflict);
            }
            Ok(&fields[0].value)
        };
        let binding = Binding {
            repository: field("repository", "STRING")?.into(),
            host: field("host", "STRING")?.into(),
            user: field("username", "STRING")?.into(),
            ssh_host_key: field("ssh-host-key", "STRING")?.into(),
        };
        let password =
            Secret::new(field("password", "CONCEALED")?.as_bytes()).map_err(|_| Error::Conflict)?;
        if !raw.tags.iter().any(|tag| *tag == binding.tag()) {
            return Err(Error::Conflict);
        }
        Ok(Item {
            id: raw.id,
            vault: raw.vault.id,
            binding,
            password,
        })
    }
    fn write(
        &self,
        vault: &str,
        item: Option<&str>,
        binding: &Binding,
        password: &Secret,
    ) -> Result<String, Error> {
        if !identifier(vault) || item.is_some_and(|id| !identifier(id)) || !binding.valid() {
            return Err(Error::State);
        }
        if let Some(id) = item {
            // Preserve unrelated fields, notes, tags and item metadata when its
            // password changes. Never replace a richer Login with a bare template.
            let raw = self.run(
                &[
                    "item", "get", id, "--vault", vault, "--format", "json", "--reveal",
                ],
                None,
            )?;
            let mut value =
                SensitiveJson(serde_json::from_slice(&raw).map_err(|_| Error::Conflict)?);
            let object = &mut value.0;
            let text = |id: &str| {
                object
                    .get("fields")
                    .and_then(serde_json::Value::as_array)
                    .and_then(|fields| {
                        let fields: Vec<_> = fields
                            .iter()
                            .filter(|f| f.get("id").and_then(serde_json::Value::as_str) == Some(id))
                            .collect();
                        (fields.len() == 1).then(|| fields[0])
                    })
                    .and_then(|f| f.get("value"))
                    .and_then(serde_json::Value::as_str)
            };
            if object.get("id").and_then(serde_json::Value::as_str) != Some(id)
                || object
                    .pointer("/vault/id")
                    .and_then(serde_json::Value::as_str)
                    != Some(vault)
                || text("repository") != Some(&binding.repository)
                || text("host") != Some(&binding.host)
                || text("username") != Some(&binding.user)
                || text("ssh-host-key") != Some(&binding.ssh_host_key)
            {
                return Err(Error::Conflict);
            }
            if object.get("category").and_then(serde_json::Value::as_str) != Some("LOGIN")
                || !object
                    .get("tags")
                    .and_then(serde_json::Value::as_array)
                    .is_some_and(|tags| tags.iter().any(|t| t.as_str() == Some(&binding.tag())))
                || object
                    .get("passkeys")
                    .is_some_and(|p| p.as_array().is_none_or(|p| !p.is_empty()))
            {
                return Err(Error::Conflict);
            }
            let fields = object
                .get_mut("fields")
                .and_then(serde_json::Value::as_array_mut)
                .ok_or(Error::Conflict)?;
            let passwords: Vec<_> = fields
                .iter_mut()
                .filter(|f| f.get("id").and_then(serde_json::Value::as_str) == Some("password"))
                .collect();
            if passwords.len() != 1 {
                return Err(Error::Conflict);
            }
            let field = passwords.into_iter().next().unwrap();
            if field.get("type").and_then(serde_json::Value::as_str) != Some("CONCEALED") {
                return Err(Error::Conflict);
            }
            if let Some(serde_json::Value::String(old)) = field.get_mut("value") {
                old.zeroize();
            }
            field["value"] = serde_json::Value::String(password.as_str().to_owned());
            let input = Zeroizing::new(serde_json::to_vec(&value.0).map_err(|_| Error::State)?);
            let output = self.run(
                &["item", "edit", id, "--vault", vault, "--format", "json"],
                Some(&input),
            )?;
            let result: RawItem =
                serde_json::from_slice(&output).map_err(|_| Error::Unconfirmed)?;
            return Ok(result.id);
        }
        #[derive(Serialize)]
        struct Field<'a> {
            id: &'a str,
            label: &'a str,
            #[serde(rename = "type")]
            kind: &'a str,
            value: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            purpose: Option<&'a str>,
        }
        #[derive(Serialize)]
        struct Template<'a> {
            title: String,
            category: &'a str,
            tags: [String; 1],
            fields: [Field<'a>; 5],
        }
        let template = Template {
            title: format!(
                "Homelab administrator — {} — {}",
                binding.repository, binding.host
            ),
            category: "LOGIN",
            tags: [binding.tag()],
            fields: [
                Field {
                    id: "repository",
                    label: "Repository",
                    kind: "STRING",
                    value: &binding.repository,
                    purpose: None,
                },
                Field {
                    id: "host",
                    label: "Host",
                    kind: "STRING",
                    value: &binding.host,
                    purpose: None,
                },
                Field {
                    id: "username",
                    label: "Username",
                    kind: "STRING",
                    value: &binding.user,
                    purpose: Some("USERNAME"),
                },
                Field {
                    id: "ssh-host-key",
                    label: "Verified SSH host key",
                    kind: "STRING",
                    value: &binding.ssh_host_key,
                    purpose: None,
                },
                Field {
                    id: "password",
                    label: "Password",
                    kind: "CONCEALED",
                    value: password.as_str(),
                    purpose: Some("PASSWORD"),
                },
            ],
        };
        let bytes = Zeroizing::new(serde_json::to_vec(&template).map_err(|_| Error::State)?);
        let args = vec!["item", "create", "--vault", vault, "--format", "json", "-"];
        let output = self.run(&args, Some(&bytes))?;
        let raw: RawItem = serde_json::from_slice(&output).map_err(|_| Error::Unconfirmed)?;
        Ok(raw.id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        cell::{Cell, RefCell},
        os::unix::fs::PermissionsExt,
    };
    const VAULT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";
    const ITEM: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbb";
    fn binding() -> Binding {
        Binding {
            repository: "example/config".into(),
            host: "test-mac".into(),
            user: "admin".into(),
            ssh_host_key:
                "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                    .into(),
        }
    }
    fn secret(s: &str) -> Secret {
        Secret::new(s.as_bytes()).unwrap()
    }
    struct MemoryStore {
        item: RefCell<Option<Item>>,
        writes: Cell<usize>,
        ambiguous: Cell<bool>,
        access: Cell<bool>,
        duplicates: Cell<bool>,
        vault: RefCell<String>,
    }
    impl Default for MemoryStore {
        fn default() -> Self {
            Self {
                item: RefCell::new(None),
                writes: Cell::new(0),
                ambiguous: Cell::new(false),
                access: Cell::new(true),
                duplicates: Cell::new(false),
                vault: RefCell::new(VAULT.into()),
            }
        }
    }
    impl Store for MemoryStore {
        fn vault_id(&self, _: &str) -> Result<String, Error> {
            if self.access.get() {
                Ok(self.vault.borrow().clone())
            } else {
                Err(Error::Access)
            }
        }
        fn find(&self, _: &str, _: &str) -> Result<Vec<String>, Error> {
            Ok(if self.duplicates.get() {
                vec![ITEM.into(), "c".repeat(26)]
            } else if self.item.borrow().is_some() {
                vec![ITEM.into()]
            } else {
                vec![]
            })
        }
        fn read(&self, _: &str, _: &str) -> Result<Item, Error> {
            let item = self.item.borrow();
            let item = item.as_ref().ok_or(Error::Access)?;
            Ok(Item {
                id: item.id.clone(),
                vault: item.vault.clone(),
                binding: item.binding.clone(),
                password: secret(item.password.as_str()),
            })
        }
        fn write(
            &self,
            vault: &str,
            id: Option<&str>,
            binding: &Binding,
            password: &Secret,
        ) -> Result<String, Error> {
            assert!(id.is_none_or(|id| id == ITEM));
            self.writes.set(self.writes.get() + 1);
            *self.item.borrow_mut() = Some(Item {
                id: ITEM.into(),
                vault: vault.into(),
                binding: binding.clone(),
                password: secret(password.as_str()),
            });
            if self.ambiguous.get() {
                Err(Error::Access)
            } else {
                Ok(ITEM.into())
            }
        }
    }
    fn receipt(root: &tempfile::TempDir) -> std::path::PathBuf {
        root.path().join("host").join("administrator.json")
    }

    #[test]
    fn wrong_password_is_never_saved_and_verified_value_is_not_in_local_state() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let store = MemoryStore::default();
        let attempts = Cell::new(0);
        let prompts = Cell::new(0);
        let value = ensure(
            &store,
            "Personal",
            &binding(),
            &receipt(&root),
            |value| {
                assert_eq!(store.writes.get(), 0, "validation must precede all writes");
                attempts.set(attempts.get() + 1);
                Ok(value.as_str() == "synthetic-correct")
            },
            |rejected| {
                let n = prompts.get();
                prompts.set(n + 1);
                assert_eq!(rejected, n > 0);
                Ok(Some(secret(if n == 0 {
                    "synthetic-wrong"
                } else {
                    "synthetic-correct"
                })))
            },
        )
        .unwrap();
        assert_eq!(value.as_str(), "synthetic-correct");
        assert_eq!(store.writes.get(), 1);
        assert_eq!(attempts.get(), 2);
        let state = fs::read_to_string(receipt(&root)).unwrap();
        assert!(!state.contains("synthetic-"));
        assert!(!state.contains("password"));
        assert!(state.contains(ITEM));
    }
    #[test]
    fn verified_canonical_credential_is_reused_without_another_prompt_or_write() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |_| Ok(true),
            |_| Ok(Some(secret("fixture"))),
        )
        .unwrap();
        let calls = Cell::new(0);
        let value = ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |value| {
                calls.set(calls.get() + 1);
                Ok(value.as_str() == "fixture")
            },
            |_| panic!("saved credential should not prompt"),
        )
        .unwrap();
        assert_eq!(value.as_str(), "fixture");
        assert_eq!(calls.get(), 1);
        assert_eq!(store.writes.get(), 1);
        // A replacement client discovers the same repository/host item without a receipt.
        let other = root.path().join("replacement").join("administrator.json");
        ensure(
            &store,
            "Personal",
            &binding(),
            &other,
            |_| Ok(true),
            |_| panic!("canonical discovery must reuse"),
        )
        .unwrap();
        assert_eq!(store.writes.get(), 1);
    }
    #[test]
    fn changed_password_updates_same_item_only_after_new_value_validates() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |_| Ok(true),
            |_| Ok(Some(secret("old"))),
        )
        .unwrap();
        let value = ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |p| {
                assert_eq!(store.writes.get(), 1);
                Ok(p.as_str() == "new")
            },
            |rejected| {
                assert!(rejected);
                Ok(Some(secret("new")))
            },
        )
        .unwrap();
        assert_eq!(value.as_str(), "new");
        assert_eq!(store.writes.get(), 2);
        assert_eq!(store.item.borrow().as_ref().unwrap().id, ITEM);
    }
    #[test]
    fn ambiguous_creation_is_reconciled_by_tag_without_a_second_create() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        store.ambiguous.set(true);
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| Ok(true),
                |_| Ok(Some(secret("fixture")))
            ),
            Err(Error::Unconfirmed)
        ));
        store.ambiguous.set(false);
        ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |_| Ok(true),
            |_| panic!("lost response must reconcile"),
        )
        .unwrap();
        assert_eq!(store.writes.get(), 1);
        // If the uncertain item cannot be located, preserve the intent and stop.
        store.item.borrow_mut().take();
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| panic!()
            ),
            Err(Error::Conflict)
        ));
        assert_eq!(store.writes.get(), 1);
    }
    #[test]
    fn missing_uncertain_creation_is_not_retried_blindly() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        save(
            &path,
            &Receipt {
                schema: 1,
                vault: VAULT.into(),
                tag: binding().tag(),
                item: None,
                pending: true,
            },
        )
        .unwrap();
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| panic!()
            ),
            Err(Error::Unconfirmed)
        ));
        assert_eq!(store.writes.get(), 0);
    }
    #[test]
    fn mismatched_host_key_duplicate_item_and_changed_vault_never_receive_a_password() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        ensure(
            &store,
            "Personal",
            &binding(),
            &path,
            |_| Ok(true),
            |_| Ok(Some(secret("fixture"))),
        )
        .unwrap();
        let mut other = binding();
        other.ssh_host_key = other.ssh_host_key.replace("IAAA", "IBBB");
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &other,
                &path,
                |_| panic!("wrong target must not receive credential"),
                |_| panic!()
            ),
            Err(Error::Conflict)
        ));
        store.duplicates.set(true);
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| panic!()
            ),
            Err(Error::Conflict)
        ));
        store.duplicates.set(false);
        *store.vault.borrow_mut() = "c".repeat(26);
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| panic!()
            ),
            Err(Error::Conflict)
        ));
        assert_eq!(store.writes.get(), 1);
    }
    #[test]
    fn vault_failure_transport_failure_and_cancel_never_save() {
        let root = tempfile::tempdir().unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = receipt(&root);
        let store = MemoryStore::default();
        store.access.set(false);
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| panic!()
            ),
            Err(Error::Access)
        ));
        store.access.set(true);
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| Err(Error::Validation),
                |_| Ok(Some(secret("fixture")))
            ),
            Err(Error::Validation)
        ));
        assert!(matches!(
            ensure(
                &store,
                "Personal",
                &binding(),
                &path,
                |_| panic!(),
                |_| Ok(None)
            ),
            Err(Error::Cancelled)
        ));
        assert_eq!(store.writes.get(), 0);
        assert!(!path.exists());
    }
    #[test]
    fn unsafe_receipt_and_password_controls_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("other");
        let path = root.path().join("receipt");
        fs::write(&target, b"{}").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert!(matches!(read_receipt(&path), Err(Error::State)));
        for invalid in ["", "line\n", "\0", "\t"] {
            assert!(matches!(
                Secret::new(invalid.as_bytes()),
                Err(Error::Password)
            ));
        }
        assert!(Secret::new("paßword".as_bytes()).is_ok());
        let mut changed = binding();
        changed.host = "another-mac".into();
        assert_ne!(binding().tag(), changed.tag());
        changed = binding();
        changed.repository = "other/config".into();
        assert_ne!(binding().tag(), changed.tag());
    }
    #[test]
    fn native_provider_sends_secret_only_as_json_stdin() {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("fixture-store");
        let source =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/admin_credential.rs");
        let build = Command::new("rustc")
            .arg(source)
            .arg("-o")
            .arg(&executable)
            .env("HOMELAB_FIXTURE_TAG", binding().tag())
            .output()
            .unwrap();
        assert!(build.status.success(), "fixture did not compile");
        let provider = OnePassword {
            executable: &executable,
        };
        assert_eq!(
            provider
                .write(VAULT, None, &binding(), &secret("synthetic-stdin-password"))
                .unwrap(),
            ITEM
        );
        assert_eq!(
            provider
                .write(
                    VAULT,
                    Some(ITEM),
                    &binding(),
                    &secret("updated-synthetic-password")
                )
                .unwrap(),
            ITEM
        );
    }
}
