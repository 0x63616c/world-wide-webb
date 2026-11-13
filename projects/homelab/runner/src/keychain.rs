//! Dedicated service-account login keychain feasibility helper.
//! Successful selection/unlock does not prove Tart works before GUI login.
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "macos", test))]
use std::path::Path;
use std::path::PathBuf;
#[cfg(any(target_os = "macos", test))]
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
};
#[cfg(target_os = "macos")]
use std::{process::Stdio, time::Duration};
#[cfg(any(target_os = "macos", test))]
use zeroize::Zeroizing;

#[cfg(any(target_os = "macos", test))]
const SERVICE_UID: u32 = 451;
#[cfg(any(target_os = "macos", test))]
const MAX_PASSWORD_BYTES: u64 = 4096;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeychainConfig {
    pub service_uid: u32,
    pub service_home: PathBuf,
    pub password_file: PathBuf,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KeychainProof {
    pub created: bool,
    pub login_selected: bool,
}
#[derive(Debug, thiserror::Error)]
pub enum KeychainError {
    #[error("keychain preparation requires UID 451 and its dedicated /var/lib/_runner home")]
    Identity,
    #[error("keychain directory, keychain, or password file permissions are unsafe")]
    Permissions,
    #[error(
        "keychain password must be nonempty UTF-8, bounded to 4096 bytes, without NUL or newlines"
    )]
    Password,
    #[error("native keychain operation failed (OSStatus {0}); no password changes were attempted")]
    Native(i32),
    #[error("dedicated service login-keychain verification failed")]
    Selection,
    #[error("keychain helper is only available on macOS")]
    Unsupported,
    #[error("keychain file I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[cfg(any(target_os = "macos", test))]
fn validate_identity(
    config: &KeychainConfig,
    effective_uid: u32,
    actual_home: &Path,
) -> Result<(), KeychainError> {
    if config.service_uid != SERVICE_UID
        || effective_uid != SERVICE_UID
        || ![
            Path::new("/var/lib/_runner"),
            Path::new("/private/var/lib/_runner"),
        ]
        .contains(&config.service_home.as_path())
        || actual_home != config.service_home
    {
        return Err(KeychainError::Identity);
    }
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
fn private_directory(path: &Path, uid: u32, create: bool) -> Result<(), KeychainError> {
    if create {
        match fs::DirBuilder::new().mode(0o700).create(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.into()),
        }
    }
    let m = fs::symlink_metadata(path)?;
    if !m.is_dir() || m.uid() != uid || m.mode() & 0o077 != 0 {
        return Err(KeychainError::Permissions);
    }
    Ok(())
}
#[cfg(any(target_os = "macos", test))]
fn private_keychain(path: &Path, uid: u32) -> Result<bool, KeychainError> {
    let m = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(error.into()),
    };
    if !m.is_file() || m.nlink() != 1 || m.uid() != uid || m.mode() & 0o077 != 0 {
        return Err(KeychainError::Permissions);
    }
    Ok(true)
}
#[cfg(any(target_os = "macos", test))]
fn password(path: &Path, uid: u32) -> Result<Zeroizing<Vec<u8>>, KeychainError> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)?;
    let m = file.metadata()?;
    if !m.is_file() || m.nlink() != 1 || m.uid() != uid || m.mode() & 0o7777 != 0o400 {
        return Err(KeychainError::Permissions);
    }
    let mut bytes = Zeroizing::new(Vec::new());
    file.by_ref()
        .take(MAX_PASSWORD_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.is_empty()
        || bytes.len() as u64 > MAX_PASSWORD_BYTES
        || bytes.iter().any(|b| [0, b'\n', b'\r'].contains(b))
        || std::str::from_utf8(&bytes).is_err()
    {
        return Err(KeychainError::Password);
    }
    Ok(bytes)
}

