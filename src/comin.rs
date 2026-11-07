//! Trigger native reconciliation once, then verify the pinned Comin status protocol.
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::{FileTypeExt, MetadataExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::bootstrap_privileged::{Error, trusted_store_path};

#[derive(Deserialize)]
struct State {
    is_suspended: Option<bool>,
    builder: Builder,
    deployer: Deployer,
    fetcher: Fetcher,
}
#[derive(Deserialize)]
struct Builder {
    is_suspended: Option<bool>,
}
#[derive(Deserialize)]
struct Deployer {
    is_suspended: Option<bool>,
    is_deploying: Option<bool>,
    deployment: Deployment,
}
#[derive(Deserialize)]
struct Deployment {
    status: String,
    operation: String,
    #[serde(default)]
    error_msg: String,
    generation: Generation,
}
#[derive(Deserialize)]
struct Generation {
    eval_status: String,
    build_status: String,
    #[serde(default)]
    eval_err: String,
    #[serde(default)]
    build_err: String,
    out_path: PathBuf,
    source: Source,
}
#[derive(Deserialize)]
struct Source {
    git: Git,
}
#[derive(Deserialize)]
struct Git {
    hostname: String,
    selected_remote_url: String,
    selected_remote_name: String,
    selected_branch_name: String,
    selected_branch_is_testing: Option<bool>,
    selected_commit_id: String,
}
#[derive(Deserialize)]
struct Fetcher {
    git_repository_status: Repository,
}
#[derive(Deserialize)]
struct Repository {
    selected_remote_name: String,
    selected_branch_name: String,
    selected_branch_is_testing: Option<bool>,
    selected_commit_id: String,
    #[serde(default)]
    error_msg: String,
    remotes: Vec<Remote>,
}
#[derive(Deserialize)]
struct Remote {
    name: String,
    url: String,
    fetched: Option<bool>,
    fetched_at: String,
    #[serde(default)]
    fetch_error_msg: String,
    main: Branch,
}
#[derive(Deserialize)]
struct Branch {
    name: String,
    commit_id: String,
    #[serde(default)]
    error_msg: String,
}
#[derive(Deserialize)]
struct Metadata {
    repository: String,
    host: String,
    revision: String,
}

fn reconciled(
    bytes: &[u8],
    metadata: &Metadata,
    system: &Path,
    since: i64,
    now: i64,
) -> Option<String> {
    let state: State = serde_json::from_slice(bytes).ok()?;
    let deployment = &state.deployer.deployment;
    let generation = &deployment.generation;
    let git = &generation.source.git;
    let repository = &state.fetcher.git_repository_status;
    let remotes: Vec<_> = repository
        .remotes
        .iter()
        .filter(|remote| remote.name == "origin")
        .collect();
    let [remote] = remotes.as_slice() else {
        return None;
    };
    let fetched = OffsetDateTime::parse(&remote.fetched_at, &Rfc3339)
        .ok()?
        .unix_timestamp();
    let url = format!("git@github.com:{}.git", metadata.repository);
    if state.is_suspended != Some(false)
        || state.builder.is_suspended != Some(false)
        || state.deployer.is_suspended != Some(false)
        || state.deployer.is_deploying != Some(false)
        || deployment.status != "done"
        || deployment.operation != "switch"
        || !deployment.error_msg.is_empty()
        || generation.eval_status != "evaluated"
        || generation.build_status != "built"
        || !generation.eval_err.is_empty()
        || !generation.build_err.is_empty()
        || generation.out_path != system
        || git.hostname != metadata.host
        || git.selected_remote_url != url
        || git.selected_remote_name != "origin"
        || git.selected_branch_name != "main"
        || git.selected_branch_is_testing != Some(false)
        || repository.selected_remote_name != "origin"
        || repository.selected_branch_name != "main"
        || repository.selected_branch_is_testing != Some(false)
        || !repository.error_msg.is_empty()
        || remote.url != url
        || remote.fetched != Some(true)
        || !remote.fetch_error_msg.is_empty()
        || remote.main.name != "main"
        || !remote.main.error_msg.is_empty()
        || fetched < since
        || fetched > now + 60
        || now - fetched > 1200
        || !crate::config::valid_revision(&metadata.revision)
        || repository.selected_commit_id != metadata.revision
        || git.selected_commit_id != metadata.revision
        || remote.main.commit_id != metadata.revision
    {
        return None;
    }
    Some(metadata.revision.clone())
}

fn remaining(deadline: Instant) -> Option<Duration> {
    deadline
        .checked_duration_since(Instant::now())
        .filter(|remaining| !remaining.is_zero())
        .map(|remaining| remaining.min(Duration::from_secs(10)))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct SocketIdentity {
    device: u64,
    inode: u64,
    changed_seconds: i64,
    changed_nanoseconds: i64,
}

fn trusted_socket(socket: &Path, owner: u32) -> Option<SocketIdentity> {
    let metadata = fs::symlink_metadata(socket).ok()?;
    let parent = fs::metadata(socket.parent()?).ok()?;
    if !metadata.file_type().is_socket()
        || metadata.uid() != owner
        || !parent.is_dir()
        || parent.uid() != owner
        || parent.mode() & 0o022 != 0
    {
        return None;
    }
    Some(SocketIdentity {
        device: metadata.dev(),
        inode: metadata.ino(),
        changed_seconds: metadata.ctime(),
        changed_nanoseconds: metadata.ctime_nsec(),
    })
}

fn read_status(
    executable: &Path,
    socket: &Path,
    owner: u32,
    deadline: Instant,
) -> Option<(SocketIdentity, std::process::Output)> {
    let identity = trusted_socket(socket, owner)?;
    let output = crate::process::capture_status(
        &mut command(executable, "status", socket),
        remaining(deadline)?,
    )
    .ok()?;
    if !output.status.success() || trusted_socket(socket, owner) != Some(identity) {
        return None;
    }
    Some((identity, output))
}

fn command(executable: &Path, operation: &str, socket: &Path) -> Command {
    let mut command = Command::new(executable);
    command.arg(operation);
    if operation == "status" {
        command.arg("--json");
    }
    command
        .arg("--unix-socket-path")
        .arg(socket)
        .env_clear()
        .env("HOME", "/var/root")
        .stdin(Stdio::null());
    command
}

fn request_fetch(
    executable: &Path,
    socket: &Path,
    status: &std::process::Output,
    identity: SocketIdentity,
    attempted: &mut Option<SocketIdentity>,
    deadline: Instant,
) -> bool {
    if *attempted == Some(identity)
        || !status.status.success()
        || !serde_json::from_slice::<serde_json::Value>(&status.stdout).is_ok_and(|value| {
            value
                .pointer("/fetcher/git_repository_status/remotes")
                .and_then(serde_json::Value::as_array)
                .is_some_and(|remotes| {
                    remotes.iter().any(|remote| {
                        remote.get("name").and_then(serde_json::Value::as_str) == Some("origin")
                    })
                })
        })
    {
        return false;
    }
    let Some(timeout) = remaining(deadline) else {
        return false;
    };
    // The scheduler waits a full poll interval on startup. Ask Comin to fetch
    // once per daemon socket, including Comin's normal post-activation restart.
    // An ambiguous request must not repeat against the same socket instance.
    *attempted = Some(identity);
    let _ = crate::process::run_silent(&mut command(executable, "fetch", socket), timeout);
    true
}

fn probe(
    repository: &str,
    host: &str,
    since: i64,
    attempted: &mut Option<SocketIdentity>,
    deadline: Instant,
) -> Option<String> {
    let current = Path::new("/run/current-system");
    let system = trusted_store_path(current, Path::new("/nix/store"), 0).ok()?;
    let metadata_path = trusted_store_path(
        &system.join("etc/homelab/revision.json"),
        Path::new("/nix/store"),
        0,
    )
    .ok()?;
    let mut bytes = Vec::new();
    File::open(metadata_path)
        .ok()?
        .take(4097)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() > 4096 {
        return None;
    }
    let metadata: Metadata = serde_json::from_slice(&bytes).ok()?;
    if metadata.repository != repository || metadata.host != host {
        return None;
    }
    let executable =
        trusted_store_path(&system.join("sw/bin/comin"), Path::new("/nix/store"), 0).ok()?;
    let socket = Path::new("/var/lib/homelab/comin.sock");
    let (identity, output) = read_status(&executable, socket, 0, deadline)?;
    if current.canonicalize().ok()? != system {
        return None;
    }
    // Never accept the status snapshot taken before our fetch request.
    if request_fetch(&executable, socket, &output, identity, attempted, deadline) {
        return None;
    }
    if current.canonicalize().ok()? != system || trusted_socket(socket, 0) != Some(identity) {
        return None;
    }
    reconciled(
        &output.stdout,
        &metadata,
        &system,
        since,
        OffsetDateTime::now_utc().unix_timestamp(),
    )
}

pub(crate) fn wait_for_reconciliation(
    repository: &str,
    host: &str,
    since: i64,
) -> Result<String, Error> {
    let deadline = Instant::now() + Duration::from_secs(600);
    let mut attempted = None;
    loop {
        if let Some(revision) = probe(repository, host, since, &mut attempted, deadline) {
            return Ok(revision);
        }
        if Instant::now() >= deadline {
            return Err(Error::ReconciliationUnconfirmed);
        }
        std::thread::sleep(
            deadline
                .saturating_duration_since(Instant::now())
                .min(Duration::from_secs(2)),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn fetch_is_requested_once_after_rpc_readiness_even_when_request_fails() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::process::ExitStatusExt;
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("comin");
        fs::write(&executable, b"#!/bin/sh\nprintf '%s\n' \"$@\" >> \"$0.calls\"\nprintf 'synthetic sensitive vendor output'\nexit 1\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let socket = directory.path().join("socket");
        let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        let owner = rustix::process::geteuid().as_raw();
        let identity = trusted_socket(&socket, owner).unwrap();
        let mut attempted = None;
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut status = std::process::Output {
            status: std::process::ExitStatus::from_raw(256),
            stdout: b"{}".to_vec(),
            stderr: b"synthetic secret".to_vec(),
        };
        request_fetch(
            &executable,
            &socket,
            &status,
            identity,
            &mut attempted,
            deadline,
        );
        assert!(attempted.is_none());
        status.status = std::process::ExitStatus::from_raw(0);
        status.stdout = b"not JSON".to_vec();
        request_fetch(
            &executable,
            &socket,
            &status,
            identity,
            &mut attempted,
            deadline,
        );
        assert!(attempted.is_none());
        for uninitialized in [
            json!({}),
            json!({"fetcher":{"git_repository_status":null}}),
            json!({"fetcher":{"git_repository_status":{"remotes":[]}}}),
            json!({"fetcher":{"git_repository_status":{"remotes":[{"name":"other"}]}}}),
        ] {
            status.stdout = serde_json::to_vec(&uninitialized).unwrap();
            assert!(!request_fetch(
                &executable,
                &socket,
                &status,
                identity,
                &mut attempted,
                deadline
            ));
            assert!(attempted.is_none());
        }
        status.stdout = serde_json::to_vec(
            &json!({"fetcher":{"git_repository_status":{"remotes":[{"name":"origin"}]}}}),
        )
        .unwrap();
        request_fetch(
            &executable,
            &socket,
            &status,
            identity,
            &mut attempted,
            Instant::now(),
        );
        assert!(attempted.is_none());
        request_fetch(
            &executable,
            &socket,
            &status,
            identity,
            &mut attempted,
            deadline,
        );
        assert_eq!(attempted, Some(identity));
        request_fetch(
            &executable,
            &socket,
            &status,
            identity,
            &mut attempted,
            deadline,
        );
        assert_eq!(
            fs::read_to_string(executable.with_extension("calls")).unwrap(),
            format!("fetch\n--unix-socket-path\n{}\n", socket.display())
        );
        fs::remove_file(&socket).unwrap();
        let _replacement = std::os::unix::net::UnixListener::bind(&socket).unwrap();
        let next_identity = trusted_socket(&socket, owner).unwrap();
        assert_ne!(next_identity, identity);
        assert!(request_fetch(
            &executable,
            &socket,
            &status,
            next_identity,
            &mut attempted,
            deadline
        ));
        assert!(!request_fetch(
            &executable,
            &socket,
            &status,
            next_identity,
            &mut attempted,
            deadline
        ));
        assert_eq!(
            fs::read_to_string(executable.with_extension("calls")).unwrap(),
            format!("fetch\n--unix-socket-path\n{}\n", socket.display()).repeat(2)
        );
    }

    #[test]
    fn status_from_replaced_socket_is_discarded() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::net::UnixListener;
        let directory = tempfile::tempdir().unwrap();
        let socket = directory.path().join("socket");
        let _first = UnixListener::bind(&socket).unwrap();
        let _second = UnixListener::bind(socket.with_extension("replacement")).unwrap();
        let executable = directory.path().join("comin");
        fs::write(
            &executable,
            b"#!/bin/sh\n/bin/mv \"$4.replacement\" \"$4\"\nprintf '{}'\n",
        )
        .unwrap();
        // Use a matching adjacent socket name; both listeners remain alive so
        // inode reuse cannot make the replacement look like the old endpoint.
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let owner = rustix::process::geteuid().as_raw();
        let before = trusted_socket(&socket, owner).unwrap();
        assert!(
            read_status(
                &executable,
                &socket,
                owner,
                Instant::now() + Duration::from_secs(10)
            )
            .is_none()
        );
        assert_ne!(trusted_socket(&socket, owner), Some(before));
    }

    #[test]
    fn socket_boundary_accepts_private_directory_and_rejects_native_group_writable_run() {
        use std::os::unix::fs::{PermissionsExt, symlink};
        use std::os::unix::net::UnixListener;
        let directory = tempfile::tempdir().unwrap();
        let owner = rustix::process::geteuid().as_raw();
        let run = directory.path().join("real-run");
        fs::create_dir(&run).unwrap();
        fs::set_permissions(&run, fs::Permissions::from_mode(0o700)).unwrap();
        let alias = directory.path().join("run");
        symlink(&run, &alias).unwrap();
        let socket = alias.join("comin.sock");
        assert!(trusted_socket(&socket, owner).is_none());
        let _listener = UnixListener::bind(&socket).unwrap();
        assert!(trusted_socket(&socket, owner).is_some());
        assert!(trusted_socket(&socket, owner + 1).is_none());
        let symlink_socket = alias.join("link.sock");
        symlink(&socket, &symlink_socket).unwrap();
        assert!(trusted_socket(&symlink_socket, owner).is_none());
        // Darwin's native /private/var/run is 0775; it must remain rejected.
        fs::set_permissions(&run, fs::Permissions::from_mode(0o775)).unwrap();
        assert!(trusted_socket(&socket, owner).is_none());
    }

    fn status() -> serde_json::Value {
        json!({
            "is_suspended": false,
            "builder": {"is_suspended": false},
            "deployer": {
                "is_suspended": false, "is_deploying": false,
                "deployment": {
                    "status": "done", "operation": "switch",
                    "generation": {
                        "eval_status": "evaluated", "build_status": "built",
                        "out_path": "/nix/store/test-system",
                        "source": {"git": {
                            "hostname": "build-mac", "selected_remote_url": "git@github.com:example/config.git",
                            "selected_remote_name": "origin", "selected_branch_name": "main",
                            "selected_branch_is_testing": false, "selected_commit_id": "a".repeat(40)
                        }}
                    }
                }
            },
            "fetcher": {"git_repository_status": {
                "selected_remote_name": "origin", "selected_branch_name": "main", "selected_branch_is_testing": false,
                "selected_commit_id": "a".repeat(40),
                "remotes": [{"name": "origin", "url": "git@github.com:example/config.git", "fetched": true,
                    "fetched_at": "2026-11-06T00:00:00Z", "main": {"name": "main", "commit_id": "a".repeat(40)}}]
            }}
        })
    }

    fn verify(status: &serde_json::Value, since: i64) -> Option<String> {
        let metadata = Metadata {
            repository: "example/config".into(),
            host: "build-mac".into(),
            revision: "a".repeat(40),
        };
        let now = OffsetDateTime::parse("2026-11-06T00:00:10Z", &Rfc3339)
            .unwrap()
            .unix_timestamp();
        reconciled(
            &serde_json::to_vec(status).unwrap(),
            &metadata,
            Path::new("/nix/store/test-system"),
            since,
            now,
        )
    }

    #[test]
    fn readiness_requires_fresh_successful_main_and_matching_active_generation() {
        let good = status();
        let since = OffsetDateTime::parse("2026-11-05T23:59:59Z", &Rfc3339)
            .unwrap()
            .unix_timestamp();
        assert_eq!(verify(&good, since), Some("a".repeat(40)));
        assert!(verify(&good, since + 2).is_none());
        for (pointer, replacement) in [
            ("/is_suspended", json!(true)),
            ("/builder/is_suspended", json!(null)),
            ("/deployer/is_deploying", json!(true)),
            ("/deployer/deployment/status", json!("failed")),
            ("/deployer/deployment/operation", json!("boot")),
            (
                "/deployer/deployment/generation/out_path",
                json!("/nix/store/other"),
            ),
            (
                "/deployer/deployment/generation/build_status",
                json!("building"),
            ),
            (
                "/deployer/deployment/generation/source/git/selected_commit_id",
                json!("b".repeat(40)),
            ),
            (
                "/deployer/deployment/generation/source/git/hostname",
                json!("other-host"),
            ),
            (
                "/fetcher/git_repository_status/selected_branch_is_testing",
                json!(true),
            ),
            (
                "/fetcher/git_repository_status/remotes/0/fetched",
                json!(false),
            ),
            (
                "/fetcher/git_repository_status/remotes/0/fetched_at",
                json!("2026-11-05T00:00:00Z"),
            ),
            (
                "/fetcher/git_repository_status/remotes/0/main/commit_id",
                json!("b".repeat(40)),
            ),
        ] {
            let mut changed = good.clone();
            *changed.pointer_mut(pointer).unwrap() = replacement;
            assert!(verify(&changed, since).is_none(), "accepted {pointer}");
        }
        let mut failed_fetch = good;
        failed_fetch["fetcher"]["git_repository_status"]["remotes"][0]["fetch_error_msg"] =
            json!("synthetic fetch failure");
        assert!(verify(&failed_fetch, since).is_none());
    }
}
