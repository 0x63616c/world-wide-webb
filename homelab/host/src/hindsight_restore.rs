//! Fresh-database rehearsal inside the pinned Hindsight image, never an in-place restore.
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rustix::fs::{Mode, OFlags, open};
use serde::Deserialize;

use crate::process;

const HOME: &str = "/home/hindsight";
const PG0: &str = "/app/api/.venv/lib/python3.11/site-packages/pg0/bin/pg0";
const VERSION: &str = "18.1.0";
const SHORT: Duration = Duration::from_secs(75);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    UnsafeDestination,
    InvalidDump,
    Start,
    Metadata,
    Restore,
    Stop,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::UnsafeDestination => "Use a non-root user and a fresh, empty, private .pg0 directory owned by that user. Existing state is never replaced.",
            Self::InvalidDump => "The dump must be an absolute regular file in PostgreSQL custom format.",
            Self::Start => "Rehearsal database initialization failed. Inspect the isolated container; use fresh storage for another attempt.",
            Self::Metadata => "The initialized database metadata did not match the pinned rehearsal layout.",
            Self::Restore => "Database restoration failed. Preserve the failed rehearsal storage for private inspection; do not retry into it.",
            Self::Stop => "Database shutdown could not be confirmed. Stop the disposable container before inspecting or retrying; do not reuse its storage.",
        })
    }
}
impl std::error::Error for Error {}

#[derive(Deserialize)]
struct Metadata {
    installation_dir: PathBuf,
    data_dir: PathBuf,
    version: String,
    username: String,
    password: String,
    database: String,
    port: u16,
}

fn command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .env_clear()
        .env("HOME", HOME)
        .env("PATH", "/usr/local/bin:/usr/bin:/bin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    command
}

fn regular(path: &Path) -> std::io::Result<File> {
    let file = File::from(open(
        path,
        OFlags::RDONLY | OFlags::NONBLOCK | OFlags::NOFOLLOW | OFlags::CLOEXEC,
        Mode::empty(),
    )?);
    if !file.metadata()?.is_file() {
        return Err(std::io::Error::other("not a regular file"));
    }
    Ok(file)
}

fn dump(path: &Path) -> Result<File, Error> {
    if !path.is_absolute() {
        return Err(Error::InvalidDump);
    }
    let mut file = regular(path).map_err(|_| Error::InvalidDump)?;
    let mut signature = [0; 5];
    file.read_exact(&mut signature)
        .map_err(|_| Error::InvalidDump)?;
    if &signature != b"PGDMP" {
        return Err(Error::InvalidDump);
    }
    file.rewind().map_err(|_| Error::InvalidDump)?;
    Ok(file)
}

fn claim_destination(root: &Path) -> Result<(), Error> {
    let uid = rustix::process::geteuid();
    if uid.is_root() {
        return Err(Error::UnsafeDestination);
    }
    let metadata = fs::symlink_metadata(root).map_err(|_| Error::UnsafeDestination)?;
    if !metadata.is_dir()
        || metadata.uid() != uid.as_raw()
        || metadata.mode() & 0o077 != 0
        || fs::read_dir(root)
            .map_err(|_| Error::UnsafeDestination)?
            .next()
            .is_some()
    {
        return Err(Error::UnsafeDestination);
    }
    // The claim survives failures, preventing a second attempt into uncertain state.
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(root.join(".restore-attempt"))
        .map_err(|_| Error::UnsafeDestination)?;
    Ok(())
}

fn metadata(root: &Path) -> Result<Metadata, Error> {
    let mut bytes = Vec::new();
    regular(&root.join("instances/hindsight/instance.json"))
        .map_err(|_| Error::Metadata)?
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::Metadata)?;
    if bytes.len() > 65536 {
        return Err(Error::Metadata);
    }
    let metadata: Metadata = serde_json::from_slice(&bytes).map_err(|_| Error::Metadata)?;
    if metadata.installation_dir != root.join("installation")
        || metadata.data_dir != root.join("instances/hindsight/data")
        || metadata.version != VERSION
        || metadata.username != "hindsight"
        || metadata.database != "hindsight"
        || metadata.password != "hindsight"
        || metadata.port == 0
    {
        return Err(Error::Metadata);
    }
    Ok(metadata)
}

