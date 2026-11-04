use homelab_client::{
    first_access::{self, Error, Tools, Trust},
    inventory::HostProfile,
};
use std::{fs, path::PathBuf, process::Command};
struct Fixture {
    root: tempfile::TempDir,
    tools: Tools,
    host: HostProfile,
}
impl Fixture {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let executable = root.path().join("fixture");
        assert!(
            Command::new("rustc")
                .args(["--edition=2024", "tests/fixtures/first_access.rs", "-o"])
                .arg(&executable)
                .current_dir(env!("CARGO_MANIFEST_DIR"))
                .status()
                .unwrap()
                .success()
        );
        Self {
            root,
            tools: Tools {
                ssh: executable.clone(),
                ssh_keygen: executable.clone(),
                ssh_add: executable,
            },
            host: HostProfile {
                name: "macbook".into(),
                address: "192.0.2.1".into(),
                user: "admin".into(),
                identity: None,
            },
        }
    }
    fn key(&self) -> PathBuf {
        let path = self.root.path().join("key.pub");
        fs::write(&path, "ssh-ed25519 AAAA discarded-comment\n").unwrap();
        path
    }
    fn flag(&self, name: &str) {
        fs::write(self.root.path().join(name), b"").unwrap();
    }
}
#[test]
fn explicit_first_use_trust_is_separate_from_strict_checks() {
    let f = Fixture::new();
    first_access::check_key_access(&f.host, &f.tools, Trust::AcceptNew).unwrap();
    assert!(
        fs::read_to_string(f.root.path().join("check-args"))
            .unwrap()
            .contains("StrictHostKeyChecking=accept-new")
    );
    first_access::check_key_access(&f.host, &f.tools, Trust::Strict).unwrap();
    assert!(
        fs::read_to_string(f.root.path().join("check-args"))
            .unwrap()
            .contains("StrictHostKeyChecking=yes")
    );
    f.flag("fail-check");
    let error = first_access::check_key_access(&f.host, &f.tools, Trust::Strict).unwrap_err();
    assert_eq!(error, Error::Connection);
    assert!(!error.to_string().contains("private diagnostic"));
}
#[test]
fn installation_sends_only_validated_public_key_then_rechecks_strictly() {
    let f = Fixture::new();
    let key = first_access::prepare_public_key(&f.key(), &f.tools).unwrap();
    assert_eq!(key.fingerprint(), "SHA256:fixture");
    first_access::install_public_key(&f.host, &f.tools, &key).unwrap();
    assert_eq!(
        fs::read_to_string(f.root.path().join("installed")).unwrap(),
        "ssh-ed25519 AAAA\n"
    );
    f.flag("fail-check");
    assert_eq!(
        first_access::install_public_key(&f.host, &f.tools, &key),
        Err(Error::Verification)
    );
    fs::remove_file(f.root.path().join("installed")).unwrap();
    f.flag("changed-host");
    assert_eq!(
        first_access::install_public_key(&f.host, &f.tools, &key),
        Err(Error::UnknownOutcome)
    );
    assert!(!f.root.path().join("installed").exists());
    fs::remove_file(f.root.path().join("changed-host")).unwrap();
    fs::write(f.root.path().join("exit"), "130").unwrap();
    assert_eq!(
        first_access::install_public_key(&f.host, &f.tools, &key),
        Err(Error::UnknownOutcome)
    );
}
#[test]
fn invalid_keys_and_profiles_never_start_installation() {
    let mut f = Fixture::new();
    // A missing selection is diagnosed before even launching key validation.
    let missing = f.root.path().join("absent.pub");
    let absent_tools = Tools {
        ssh: missing.clone(),
        ssh_keygen: missing.clone(),
        ssh_add: missing.clone(),
    };
    assert!(matches!(
        first_access::prepare_public_key(&missing, &absent_tools),
        Err(Error::PublicKeyMissing)
    ));
    let path = f.key();
    let link = f.root.path().join("linked.pub");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert!(matches!(
        first_access::prepare_public_key(&link, &f.tools),
        Err(Error::InvalidKey)
    ));
    fs::write(&path, "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate\n").unwrap();
    assert!(matches!(
        first_access::prepare_public_key(&path, &f.tools),
        Err(Error::InvalidKey)
    ));
    fs::write(&path, "ssh-ed25519 AAAA\nssh-ed25519 BBBB\n").unwrap();
    assert!(matches!(
        first_access::prepare_public_key(&path, &f.tools),
        Err(Error::InvalidKey)
    ));
    f.key();
    f.flag("bad-key");
    assert!(matches!(
        first_access::prepare_public_key(&path, &f.tools),
        Err(Error::InvalidKey)
    ));
    f.host.address = "-oProxyCommand=oops".into();
    assert_eq!(
        first_access::check_key_access(&f.host, &f.tools, Trust::AcceptNew),
        Err(Error::InvalidProfile)
    );
    assert!(!f.root.path().join("installed").exists());
}
#[test]
fn checked_shell_preserves_existing_keys_and_refuses_symlink_targets() {
    use std::{io::Write, os::unix::fs::symlink, process::Stdio};
    let root = tempfile::tempdir().unwrap();
    fs::create_dir(root.path().join(".ssh")).unwrap();
    let authorized = root.path().join(".ssh/authorized_keys");
    fs::write(&authorized, "existing-key").unwrap();
    let run = || {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg(include_str!("../src/first-access/install-key.sh"))
            .env("HOME", root.path())
            .stdin(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(b"ssh-ed25519 AAAA\n")
            .unwrap();
        child.wait().unwrap()
    };
    assert!(run().success());
    assert!(run().success());
    assert_eq!(
        fs::read_to_string(&authorized).unwrap(),
        "existing-key\nssh-ed25519 AAAA\n"
    );
    fs::remove_file(&authorized).unwrap();
    let other = root.path().join("untouched");
    fs::write(&other, "original").unwrap();
    symlink(&other, &authorized).unwrap();
    assert!(!run().success());
    assert_eq!(fs::read_to_string(other).unwrap(), "original");
    fs::remove_file(&authorized).unwrap();
    fs::create_dir(&authorized).unwrap();
    assert!(!run().success());
}

#[test]
fn bounded_ssh_diagnostics_choose_safe_actions_without_disclosing_output() {
    let f = Fixture::new();
    for (diagnostic, expected) in [
        (
            "No ED25519 host key is known for 192.0.2.1 and you have requested strict checking.\r\nHost key verification failed.\r\n",
            Error::HostUnknown,
        ),
        (
            "No RSA host key is known for 192.0.2.1 and you have requested strict checking.\n",
            Error::HostUnknown,
        ),
        (
            "No ECDSA host key is known for 192.0.2.1 and you have requested strict checking.\n",
            Error::HostUnknown,
        ),
        (
            "@ WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED! @\nadmin@192.0.2.1: Permission denied (publickey,password,keyboard-interactive).\n",
            Error::HostChanged,
        ),
        (
            "Host key verification failed.\nadmin@192.0.2.1: Permission denied (publickey).\n",
            Error::Connection,
        ),
        (
            "admin@192.0.2.1: Permission denied (publickey,password,keyboard-interactive).\r\n",
            Error::AuthenticationDenied,
        ),
        (
            "ssh: connect to host 192.0.2.1 port 22: Connection refused\n",
            Error::ConnectionRefused,
        ),
        (
            "ssh: connect to host 192.0.2.1 port 22: Operation timed out\n",
            Error::ConnectionTimeout,
        ),
        (
            "ssh: connect to host 192.0.2.1 port 22: Connection timed out\n",
            Error::ConnectionTimeout,
        ),
        (
            "Timeout, server 192.0.2.1 not responding.\n",
            Error::ConnectionTimeout,
        ),
        (
            "ssh: Could not resolve hostname example: nodename nor servname provided\n",
            Error::NameResolution,
        ),
        (
            "sign_and_send_pubkey: signing failed for ED25519 from agent: agent refused operation\nadmin@192.0.2.1: Permission denied (publickey).\n",
            Error::AgentRefused,
        ),
        ("Permission denied\n", Error::Connection),
        ("Host key verification failed.\n", Error::Connection),
        ("unexpected server response\n", Error::Connection),
    ] {
        fs::write(
            f.root.path().join("diagnostic"),
            format!("private-banner-secret\n{diagnostic}"),
        )
        .unwrap();
        let error = first_access::check_key_access(&f.host, &f.tools, Trust::Strict).unwrap_err();
        assert_eq!(error, expected);
        assert!(
            !format!("{error:?} {error} {} {}", error.code(), error.next_action())
                .contains("private-banner-secret")
        );
    }
    fs::write(
        f.root.path().join("diagnostic"),
        "private-banner-secret".repeat(2000),
    )
    .unwrap();
    assert_eq!(
        first_access::check_key_access(&f.host, &f.tools, Trust::Strict),
        Err(Error::Connection)
    );
    assert!(!f.root.path().join("installed").exists());
}

#[test]
fn explicitly_selected_agent_key_survives_installation_and_later_connections() {
    let mut f = Fixture::new();
    let socket = f.root.path().join("chosen agent.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    fs::write(
        f.root.path().join("agent-keys"),
        "ssh-ed25519 AAAA Work\u{1b}key\n",
    )
    .unwrap();
    let keys = first_access::list_agent_keys(&socket, &f.tools).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].label(), "Workkey");
    assert_eq!(keys[0].fingerprint(), "SHA256:fixture");
    let identity = keys[0].identity();
    assert_eq!(identity.public_key, "ssh-ed25519 AAAA");
    assert_eq!(identity.agent_socket, socket);
    f.host.identity = Some(identity);
    first_access::install_public_key(&f.host, &f.tools, keys[0].public_key()).unwrap();
    first_access::check_key_access(&f.host, &f.tools, Trust::Strict).unwrap();
    let snapshot = fs::read_to_string(f.root.path().join("identity-path")).unwrap();
    assert!(
        !PathBuf::from(snapshot).exists(),
        "public-key snapshot outlived SSH"
    );
    fs::remove_file(f.root.path().join("check-args")).unwrap();
    drop(_listener);
    fs::remove_file(&socket).unwrap();
    assert_eq!(
        first_access::check_key_access(&f.host, &f.tools, Trust::Strict),
        Err(Error::AgentUnavailable)
    );
    fs::write(&socket, "not a socket").unwrap();
    assert_eq!(
        first_access::check_key_access(&f.host, &f.tools, Trust::Strict),
        Err(Error::AgentUnavailable)
    );
    assert!(
        !f.root.path().join("check-args").exists(),
        "SSH started without the selected agent"
    );
}

