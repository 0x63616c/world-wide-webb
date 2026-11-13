//! One-shot guest service. The image must independently supervise `serve` with
//! launchd under the intended guest user. `tart exec submit` is only transport.
//! No JIT decoder or credential file is maintained here.
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{UnixListener, UnixStream},
    process::Command,
    time::timeout,
};
use zeroize::Zeroizing;

pub const MAX_JIT_BYTES: usize = 64 * 1024;
pub const MAX_STATUS_BYTES: u64 = 4096;
pub const DEFAULT_DIRECTORY: &str = "/var/lib/homelab-runner";
const SOCKET: &str = "guest.sock";
const STATUS: &str = "status.json";
const IO_DEADLINE: Duration = Duration::from_secs(10);

#[derive(Debug, thiserror::Error)]
pub enum GuestError {
    #[error("guest input invalid or exceeds bound")]
    Input,
    #[error("guest operation failed")]
    Io,
    #[error("guest operation deadline exceeded")]
    Timeout,
    #[error("guest already accepted an attempt; cleanup the disposable VM")]
    AlreadyAccepted,
    #[error("guest status invalid")]
    Status,
    #[error("guest private service directory invalid")]
    Directory,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum GuestPhase {
    Ready,
    Accepted,
    Executing,
    Exited,
    Failed,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalReason {
    ProcessExited,
    SpawnFailed,
    ObservationFailed,
}
/// This deliberately does not claim runner listening/job running. Those require
/// independent GitHub observations; child existence cannot establish either.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct GuestStatus {
    pub schema: u32,
    pub attempt_id: Option<String>,
    pub phase: GuestPhase,
    pub updated_at: u64,
    /// Official run.sh process exit, not job outcome or an unmasked listener exit.
    pub exit_code: Option<i32>,
    pub reason: Option<TerminalReason>,
}
impl GuestStatus {
    fn new(attempt_id: Option<String>, phase: GuestPhase) -> Self {
        Self {
            schema: 1,
            attempt_id,
            phase,
            updated_at: now(),
            exit_code: None,
            reason: None,
        }
    }
    pub fn validate(&self, expected_attempt: Option<&str>) -> Result<(), GuestError> {
        if self.schema != 1 {
            return Err(GuestError::Status);
        }
        match self.phase {
            GuestPhase::Ready => {
                if self.attempt_id.is_some() || self.exit_code.is_some() || self.reason.is_some() {
                    return Err(GuestError::Status);
                }
            }
            _ => {
                let id = self.attempt_id.as_deref().ok_or(GuestError::Status)?;
                if !valid_attempt(id) || expected_attempt.is_some_and(|expected| expected != id) {
                    return Err(GuestError::Status);
                }
                match self.phase {
                    GuestPhase::Accepted | GuestPhase::Executing
                        if self.exit_code.is_some() || self.reason.is_some() =>
                    {
                        return Err(GuestError::Status);
                    }
                    GuestPhase::Exited if self.reason != Some(TerminalReason::ProcessExited) => {
                        return Err(GuestError::Status);
                    }
                    GuestPhase::Failed
                        if !matches!(
                            self.reason,
                            Some(TerminalReason::SpawnFailed | TerminalReason::ObservationFailed)
                        ) || self.exit_code.is_some() =>
                    {
                        return Err(GuestError::Status);
                    }
                    _ => {}
                }
            }
        }
        Ok(())
    }
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
pub fn valid_attempt(id: &str) -> bool {
    id.len() == 32
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn private_directory(path: &Path) -> Result<(), GuestError> {
    if !path.is_absolute() {
        return Err(GuestError::Directory);
    }
    if !path.exists() {
        fs::DirBuilder::new()
            .mode(0o700)
            .create(path)
            .map_err(|_| GuestError::Directory)?;
    }
    let meta = fs::symlink_metadata(path).map_err(|_| GuestError::Directory)?;
    if !meta.is_dir() || meta.uid() == 0 || meta.permissions().mode() & 0o777 != 0o700 {
        return Err(GuestError::Directory);
    }
    // The image installer must also enforce the independently supervised service
    // identity. Socket peer credentials below require this same non-root owner.
    Ok(())
}
fn atomic_status(directory: &Path, status: &GuestStatus) -> Result<(), GuestError> {
    status.validate(None)?;
    let data = serde_json::to_vec(status).map_err(|_| GuestError::Status)?;
    if data.len() as u64 > MAX_STATUS_BYTES {
        return Err(GuestError::Status);
    }
    let temp = directory.join(format!(".status-{}.tmp", uuid::Uuid::new_v4().simple()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&temp)
            .map_err(|_| GuestError::Io)?;
        file.write_all(&data).map_err(|_| GuestError::Io)?;
        file.sync_all().map_err(|_| GuestError::Io)?;
        fs::rename(&temp, directory.join(STATUS)).map_err(|_| GuestError::Io)?;
        fs::File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| GuestError::Io)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
pub fn read_status(directory: &Path) -> Result<GuestStatus, GuestError> {
    private_directory(directory)?;
    let path = directory.join(STATUS);
    let meta = fs::symlink_metadata(&path).map_err(|_| GuestError::Status)?;
    if !meta.is_file() || meta.len() > MAX_STATUS_BYTES || meta.permissions().mode() & 0o077 != 0 {
        return Err(GuestError::Status);
    }
    let file = fs::File::open(path).map_err(|_| GuestError::Status)?;
    let mut data = Vec::new();
    std::io::Read::take(file, MAX_STATUS_BYTES + 1)
        .read_to_end(&mut data)
        .map_err(|_| GuestError::Status)?;
    if data.len() as u64 > MAX_STATUS_BYTES {
        return Err(GuestError::Status);
    }
    let status: GuestStatus = serde_json::from_slice(&data).map_err(|_| GuestError::Status)?;
    status.validate(None)?;
    Ok(status)
}

/// Read bounded stdin without ever formatting or logging it. The fixed helper
/// forwards a length-prefixed frame through the guest-local private socket.
pub async fn submit(
    directory: &Path,
    attempt: &str,
    input: impl tokio::io::AsyncRead + Unpin,
) -> Result<(), GuestError> {
    if !valid_attempt(attempt) {
        return Err(GuestError::Input);
    }
    private_directory(directory)?;
    let mut secret = Zeroizing::new(Vec::new());
    let mut bounded = input.take((MAX_JIT_BYTES + 1) as u64);
    timeout(IO_DEADLINE, bounded.read_to_end(&mut secret))
        .await
        .map_err(|_| GuestError::Timeout)?
        .map_err(|_| GuestError::Io)?;
    validate_jit(&secret)?;
    timeout(IO_DEADLINE, async {
        let mut stream = UnixStream::connect(directory.join(SOCKET))
            .await
            .map_err(|_| GuestError::Io)?;
        verify_peer(&stream, directory)?;
        stream
            .write_all(attempt.as_bytes())
            .await
            .map_err(|_| GuestError::Io)?;
        stream
            .write_u32(secret.len() as u32)
            .await
            .map_err(|_| GuestError::Io)?;
        stream
            .write_all(&secret)
            .await
            .map_err(|_| GuestError::Io)?;
        stream.shutdown().await.map_err(|_| GuestError::Io)?;
        let mut ack = [0u8; 1];
        stream
            .read_exact(&mut ack)
            .await
            .map_err(|_| GuestError::Io)?;
        match ack[0] {
            0 => Ok(()),
            1 => Err(GuestError::AlreadyAccepted),
            _ => Err(GuestError::Io),
        }
    })
    .await
    .map_err(|_| GuestError::Timeout)?
}
fn validate_jit(bytes: &[u8]) -> Result<(), GuestError> {
    if bytes.is_empty()
        || bytes.len() > MAX_JIT_BYTES
        || !bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || b"+/=_-".contains(b))
    {
        return Err(GuestError::Input);
    }
    Ok(())
}

#[derive(Clone, Debug)]
pub struct ServiceConfig {
    pub directory: PathBuf,
    pub runner: PathBuf,
    pub home: PathBuf,
}
/// Run as an independently installed launchd service. It accepts at most one
/// attempt over its entire VM lifetime, including after service restart.
pub async fn serve(config: ServiceConfig) -> Result<(), GuestError> {
    private_directory(&config.directory)?;
    if !config.runner.is_absolute() || !config.home.is_absolute() {
        return Err(GuestError::Directory);
    }
    let socket = config.directory.join(SOCKET);
    // Refuse to steal a live service's socket. A stale socket can be removed only
    // after its listener cannot be reached. Directory permissions protect it.
    if socket.exists() {
        let probe = timeout(Duration::from_secs(1), UnixStream::connect(&socket)).await;
        if !matches!(probe, Ok(Err(_))) {
            return Err(GuestError::Io);
        }
        fs::remove_file(&socket).map_err(|_| GuestError::Io)?;
    }
    let status_path = config.directory.join(STATUS);
    let mut accepted = if status_path.exists() {
        read_status(&config.directory)?.phase != GuestPhase::Ready
    } else {
        atomic_status(
            &config.directory,
            &GuestStatus::new(None, GuestPhase::Ready),
        )?;
        false
    };
    let listener = UnixListener::bind(&socket).map_err(|_| GuestError::Io)?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600)).map_err(|_| GuestError::Io)?;
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|_| GuestError::Io)?;
        if verify_peer(&stream, &config.directory).is_err() {
            continue;
        }
        if accepted {
            let _ = stream.write_all(&[1]).await;
            continue;
        }
        let payload = timeout(IO_DEADLINE, read_submission(&mut stream)).await;
        let Ok(Ok((attempt, secret))) = payload else {
            let _ = stream.write_all(&[2]).await;
            continue;
        };
        // Persist the claim BEFORE starting the child. Restart never replays a
        // credential when claim/spawn/ack outcome is uncertain.
        atomic_status(
            &config.directory,
            &GuestStatus::new(Some(attempt.clone()), GuestPhase::Accepted),
        )?;
        accepted = true;
        let launched = start_runner(&config, &attempt, secret).await;
        let _ = stream
            .write_all(&[if launched.is_ok() { 0 } else { 2 }])
            .await;
    }
}
fn verify_peer(stream: &UnixStream, directory: &Path) -> Result<(), GuestError> {
    let owner = fs::metadata(directory)
        .map_err(|_| GuestError::Directory)?
        .uid();
    let peer = stream.peer_cred().map_err(|_| GuestError::Io)?.uid();
    if owner == 0 || owner != peer {
        return Err(GuestError::Directory);
    }
    Ok(())
}
async fn read_submission(
    stream: &mut UnixStream,
) -> Result<(String, Zeroizing<Vec<u8>>), GuestError> {
    let mut attempt = [0u8; 32];
    stream
        .read_exact(&mut attempt)
        .await
        .map_err(|_| GuestError::Input)?;
    let attempt = String::from_utf8(attempt.to_vec()).map_err(|_| GuestError::Input)?;
    if !valid_attempt(&attempt) {
        return Err(GuestError::Input);
    }
    let length = stream.read_u32().await.map_err(|_| GuestError::Input)? as usize;
    if length == 0 || length > MAX_JIT_BYTES {
        return Err(GuestError::Input);
    }
    let mut secret = Zeroizing::new(vec![0; length]);
    stream
        .read_exact(&mut secret)
        .await
        .map_err(|_| GuestError::Input)?;
    // EOF is part of the frame: reject extra bytes rather than parsing another request.
    let mut trailing = [0u8; 1];
    if stream
        .read(&mut trailing)
        .await
        .map_err(|_| GuestError::Input)?
        != 0
    {
        return Err(GuestError::Input);
    }
    validate_jit(&secret)?;
    Ok((attempt, secret))
}
async fn start_runner(
    config: &ServiceConfig,
    attempt: &str,
    secret: Zeroizing<Vec<u8>>,
) -> Result<(), GuestError> {
    let jit = std::str::from_utf8(&secret).map_err(|_| GuestError::Input)?;
    let mut cmd = Command::new(&config.runner);
    cmd.env_clear()
        .env("HOME", &config.home)
        // The controller verifies the pinned image's admin identity before JIT.
        // Native Apple tools also consult these basic identity variables.
        .env("USER", "admin")
        .env("LOGNAME", "admin")
        .env(
            "PATH",
            if cfg!(target_os = "linux") {
                "/home/admin/.cargo/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            } else {
                "/Users/admin/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
            },
        )
        .env("ACTIONS_RUNNER_INPUT_JITCONFIG", jit)
        // Supported by the pinned official wrapper; preserve its retry/update loop.
        .env("ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE", "1")
        .current_dir(config.runner.parent().ok_or(GuestError::Directory)?)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(false);
    let spawn = cmd.spawn();
    // Command owns a copy of the child environment. Drop it immediately after
    // spawn; the short-lived guest child input is the supported runner contract.
    drop(cmd);
    drop(secret);
    let mut child = match spawn {
        Ok(child) => child,
        Err(_) => {
            let mut status = GuestStatus::new(Some(attempt.into()), GuestPhase::Failed);
            status.reason = Some(TerminalReason::SpawnFailed);
            atomic_status(&config.directory, &status)?;
            return Err(GuestError::Io);
        }
    };
    atomic_status(
        &config.directory,
        &GuestStatus::new(Some(attempt.into()), GuestPhase::Executing),
    )?;
    let directory = config.directory.clone();
    let attempt = attempt.to_owned();
    tokio::spawn(async move {
        let result = child.wait().await;
        let mut status = GuestStatus::new(Some(attempt), GuestPhase::Exited);
        match result {
            Ok(exit) => {
                status.exit_code = exit.code();
                status.reason = Some(TerminalReason::ProcessExited);
            }
            Err(_) => {
                status.phase = GuestPhase::Failed;
                status.reason = Some(TerminalReason::ObservationFailed);
            }
        }
        // A write failure leaves the older conservative record. Never emits logs
        // or pretends a failed status write proves successful job completion.
        let _ = atomic_status(&directory, &status);
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn directory() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        dir
    }
    #[test]
    fn status_is_bounded_atomic_and_bound_to_attempt() {
        let dir = directory();
        let id = "0123456789abcdef0123456789abcdef";
        let status = GuestStatus::new(Some(id.into()), GuestPhase::Accepted);
        atomic_status(dir.path(), &status).unwrap();
        let read = read_status(dir.path()).unwrap();
        assert_eq!(read.phase, GuestPhase::Accepted);
        assert!(
            read.validate(Some("abcdef0123456789abcdef0123456789"))
                .is_err()
        );
        assert_eq!(
            fs::metadata(dir.path().join(STATUS)).unwrap().mode() & 0o777,
            0o600
        );
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        fs::write(
            dir.path().join(STATUS),
            vec![b'x'; MAX_STATUS_BYTES as usize + 1],
        )
        .unwrap();
        assert!(read_status(dir.path()).is_err());
    }
    #[test]
    fn input_validation_never_formats_payload() {
        let credential = b"TOP_SECRET_JIT_SENTINEL";
        assert!(validate_jit(credential).is_ok());
        assert!(!format!("{:?}", GuestError::Input).contains("TOP_SECRET"));
        assert!(validate_jit(&vec![b'a'; MAX_JIT_BYTES + 1]).is_err());
        assert!(validate_jit(b"abc\n").is_err());
    }
    #[tokio::test]
    async fn raw_frame_is_bounded() {
        let (mut writer, mut reader) = UnixStream::pair().unwrap();
        let task = tokio::spawn(async move {
            writer
                .write_all(b"0123456789abcdef0123456789abcdef")
                .await
                .unwrap();
            writer.write_u32((MAX_JIT_BYTES + 1) as u32).await.unwrap();
        });
        assert!(matches!(
            read_submission(&mut reader).await,
            Err(GuestError::Input)
        ));
        task.await.unwrap();
    }
    #[tokio::test]
    async fn independent_service_accepts_only_once_without_persisting_secret() {
        let dir = directory();
        let executable = dir.path().join("runner");
        // Fixture is a harmless executable with a shebang, not production bootstrap.
        fs::write(
            &executable,
            "#!/bin/sh\n[ -n \"$ACTIONS_RUNNER_INPUT_JITCONFIG\" ] || exit 42\nexit 0\n",
        )
        .unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let config = ServiceConfig {
            directory: dir.path().into(),
            runner: executable,
            home: dir.path().into(),
        };
        let service = tokio::spawn(serve(config));
        let id = "0123456789abcdef0123456789abcdef";
        for _ in 0..100 {
            if dir.path().join(SOCKET).exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        submit(dir.path(), id, b"SECRET_SENTINEL".as_slice())
            .await
            .unwrap();
        assert!(matches!(
            submit(dir.path(), id, b"SECRET_SENTINEL".as_slice()).await,
            Err(GuestError::AlreadyAccepted) | Err(GuestError::Io)
        ));
        for _ in 0..100 {
            if read_status(dir.path()).unwrap().phase == GuestPhase::Exited {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let status = read_status(dir.path()).unwrap();
        assert_eq!(status.phase, GuestPhase::Exited);
        assert_eq!(status.exit_code, Some(0));
        assert!(
            !String::from_utf8(fs::read(dir.path().join(STATUS)).unwrap())
                .unwrap()
                .contains("SECRET_SENTINEL")
        );
        service.abort();
        let _ = service.await;
        // A service restart must retain the accepted claim and never spawn again.
        let config = ServiceConfig {
            directory: dir.path().into(),
            runner: dir.path().join("runner"),
            home: dir.path().into(),
        };
        let service = tokio::spawn(serve(config));
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert!(
            submit(dir.path(), id, b"SECRET_SENTINEL".as_slice())
                .await
                .is_err()
        );
        service.abort();
    }
    #[tokio::test]
    async fn official_wrapper_runs_in_sdk_root_and_propagates_supported_version_exit() {
        let dir = directory();
        let sdk = dir.path().join("actions-runner");
        fs::create_dir_all(sdk.join("bin")).unwrap();
        let runner = sdk.join("run.sh");
        // Model the pinned official wrapper's 2/3/4 retry and optional 7 contract.
        // The helper must launch it once, without a new Rust retry loop or run arg.
        fs::write(dir.path().join("listener-exits"), b"2\n3\n4\n7\n").unwrap();
        let cargo_prefix = if cfg!(target_os = "linux") {
            "/home/admin/.cargo/bin"
        } else {
            "/Users/admin/.cargo/bin"
        };
        fs::write(
            &runner,
            concat!(
                "#!/bin/sh\n",
                "test \"$#\" = 0 || exit 71\n",
                "test \"$PWD\" = \"$HOME/actions-runner\" || exit 72\n",
                "test \"$USER\" = admin && test \"$LOGNAME\" = admin || exit 75\n",
                "case \"$PATH\" in __CARGO_PREFIX__:*) ;; *) exit 73 ;; esac\n",
                "test -n \"$ACTIONS_RUNNER_INPUT_JITCONFIG\" || exit 74\n",
                "echo JOB_OUTPUT_SENTINEL\necho PRIVATE_STDERR_SENTINEL >&2\n",
                "while read -r code; do\n",
                "printf '%s\\n' \"$code\" >> \"$HOME/wrapper-observed\"\n",
                "case \"$code\" in\n",
                "2|3|4) continue ;;\n",
                "7) if [ \"$ACTIONS_RUNNER_RETURN_VERSION_DEPRECATED_EXIT_CODE\" = 1 ]; then exit 7; else exit 0; fi ;;\n",
                "*) exit 0 ;;\nesac\ndone < \"$HOME/listener-exits\"\n"
            ).replace("__CARGO_PREFIX__", cargo_prefix),
        )
        .unwrap();
        fs::set_permissions(&runner, fs::Permissions::from_mode(0o700)).unwrap();
        start_runner(
            &ServiceConfig {
                directory: dir.path().into(),
                runner,
                home: fs::canonicalize(dir.path()).unwrap(),
            },
            &"a".repeat(32),
            Zeroizing::new(b"JIT_SENTINEL".to_vec()),
        )
        .await
        .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while read_status(dir.path()).unwrap().phase != GuestPhase::Exited {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let status = read_status(dir.path()).unwrap();
        assert_eq!(status.exit_code, Some(7));
        assert_eq!(
            fs::read(dir.path().join("wrapper-observed")).unwrap(),
            b"2\n3\n4\n7\n"
        );
        let bytes = fs::read_to_string(dir.path().join(STATUS)).unwrap();
        assert!(!bytes.contains("SENTINEL"));
    }
    #[tokio::test]
    async fn losing_submit_connection_does_not_cancel_or_replay_runner() {
        let dir = directory();
        let executable = dir.path().join("runner");
        fs::write(&executable, "#!/bin/sh\n/bin/sleep 0.1\nexit 0\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let service = tokio::spawn(serve(ServiceConfig {
            directory: dir.path().into(),
            runner: executable,
            home: dir.path().into(),
        }));
        for _ in 0..100 {
            if dir.path().join(SOCKET).exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let mut transport = UnixStream::connect(dir.path().join(SOCKET)).await.unwrap();
        transport
            .write_all(b"0123456789abcdef0123456789abcdef")
            .await
            .unwrap();
        transport.write_u32(8).await.unwrap();
        transport.write_all(b"JIT_TEST").await.unwrap();
        transport.shutdown().await.unwrap();
        // Let the service authenticate its peer and accept the one-shot claim.
        // macOS cannot authenticate a socket whose client already disappeared.
        for _ in 0..100 {
            if read_status(dir.path()).unwrap().phase != GuestPhase::Ready {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert_ne!(read_status(dir.path()).unwrap().phase, GuestPhase::Ready);
        drop(transport); // Lost attached exec/client must leave the service owning the child.
        for _ in 0..100 {
            if read_status(dir.path()).unwrap().phase == GuestPhase::Exited {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        let status = read_status(dir.path()).unwrap();
        assert_eq!(status.phase, GuestPhase::Exited);
        assert_eq!(status.exit_code, Some(0));
        assert!(
            submit(
                dir.path(),
                "abcdef0123456789abcdef0123456789",
                b"JIT_TEST".as_slice()
            )
            .await
            .is_err()
        );
        service.abort();
    }
}