fn start() -> Result<(), Error> {
    // pg0 deliberately leaves PostgreSQL running after it exits. The ordinary
    // process supervisor removes descendants on success and cannot own this step.
    let mut child = command(Path::new(PG0))
        .args([
            "start",
            "--name",
            "hindsight",
            "--username",
            "hindsight",
            "--password",
            "hindsight",
            "--database",
            "hindsight",
            "--version",
            VERSION,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|_| Error::Start)?;
    let deadline = Instant::now() + Duration::from_secs(660);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return if status.success() {
                    Ok(())
                } else {
                    Err(Error::Start)
                };
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                // A detached server can survive this. The caller always attempts
                // explicit shutdown and reports uncertainty if that fails.
                let _ = rustix::process::kill_process_group(
                    rustix::process::Pid::from_child(&child),
                    rustix::process::Signal::KILL,
                );
                let _ = child.wait();
                return Err(Error::Start);
            }
        }
    }
}

fn stop(root: &Path) -> Result<(), Error> {
    let mut command = command(Path::new(PG0));
    command
        .args(["stop", "--name", "hindsight", "--timeout", "60"])
        .env(
            "LD_LIBRARY_PATH",
            root.join("installation").join(VERSION).join("lib"),
        );
    let status = process::run_silent(&mut command, SHORT).map_err(|_| Error::Stop)?;
    if !status.success()
        || root
            .join("instances/hindsight/data/postmaster.pid")
            .exists()
    {
        return Err(Error::Stop);
    }
    Ok(())
}

/// Restore only in a disposable, network-isolated pinned Hindsight container.
/// Success means the dump restored and PostgreSQL stopped, not application readiness.
pub fn restore(path: &Path) -> Result<(), Error> {
    let input = dump(path)?;
    let root = Path::new(HOME).join(".pg0");
    claim_destination(&root)?;
    let result = (|| {
        start()?;
        let metadata = metadata(&root)?;
        let installation = metadata.installation_dir.join(&metadata.version);
        let mut restore = command(&installation.join("bin/pg_restore"));
        restore
            .args([
                "--exit-on-error",
                "-h",
                "127.0.0.1",
                "-p",
                &metadata.port.to_string(),
                "-U",
                &metadata.username,
                "-d",
                &metadata.database,
            ])
            .env("PGPASSWORD", metadata.password)
            .env("LD_LIBRARY_PATH", installation.join("lib"))
            .stdin(Stdio::from(input));
        let status = process::run_silent(&mut restore, Duration::from_secs(1800))
            .map_err(|_| Error::Restore)?;
        if status.success() {
            Ok(())
        } else {
            Err(Error::Restore)
        }
    })();
    // Even a failed start can leave a live server. Shutdown uncertainty takes
    // precedence over the original failure so the operator stops the container.
    stop(&root)?;
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn dump_input_requires_custom_format_and_never_follows_links() {
        let temporary = tempfile::tempdir().unwrap();
        let path = temporary.path().join("dump");
        fs::write(&path, b"plain SQL").unwrap();
        assert_eq!(dump(&path).unwrap_err(), Error::InvalidDump);
        fs::write(&path, b"PGDMPfixture").unwrap();
        assert!(dump(&path).is_ok());
        let link = temporary.path().join("link");
        symlink(path, &link).unwrap();
        assert_eq!(dump(&link).unwrap_err(), Error::InvalidDump);
    }

    #[test]
    fn failed_attempt_claim_prevents_reusing_destination() {
        if rustix::process::geteuid().is_root() {
            return;
        }
        let temporary = tempfile::tempdir().unwrap();
        fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(claim_destination(temporary.path()), Ok(()));
        assert_eq!(
            claim_destination(temporary.path()),
            Err(Error::UnsafeDestination)
        );
    }

    #[test]
    fn metadata_rejects_paths_outside_the_fresh_instance() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path();
        fs::create_dir_all(root.join("instances/hindsight")).unwrap();
        let mut value = serde_json::json!({
            "installation_dir": root.join("installation"),
            "data_dir": root.join("instances/hindsight/data"),
            "version": VERSION, "username":"hindsight", "password":"hindsight",
            "database":"hindsight", "port":5432
        });
        let path = root.join("instances/hindsight/instance.json");
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(metadata(root).is_ok());
        value["installation_dir"] = serde_json::json!("/unrelated");
        fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(matches!(metadata(root), Err(Error::Metadata)));
    }
}