#[cfg(any(target_os = "macos", test))]
fn login_keychain_matches(bytes: &[u8], expected: &Path) -> Result<bool, KeychainError> {
    if bytes.len() > 4096 {
        return Err(KeychainError::Selection);
    }
    let selected = std::str::from_utf8(bytes)
        .map_err(|_| KeychainError::Selection)?
        .trim()
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .filter(|value| !value.contains(['\n', '\r']))
        .map(Path::new)
        .filter(|path| path.is_absolute())
        .ok_or(KeychainError::Selection)?;
    Ok(fs::canonicalize(selected)? == fs::canonicalize(expected)?)
}

/// Run explicitly as the dedicated account. Never called by local unit tests.
#[cfg(target_os = "macos")]
pub async fn prepare(config: &KeychainConfig) -> Result<KeychainProof, KeychainError> {
    use security_framework::os::macos::keychain::{CreateOptions, SecKeychain};
    let uid = rustix::process::geteuid().as_raw();
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or(KeychainError::Identity)?;
    validate_identity(config, uid, &home)?;
    private_directory(&config.service_home, uid, false)?;
    let library = config.service_home.join("Library");
    private_directory(&library, uid, true)?;
    let directory = library.join("Keychains");
    private_directory(&directory, uid, true)?;
    let path = directory.join("login.keychain-db");
    let exists = private_keychain(&path, uid)?;
    let bytes = password(&config.password_file, uid)?;
    let secret = std::str::from_utf8(&bytes).map_err(|_| KeychainError::Password)?;
    let _no_prompts =
        SecKeychain::disable_user_interaction().map_err(|e| KeychainError::Native(e.code()))?;
    let mut keychain = if exists {
        SecKeychain::open(&path).map_err(|e| KeychainError::Native(e.code()))?
    } else {
        // CreateOptions internally copies the password; this maintained wrapper owns
        // that temporary allocation. Our runtime-file buffer is zeroized on drop.
        let keychain = CreateOptions::new()
            .password(secret)
            .prompt_user(false)
            .create(&path)
            .map_err(|e| KeychainError::Native(e.code()))?;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))?;
        keychain
    };
    keychain
        .unlock(Some(secret))
        .map_err(|e| KeychainError::Native(e.code()))?;
    drop(bytes);
    private_keychain(&path, uid)?;
    // Apple's advertised login-keychain setter is compiled out. Creation at
    // the standard login path selects it; verify the native getter's result.
    let mut selection = tokio::process::Command::new("/usr/bin/security");
    selection
        .arg("login-keychain")
        .env_clear()
        .env("HOME", &config.service_home)
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    let mut child = selection.spawn()?;
    let selected = tokio::time::timeout(Duration::from_secs(30), async {
        use tokio::io::AsyncReadExt;
        let stdout = child.stdout.take().ok_or(KeychainError::Selection)?;
        let mut bytes = Vec::new();
        stdout.take(4097).read_to_end(&mut bytes).await?;
        if bytes.len() > 4096 || !child.wait().await?.success() {
            return Err(KeychainError::Selection);
        }
        login_keychain_matches(&bytes, &path)
    })
    .await
    .map_err(|_| KeychainError::Selection)??;
    if !selected {
        return Err(KeychainError::Selection);
    }
    Ok(KeychainProof {
        created: !exists,
        login_selected: true,
    })
}

