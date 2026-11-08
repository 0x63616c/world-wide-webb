//! A root-owned activation hold drains the service before Nix replaces its generation.
//! The controller acknowledges only a currently observed token, after suppressing admission.
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};

const MAX_BYTES: u64 = 4096;
const REQUEST: &str = "hold.json";
const ACK: &str = "hold-status.json";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct HoldRequest {
    pub token: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Ack {
    pub token: String,
    pub idle: bool,
}
#[derive(Debug, thiserror::Error)]
pub enum GateError {
    #[error("activation gate has unsafe permissions or a symlink")]
    Permissions,
    #[error("activation gate record is invalid")]
    Invalid,
    #[error("another activation hold already exists")]
    AlreadyHeld,
    #[error("activation hold changed or disappeared")]
    HoldChanged,
    #[error("timed out waiting for controller to acknowledge idle; hold remains active")]
    Timeout,
    #[error("activation gate I/O failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug)]
pub struct Gate {
    control_dir: PathBuf,
    status_dir: PathBuf,
}
impl Gate {
    /// Ownership policy belongs to the caller: production control_dir is root-owned,
    /// status_dir service-owned. This module enforces modes and refuses symlinks.
    pub fn new(control_dir: impl Into<PathBuf>, status_dir: impl Into<PathBuf>) -> Self {
        Self {
            control_dir: control_dir.into(),
            status_dir: status_dir.into(),
        }
    }

    /// Root activation pre-hook. Exclusive publication never replaces another hold.
    pub fn request_hold(&self) -> Result<HoldRequest, GateError> {
        create_directory(&self.control_dir, 0o755)?;
        let request = HoldRequest {
            token: uuid::Uuid::new_v4().simple().to_string(),
        };
        atomic_write(&self.control_dir, REQUEST, &request, 0o644, true)?;
        Ok(request)
    }

    /// Any parse/permission/I/O error MUST suppress admission just like a hold.
    pub fn read_hold(&self) -> Result<Option<HoldRequest>, GateError> {
        if !check_optional_directory(&self.control_dir, 0o755)? {
            return Ok(None);
        }
        let request: Option<HoldRequest> = read_record(&self.control_dir.join(REQUEST), 0o644)?;
        if request.as_ref().is_some_and(|r| !valid_token(&r.token)) {
            return Err(GateError::Invalid);
        }
        Ok(request)
    }

    /// Call only after observing the hold and applying it to the scheduling decision.
    /// `idle` means the durable journal has no attempt and owned inventory is absent.
    pub fn acknowledge(&self, request: &HoldRequest, idle: bool) -> Result<(), GateError> {
        self.require_hold(request)?;
        create_directory(&self.status_dir, 0o700)?;
        atomic_write(
            &self.status_dir,
            ACK,
            &Ack {
                token: request.token.clone(),
                idle,
            },
            0o600,
            false,
        )?;
        // A changed hold can leave a stale ack, which readers reject by nonce.
        self.require_hold(request)
    }

    pub fn read_ack(&self, request: &HoldRequest) -> Result<Option<Ack>, GateError> {
        self.require_hold(request)?;
        if !check_optional_directory(&self.status_dir, 0o700)? {
            return Ok(None);
        }
        let ack: Option<Ack> = read_record(&self.status_dir.join(ACK), 0o600)?;
        if ack.as_ref().is_some_and(|a| !valid_token(&a.token)) {
            return Err(GateError::Invalid);
        }
        Ok(ack.filter(|ack| ack.token == request.token))
    }

    /// Root post-hook, after the replacement service definition has been installed.
    pub fn release(&self, request: &HoldRequest) -> Result<(), GateError> {
        self.require_hold(request)?;
        fs::remove_file(self.control_dir.join(REQUEST))?;
        File::open(&self.control_dir)?.sync_all()?;
        Ok(())
    }

    pub async fn wait_until_idle(
        &self,
        request: &HoldRequest,
        timeout: Duration,
    ) -> Result<(), GateError> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if self.read_ack(request)?.is_some_and(|ack| ack.idle) {
                return Ok(());
            }
            let now = tokio::time::Instant::now();
            if now >= deadline {
                return Err(GateError::Timeout);
            }
            tokio::time::sleep((deadline - now).min(Duration::from_millis(100))).await;
        }
    }

    fn require_hold(&self, request: &HoldRequest) -> Result<(), GateError> {
        if !valid_token(&request.token) {
            return Err(GateError::Invalid);
        }
        if self.read_hold()?.as_ref() != Some(request) {
            return Err(GateError::HoldChanged);
        }
        Ok(())
    }
}