#[test]
fn unavailable_empty_or_invalid_agent_results_never_become_saved_identities() {
    let f = Fixture::new();
    let socket = f.root.path().join("chosen agent.sock");
    let _listener = std::os::unix::net::UnixListener::bind(&socket).unwrap();
    for (status, expected) in [(1, Error::AgentEmpty), (2, Error::AgentUnavailable)] {
        fs::write(f.root.path().join("agent-exit"), status.to_string()).unwrap();
        let error = first_access::list_agent_keys(&socket, &f.tools)
            .err()
            .unwrap();
        assert_eq!(error, expected);
    }
    fs::remove_file(f.root.path().join("agent-exit")).unwrap();
    for output in [
        "not-a-public-key private-value".to_string(),
        "private-value".repeat(2000),
    ] {
        fs::write(f.root.path().join("agent-keys"), output).unwrap();
        let error = first_access::list_agent_keys(&socket, &f.tools)
            .err()
            .unwrap();
        assert_eq!(error, Error::AgentUnavailable);
        assert!(!error.to_string().contains("private-value"));
    }
    assert!(!f.root.path().join("installed").exists());
}

#[test]
fn real_disposable_agent_lists_only_its_synthetic_public_key() {
    use std::{
        process::{Child, Stdio},
        time::{Duration, Instant},
    };
    struct Agent(Child);
    impl Drop for Agent {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn executable(name: &str) -> PathBuf {
        std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join(name))
            .find(|path| path.is_file())
            .unwrap()
    }
    let temporary = tempfile::tempdir().unwrap();
    let socket = temporary.path().join("agent.sock");
    let key = temporary.path().join("synthetic");
    let tools = Tools {
        ssh: executable("ssh"),
        ssh_keygen: executable("ssh-keygen"),
        ssh_add: executable("ssh-add"),
    };
    assert!(
        Command::new(&tools.ssh_keygen)
            .args([
                "-q",
                "-t",
                "ed25519",
                "-N",
                "",
                "-C",
                "synthetic-rehearsal",
                "-f"
            ])
            .arg(&key)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    let _agent = Agent(
        Command::new(executable("ssh-agent"))
            .args(["-D", "-a"])
            .arg(&socket)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let deadline = Instant::now() + Duration::from_secs(5);
    while !socket.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(socket.exists());
    assert!(matches!(
        first_access::list_agent_keys(&socket, &tools),
        Err(Error::AgentEmpty)
    ));
    assert!(
        Command::new(&tools.ssh_add)
            .arg(&key)
            .env("SSH_AUTH_SOCK", &socket)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success()
    );
    let keys = first_access::list_agent_keys(&socket, &tools).unwrap();
    assert_eq!(keys.len(), 1);
    assert_eq!(keys[0].label(), "synthetic-rehearsal");
    let public = first_access::prepare_public_key(&key.with_extension("pub"), &tools).unwrap();
    assert_eq!(keys[0].fingerprint(), public.fingerprint());
    let alias = temporary.path().join("alias.sock");
    std::os::unix::fs::symlink(&socket, &alias).unwrap();
    assert_eq!(
        first_access::list_agent_keys(&alias, &tools).unwrap()[0].fingerprint(),
        public.fingerprint()
    );
}