#[cfg(not(target_os = "macos"))]
pub async fn prepare(_config: &KeychainConfig) -> Result<KeychainProof, KeychainError> {
    Err(KeychainError::Unsupported)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> KeychainConfig {
        KeychainConfig {
            service_uid: 451,
            service_home: "/var/lib/_runner".into(),
            password_file: "/run/secret".into(),
        }
    }
    #[test]
    fn human_root_wrong_home_and_path_traversal_are_rejected_before_native_calls() {
        let c = config();
        assert!(validate_identity(&c, 451, Path::new("/var/lib/_runner")).is_ok());
        for uid in [0, 501, 1000] {
            assert!(matches!(
                validate_identity(&c, uid, &c.service_home),
                Err(KeychainError::Identity)
            ));
        }
        for home in [
            "/Users/calum",
            "/var/lib/_runner/../_runner",
            "/tmp/_runner",
        ] {
            let mut c = config();
            c.service_home = home.into();
            assert!(matches!(
                validate_identity(&c, 451, &c.service_home),
                Err(KeychainError::Identity)
            ));
        }
        assert!(validate_identity(&c, 451, Path::new("/Users/calum")).is_err());
    }
    #[test]
    fn password_file_requires_private_owner_exact_mode_and_bounded_plain_input() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("password");
        fs::write(&path, b"fixture-password").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        let uid = rustix::process::geteuid().as_raw();
        assert_eq!(
            password(&path, uid).unwrap().as_slice(),
            b"fixture-password"
        );
        assert!(matches!(
            password(&path, uid + 1),
            Err(KeychainError::Permissions)
        ));
        for data in [
            vec![],
            vec![b'x'; MAX_PASSWORD_BYTES as usize + 1],
            b"line\n".to_vec(),
            vec![0],
            vec![255],
        ] {
            fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
            fs::write(&path, data).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
            assert!(matches!(password(&path, uid), Err(KeychainError::Password)));
        }
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(matches!(
            password(&path, uid),
            Err(KeychainError::Permissions)
        ));
    }
    #[test]
    fn symlink_password_and_keychain_are_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        let link = dir.path().join("link");
        fs::write(&target, b"fixture").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o400)).unwrap();
        std::os::unix::fs::symlink(&target, &link).unwrap();
        let uid = rustix::process::geteuid().as_raw();
        assert!(password(&link, uid).is_err());
        assert!(matches!(
            private_keychain(&link, uid),
            Err(KeychainError::Permissions)
        ));
        assert!(!private_keychain(&dir.path().join("absent"), uid).unwrap());
    }

    #[test]
    fn service_directories_must_be_private_owned_and_not_symlinks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Keychains");
        let uid = rustix::process::geteuid().as_raw();
        private_directory(&path, uid, true).unwrap();
        assert!(matches!(
            private_directory(&path, uid + 1, false),
            Err(KeychainError::Permissions)
        ));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(matches!(
            private_directory(&path, uid, false),
            Err(KeychainError::Permissions)
        ));
        let link = dir.path().join("link");
        std::os::unix::fs::symlink(&path, &link).unwrap();
        assert!(matches!(
            private_directory(&link, uid, false),
            Err(KeychainError::Permissions)
        ));
    }

    #[test]
    fn getter_accepts_only_one_absolute_path_resolving_to_the_dedicated_keychain() {
        let root = tempfile::tempdir().unwrap();
        let expected = root.path().join("login.keychain-db");
        let other = root.path().join("human.keychain-db");
        let alias = root.path().join("canonical-alias");
        fs::write(&expected, b"dedicated fixture").unwrap();
        fs::write(&other, b"preserve other fixture").unwrap();
        std::os::unix::fs::symlink(&expected, &alias).unwrap();
        for path in [&expected, &alias] {
            let output = format!("    \"{}\"\n", path.display());
            assert!(login_keychain_matches(output.as_bytes(), &expected).unwrap());
        }
        assert!(
            !login_keychain_matches(format!("\"{}\"", other.display()).as_bytes(), &expected)
                .unwrap()
        );
        assert_eq!(fs::read(&other).unwrap(), b"preserve other fixture");
        for invalid in [
            Vec::new(),
            b"login.keychain-db".to_vec(),
            b"\"relative/login.keychain-db\"".to_vec(),
            format!("\"{}\"\n\"{}\"", expected.display(), other.display()).into_bytes(),
            b"\"/first\n/second\"".to_vec(),
            vec![b'x'; 4097],
            vec![255],
        ] {
            assert!(login_keychain_matches(&invalid, &expected).is_err());
        }
    }
}