fn valid_token(token: &str) -> bool {
    token.len() == 32
        && token
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn create_directory(path: &Path, mode: u32) -> Result<(), GateError> {
    match fs::DirBuilder::new().mode(mode).create(path) {
        Ok(()) => fs::set_permissions(path, fs::Permissions::from_mode(mode))?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error.into()),
    }
    check_directory(path, mode)
}
fn check_optional_directory(path: &Path, mode: u32) -> Result<bool, GateError> {
    match fs::symlink_metadata(path) {
        Ok(_) => {
            check_directory(path, mode)?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}
fn check_directory(path: &Path, mode: u32) -> Result<(), GateError> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || metadata.mode() & 0o7777 != mode {
        return Err(GateError::Permissions);
    }
    Ok(())
}
fn read_record<T: DeserializeOwned>(path: &Path, mode: u32) -> Result<Option<T>, GateError> {
    let mut file = match OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || metadata.mode() & 0o7777 != mode {
        return Err(GateError::Permissions);
    }
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(GateError::Invalid);
    }
    serde_json::from_slice(&bytes)
        .map(Some)
        .map_err(|_| GateError::Invalid)
}
fn atomic_write<T: Serialize>(
    directory: &Path,
    name: &str,
    value: &T,
    mode: u32,
    exclusive: bool,
) -> Result<(), GateError> {
    let bytes = serde_json::to_vec(value).map_err(|_| GateError::Invalid)?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(GateError::Invalid);
    }
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(mode))?;
    temporary.write_all(&bytes)?;
    temporary.as_file().sync_all()?;
    let target = directory.join(name);
    if exclusive {
        // link is atomic and fails rather than overwriting an already active request.
        fs::hard_link(temporary.path(), &target).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                GateError::AlreadyHeld
            } else {
                GateError::Io(error)
            }
        })?;
        // Readers require nlink=1, and fail closed during this tiny publication window.
        temporary.close()?;
    } else {
        if let Ok(metadata) = fs::symlink_metadata(&target)
            && (!metadata.is_file() || metadata.nlink() != 1 || metadata.mode() & 0o7777 != mode)
        {
            return Err(GateError::Permissions);
        }
        temporary
            .persist(target)
            .map_err(|e| GateError::Io(e.error))?;
    }
    File::open(directory)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Gate) {
        let root = tempfile::tempdir().unwrap();
        let gate = Gate::new(root.path().join("control"), root.path().join("state"));
        (root, gate)
    }
    #[test]
    fn hold_requires_matching_nonce_idle_ack_and_explicit_release() {
        let (_root, gate) = fixture();
        assert_eq!(gate.read_hold().unwrap(), None);
        let request = gate.request_hold().unwrap();
        assert_eq!(gate.read_hold().unwrap(), Some(request.clone()));
        assert!(matches!(gate.request_hold(), Err(GateError::AlreadyHeld)));
        gate.acknowledge(&request, false).unwrap();
        assert!(!gate.read_ack(&request).unwrap().unwrap().idle);
        gate.acknowledge(&request, true).unwrap();
        assert!(gate.read_ack(&request).unwrap().unwrap().idle);
        let wrong = HoldRequest {
            token: "f".repeat(32),
        };
        assert!(matches!(gate.release(&wrong), Err(GateError::HoldChanged)));
        gate.release(&request).unwrap();
        assert_eq!(gate.read_hold().unwrap(), None);
        assert!(matches!(
            gate.acknowledge(&request, true),
            Err(GateError::HoldChanged)
        ));
    }
    #[test]
    fn stale_idle_ack_cannot_drain_a_new_hold() {
        let (_root, gate) = fixture();
        let first = gate.request_hold().unwrap();
        gate.acknowledge(&first, true).unwrap();
        gate.release(&first).unwrap();
        let second = gate.request_hold().unwrap();
        assert_ne!(first.token, second.token);
        assert_eq!(gate.read_ack(&second).unwrap(), None);
    }
    #[test]
    fn symlink_directory_request_and_ack_are_rejected() {
        let (root, gate) = fixture();
        let outside = root.path().join("outside");
        fs::create_dir(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &gate.control_dir).unwrap();
        assert!(matches!(gate.read_hold(), Err(GateError::Permissions)));
        fs::remove_file(&gate.control_dir).unwrap();
        let request = gate.request_hold().unwrap();
        fs::remove_file(gate.control_dir.join(REQUEST)).unwrap();
        std::os::unix::fs::symlink(root.path().join("other"), gate.control_dir.join(REQUEST))
            .unwrap();
        assert!(gate.read_hold().is_err());
        fs::remove_file(gate.control_dir.join(REQUEST)).unwrap();
        let request2 = gate.request_hold().unwrap();
        gate.acknowledge(&request2, false).unwrap();
        fs::remove_file(gate.status_dir.join(ACK)).unwrap();
        std::os::unix::fs::symlink(root.path().join("other"), gate.status_dir.join(ACK)).unwrap();
        assert!(gate.acknowledge(&request2, true).is_err());
        assert!(matches!(
            gate.release(&request),
            Err(GateError::HoldChanged)
        ));
    }
    #[test]
    fn malformed_oversize_and_shared_writable_records_fail_closed() {
        let (_root, gate) = fixture();
        gate.request_hold().unwrap();
        let path = gate.control_dir.join(REQUEST);
        for contents in [
            "{bad".to_owned(),
            "x".repeat(MAX_BYTES as usize + 1),
            "{\"token\":\"short\"}".to_owned(),
        ] {
            fs::write(&path, contents).unwrap();
            assert!(matches!(gate.read_hold(), Err(GateError::Invalid)));
        }
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        assert!(matches!(gate.read_hold(), Err(GateError::Permissions)));
        fs::set_permissions(&gate.control_dir, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(matches!(gate.read_hold(), Err(GateError::Permissions)));
    }
    #[tokio::test]
    async fn timeout_retains_hold_and_idle_ack_completes_wait() {
        let (_root, gate) = fixture();
        let request = gate.request_hold().unwrap();
        assert!(matches!(
            gate.wait_until_idle(&request, Duration::ZERO).await,
            Err(GateError::Timeout)
        ));
        assert_eq!(gate.read_hold().unwrap(), Some(request.clone()));
        gate.acknowledge(&request, true).unwrap();
        gate.wait_until_idle(&request, Duration::ZERO)
            .await
            .unwrap();
    }
}
