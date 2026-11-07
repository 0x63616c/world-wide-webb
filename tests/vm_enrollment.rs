//! Opt-in full wizard rehearsal with real fixture GitHub PRs and a disposable VM.
//! No network or VM operation runs without --run and a private fixture file.
#[allow(dead_code)]
#[path = "vm_e2e.rs"]
mod vm;

use homelab_client::{
    config, configuration_pr, enrollment_credentials as credentials, inventory, provisioning,
    secret_store, setup_wizard, tailscale_oauth,
};
use rustix::fs::{Mode, OFlags, fcntl_getfl, fcntl_setfl, open};
use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
use rustix::termios::{Winsize, tcgetattr, tcsetwinsize};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const ENV: &str = "HOMELAB_VM_ENROLLMENT";
const AUTH_KEY: &str = "tskey-auth-synthetic-vm-only";
const VAULT: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaa";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    target: vm::Fixture,
    operator_hostname: String,
    state_directory: PathBuf,
    gh: PathBuf,
    github_config_directory: PathBuf,
    age_keygen: PathBuf,
    sops: PathBuf,
    jump_host: String,
    jump_known_hosts: PathBuf,
    jump_agent_socket: PathBuf,
}

fn fixture() -> Fixture {
    load(Path::new(
        &std::env::var_os(ENV).expect("explicit enrollment fixture required"),
    ))
}
fn load(path: &Path) -> Fixture {
    let f: Fixture = serde_json::from_slice(&vm::private_bytes(path, 32 * 1024)).unwrap();
    vm::validate_fixture(&f.target);
    assert!(
        vm::manifest(&f.target).tailscale.unwrap().oauth.is_some(),
        "full enrollment requires the exact synthetic OAuth reference"
    );
    assert!(
        f.target
            .repository
            .split('/')
            .nth(1)
            .unwrap()
            .starts_with("homelab-vm-"),
        "only a dedicated homelab-vm-* repository is allowed"
    );
    assert_eq!(f.target.configuration_host, "vm-test");
    assert!(f.target.guest_ip.is_private());
    assert_ne!(f.operator_hostname, f.target.physical_hostname);
    assert!(
        !f.jump_host.is_empty()
            && f.jump_host.len() <= 253
            && !f.jump_host.starts_with('-')
            && f.jump_host
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')),
        "jump host must be a plain DNS name or IPv4 address"
    );
    for path in [
        &f.state_directory,
        &f.gh,
        &f.github_config_directory,
        &f.age_keygen,
        &f.sops,
        &f.jump_known_hosts,
        &f.jump_agent_socket,
    ] {
        assert!(path.is_absolute());
        assert!(!path.to_string_lossy().contains(['\n', '\r', '"']));
    }
    f
}

fn api(f: &Fixture, method: &str, endpoint: &str, body: Option<Value>) -> Value {
    let projection = if endpoint.ends_with("/commits/main") {
        "{sha}"
    } else if endpoint.contains("/keys?") {
        "map({id,key,read_only}) | sort_by(.id)"
    } else if endpoint.contains("/pulls?") {
        "map({number,head:{sha:.head.sha,ref:.head.ref,repo:{full_name:.head.repo.full_name}},base:{ref:.base.ref,repo:{full_name:.base.repo.full_name}}})"
    } else if endpoint.ends_with("/files") {
        "map({filename})"
    } else if endpoint.ends_with("/merge") {
        "{merged,sha}"
    } else {
        "{private,full_name}"
    };
    let mut command = Command::new(f.state_directory.join("gh"));
    command
        .args([
            "api",
            "--hostname",
            "github.com",
            "--method",
            method,
            endpoint,
            "--jq",
            projection,
        ])
        .stdin(Stdio::null());
    if let Some(body) = body {
        use std::io::{Seek, Write};
        let mut input = tempfile::tempfile().unwrap();
        serde_json::to_writer(&mut input, &body).unwrap();
        input.flush().unwrap();
        input.rewind().unwrap();
        command.args(["--input", "-"]).stdin(input);
    }
    let output = homelab_client::process::capture(&mut command, Duration::from_secs(60))
        .expect("fixture GitHub command unavailable");
    assert!(output.status.success(), "fixture GitHub operation failed");
    serde_json::from_slice(&output.stdout).expect("fixture GitHub response malformed")
}

fn github_arguments_allowed(repository: &str, args: &[std::ffi::OsString]) -> bool {
    if args.first().and_then(|s| s.to_str()) != Some("api")
        || args.get(1).and_then(|s| s.to_str()) != Some("--hostname")
        || args.get(2).and_then(|s| s.to_str()) != Some("github.com")
    {
        return false;
    }
    let endpoint_index = if args.get(3).is_some_and(|s| s == "--method") {
        5
    } else {
        3
    };
    let Some(endpoint) = args.get(endpoint_index).and_then(|s| s.to_str()) else {
        return false;
    };
    let method = if endpoint_index == 5 {
        args.get(4).and_then(|s| s.to_str()).unwrap_or("")
    } else {
        "GET"
    };
    let relative = endpoint
        .strip_prefix(&format!("repos/{repository}/"))
        .unwrap_or("");
    let pull_number =
        |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    let mutation_allowed = match method {
        "GET" => !args.iter().any(|arg| {
            matches!(
                arg.to_str(),
                Some("--input" | "--field" | "-f" | "-F" | "--raw-field")
            )
        }),
        "POST" => matches!(
            relative,
            "keys" | "git/trees" | "git/commits" | "git/refs" | "pulls"
        ),
        "PATCH" => relative.strip_prefix("pulls/").is_some_and(pull_number),
        "PUT" => relative
            .strip_prefix("pulls/")
            .and_then(|path| path.strip_suffix("/merge"))
            .is_some_and(pull_number),
        _ => false,
    };
    if args.iter().skip(endpoint_index + 1).any(|arg| {
        arg.to_str().is_some_and(|arg| {
            arg == "--method" || arg.starts_with("--method=") || arg.starts_with("-X")
        })
    }) {
        return false;
    }
    if method == "GET"
        && args.iter().any(|arg| {
            arg.to_str().is_some_and(|arg| {
                ["--input=", "--field=", "--raw-field=", "-f", "-F"]
                    .iter()
                    .any(|prefix| arg.starts_with(prefix))
            })
        })
    {
        return false;
    }
    let prefix = format!("repos/{repository}");
    mutation_allowed
        && (endpoint == prefix || endpoint.starts_with(&format!("{prefix}/")))
        && !endpoint.contains(['%', '\\'])
        && !endpoint.contains("..")
        && !args
            .iter()
            .skip(3)
            .any(|s| s.to_str().is_some_and(|s| s.starts_with("--hostname")))
}

fn regressions() {
    vm::manifest_guard_regressions();
    let args = |items: &[&str]| {
        items
            .iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>()
    };
    assert!(github_arguments_allowed(
        "owner/homelab-vm-test",
        &args(&[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "PUT",
            "repos/owner/homelab-vm-test/pulls/1/merge"
        ])
    ));
    for extra in [
        "--method=DELETE",
        "--method",
        "-XDELETE",
        "--input=payload",
        "--field=value",
        "-Fvalue",
    ] {
        assert!(!github_arguments_allowed(
            "owner/homelab-vm-test",
            &args(&[
                "api",
                "--hostname",
                "github.com",
                "repos/owner/homelab-vm-test",
                extra
            ])
        ));
    }
    for (method, endpoint) in [
        ("DELETE", "repos/owner/homelab-vm-test"),
        ("POST", "repos/owner/homelab-vm-test/hooks"),
        ("PATCH", "repos/owner/homelab-vm-test"),
        (
            "PUT",
            "repos/owner/homelab-vm-test/pulls/not-a-number/merge",
        ),
    ] {
        assert!(!github_arguments_allowed(
            "owner/homelab-vm-test",
            &args(&[
                "api",
                "--hostname",
                "github.com",
                "--method",
                method,
                endpoint
            ])
        ));
    }
    for endpoint in [
        "repos/owner/production/pulls",
        "repos/owner/homelab-vm-test-other/pulls",
        "repos/owner/homelab-vm-test/../production",
        "https://example.org",
        "repos/owner/homelab-vm-test/%2e%2e/production",
    ] {
        assert!(!github_arguments_allowed(
            "owner/homelab-vm-test",
            &args(&["api", "--hostname", "github.com", endpoint])
        ));
    }
    assert!(!github_arguments_allowed(
        "owner/homelab-vm-test",
        &args(&[
            "api",
            "--hostname",
            "github.com",
            "repos/owner/homelab-vm-test",
            "--hostname=example.org"
        ])
    ));
}

fn github(f: &Fixture) -> ! {
    use std::os::unix::process::CommandExt;
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    assert_eq!(args.first().and_then(|s| s.to_str()), Some("api"));
    assert_eq!(args.get(1).and_then(|s| s.to_str()), Some("--hostname"));
    assert_eq!(args.get(2).and_then(|s| s.to_str()), Some("github.com"));
    assert!(
        github_arguments_allowed(&f.target.repository, &args),
        "GitHub requests are limited to the disposable fixture repository"
    );
    let error = Command::new(&f.gh)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("GH_CONFIG_DIR", &f.github_config_directory)
        .env("GH_PROMPT_DISABLED", "1")
        .exec();
    panic!("fixture GitHub executable failed: {:?}", error.kind());
}

fn transport(f: &Fixture, tailnet: bool, scp: bool) -> ! {
    let mut args: Vec<_> = std::env::args_os().skip(1).collect();
    if tailnet {
        assert_eq!(args.first().and_then(|s| s.to_str()), Some("ssh"));
        assert_eq!(
            args.get(1).and_then(|s| s.to_str()),
            Some("admin@100.64.0.1")
        );
        args.drain(..2);
    }
    let mut filtered = Vec::new();
    let mut i = 0;
    while i < args.len() {
        if args[i] == "-F" {
            assert_eq!(args.get(i + 1).and_then(|s| s.to_str()), Some("/dev/null"));
            i += 2;
        } else if args[i] == "-o"
            && args.get(i + 1).is_some_and(|value| {
                value == "IdentitiesOnly=yes" || value == "IdentityAgent=SSH_AUTH_SOCK"
            })
        {
            // The fixture transport pins the same public identity to its local
            // disposable private file. Never forward the synthetic agent socket.
            i += 2;
        } else if args[i] == "-i" {
            let offered = vm::private_bytes(Path::new(&args[i + 1]), 16384);
            assert_eq!(
                offered,
                fs::read(f.state_directory.join("selected.pub")).unwrap()
            );
            i += 2;
        } else {
            filtered.push(args[i].clone());
            i += 1;
        }
    }
    if tailnet {
        let remote = filtered.pop().expect("remote command required");
        filtered.extend([
            "-l".into(),
            "admin".into(),
            f.target.guest_ip.to_string().into(),
            remote,
        ]);
    }
    // The guest uses only its disposable key. The jump uses a pinned host key and
    // the existing operator agent; agent forwarding stays disabled on both hops.
    vm::transport_with_jump(
        &f.target,
        scp,
        filtered,
        Some((&f.state_directory.join("jump.conf"), &f.jump_host)),
    )
}

struct Store(PathBuf);
impl secret_store::Store for Store {
    fn find(&self, _: &str, tag: &str) -> Result<Vec<String>, secret_store::Error> {
        let path = self.0.join(tag);
        if !path.exists() {
            return Ok(vec![]);
        }
        let data: Value = serde_json::from_slice(&vm::private_bytes(&path, 65536))
            .map_err(|_| secret_store::Error::Access)?;
        Ok(vec![
            data["id"]
                .as_str()
                .ok_or(secret_store::Error::Access)?
                .into(),
        ])
    }
    fn read(&self, _: &str, id: &str) -> Result<secret_store::Item, secret_store::Error> {
        for entry in fs::read_dir(&self.0).map_err(|_| secret_store::Error::Access)? {
            let data: Value =
                serde_json::from_slice(&vm::private_bytes(&entry.unwrap().path(), 65536))
                    .map_err(|_| secret_store::Error::Access)?;
            if data["id"] == id {
                let field = |key| data[key].as_str().unwrap().to_owned();
                return Ok(secret_store::Item {
                    id: field("id"),
                    vault: field("vault"),
                    repository: field("repository"),
                    role: field("role"),
                    recipient: field("recipient"),
                    identity: field("identity"),
                });
            }
        }
        Err(secret_store::Error::Access)
    }
    fn create(
        &self,
        vault: &str,
        backup: &secret_store::Backup<'_>,
        tag: &str,
    ) -> Result<String, secret_store::Error> {
        assert!(tag.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'));
        let id = if backup.role == "recovery" {
            "b".repeat(26)
        } else {
            "c".repeat(26)
        };
        vm::write_private(&self.0.join(tag), &serde_json::to_vec(&json!({"id":id,"vault":vault,"repository":backup.repository,"role":backup.role,"recipient":backup.recipient,"identity":backup.identity})).unwrap());
        Ok(id)
    }
}
struct Issued {
    root: PathBuf,
    expires_at: i64,
}
impl credentials::EnrollmentKey for Issued {
    fn id(&self) -> &str {
        "synthetic-vm-issuance"
    }
    fn expires_at(&self) -> i64 {
        self.expires_at
    }
    fn secret(&self) -> &str {
        AUTH_KEY
    }
    fn revoke(&self) -> Result<(), tailscale_oauth::Error> {
        vm::write_private(&self.root.join("revoked"), b"confirmed");
        Ok(())
    }
}
fn prepare(
    root: &Path,
    host: &str,
    workspace: &config::Workspace,
    _: bool,
    progress: &dyn Fn(&str),
) -> Result<provisioning::Details, credentials::Error> {
    let f = fixture();
    assert_eq!(workspace.repository, f.target.repository);
    let store = Store(f.state_directory.join("synthetic-vault"));
    let tools = provisioning::Tools {
        age_keygen: f.age_keygen.clone(),
        sops: f.sops.clone(),
    };
    let session = provisioning::Session::open_with_store(
        host,
        &workspace.repository,
        root,
        &tools,
        &store,
        VAULT,
    )?;
    session.bind_issuer(&tailscale_oauth::ResolvedIdentity {
        vault: VAULT.into(),
        item: "d".repeat(26),
    })?;
    session.bind_enrollment_config(workspace.manifest.tailscale.as_ref().unwrap())?;
    credentials::complete(
        session,
        &store,
        VAULT,
        || {
            // create_new makes a second issuance fail instead of hiding it.
            vm::write_private(&f.state_directory.join("issued"), b"one synthetic issuance");
            Ok(Issued {
                root: f.state_directory.clone(),
                expires_at: time::OffsetDateTime::now_utc().unix_timestamp() + 86400,
            })
        },
        progress,
    )
}

struct Terminal {
    master: File,
    slave: File,
    child: Child,
    original: rustix::termios::LocalModes,
    text: String,
}
impl Terminal {
    fn start(f: &Fixture) -> Self {
        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
        grantpt(&master).unwrap();
        unlockpt(&master).unwrap();
        let slave = File::from(
            open(
                ptsname(&master, Vec::new()).unwrap(),
                OFlags::RDWR | OFlags::NOCTTY | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .unwrap(),
        );
        tcsetwinsize(
            &slave,
            Winsize {
                ws_row: 60,
                ws_col: 120,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )
        .unwrap();
        let original = tcgetattr(&slave).unwrap().local_modes;
        let child = Command::new(std::env::current_exe().unwrap())
            .arg("--wizard-child")
            .env_clear()
            .env(ENV, f.state_directory.join("enrollment.json"))
            .env("HOME", &f.state_directory)
            .env(
                "PATH",
                format!(
                    "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                    f.state_directory.display()
                ),
            )
            .env("TERM", "xterm-256color")
            .env("NO_COLOR", "1")
            .stdin(slave.try_clone().unwrap())
            .stdout(slave.try_clone().unwrap())
            .stderr(slave.try_clone().unwrap())
            .spawn()
            .unwrap();
        fcntl_setfl(&master, fcntl_getfl(&master).unwrap() | OFlags::NONBLOCK).unwrap();
        Self {
            master: File::from(master),
            slave,
            child,
            original,
            text: String::new(),
        }
    }
    fn wait(&mut self, expected: &str, duration: Duration) {
        let deadline = Instant::now() + duration;
        loop {
            let mut buffer = [0; 8192];
            match self.master.read(&mut buffer) {
                Ok(size) => self
                    .text
                    .push_str(&String::from_utf8_lossy(&buffer[..size])),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => panic!("wizard terminal unavailable; preserve fixture state"),
            }
            assert!(
                !self.text.contains(AUTH_KEY) && !self.text.contains("AGE-SECRET-KEY-"),
                "synthetic credential appeared in terminal output"
            );
            if self.text.contains(expected) {
                self.text.clear();
                return;
            }
            assert!(
                self.text.len() <= 256 * 1024,
                "unexpected terminal output volume"
            );
            assert!(
                self.child.try_wait().unwrap().is_none(),
                "wizard stopped before expected step; preserve fixture state"
            );
            assert!(
                Instant::now() < deadline,
                "wizard step timed out; preserve fixture state"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }
    fn enter(&mut self) {
        self.master.write_all(b"\r").unwrap();
    }
}
impl Drop for Terminal {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn wizard(f: &Fixture) {
    // The executable child remains guarded even when invoked directly.
    vm::guard_guest(&f.target, &f.state_directory.join("vm-ssh"));
    let _selected_socket =
        UnixListener::bind(f.state_directory.join("selected-agent.sock")).unwrap();
    let path = f.state_directory.join("inventory.json");
    let profile = inventory::load(&path).unwrap().remove(0);
    let tools = setup_wizard::WizardTools {
        first_access: homelab_client::first_access::Tools {
            ssh: f.state_directory.join("vm-ssh"),
            ssh_keygen: "/usr/bin/ssh-keygen".into(),
            ssh_add: "/usr/bin/ssh-add".into(),
        },
        remote_setup: homelab_client::remote_setup::Tools {
            ssh: f.state_directory.join("vm-ssh"),
            scp: f.state_directory.join("vm-scp"),
        },
    };
    let dependencies = setup_wizard::EnrollmentDependencies {
        prepare_credentials: prepare,
        tailscale: Some(f.state_directory.join("vm-tailnet")),
    };
    let result = setup_wizard::launch_with_dependencies(&profile, &path, &tools, &dependencies)
        .expect("wizard IO failed");
    assert!(
        result.completed && result.lines.iter().any(|line| line == "vm-test is set up."),
        "enrollment did not complete; preserve fixture state"
    );
    drop(_selected_socket);
    fs::remove_file(f.state_directory.join("selected-agent.sock")).unwrap();
    println!("VM_FULL_ENROLLMENT_COMPLETE");
}

fn merge_enrollment(f: &Fixture) -> String {
    let path = f
        .state_directory
        .join(".local/state/homelab/provisioning/hosts/vm-test/proposal.json");
    let proposal = configuration_pr::Changes::load(&path, &f.target.repository, "vm-test").unwrap();
    assert_eq!(
        proposal.base, f.target.revision,
        "fixture main moved before proposal preparation"
    );
    let owner = f.target.repository.split('/').next().unwrap();
    let pulls = api(
        f,
        "GET",
        &format!(
            "repos/{}/pulls?state=open&head={owner}:{}&base=main",
            f.target.repository,
            proposal.branch()
        ),
        None,
    );
    let pulls = pulls.as_array().unwrap();
    assert_eq!(pulls.len(), 1);
    let pull = &pulls[0];
    assert_eq!(pull["head"]["repo"]["full_name"], f.target.repository);
    assert_eq!(pull["base"]["repo"]["full_name"], f.target.repository);
    assert_eq!(pull["base"]["ref"], "main");
    assert_eq!(pull["head"]["ref"], proposal.branch());
    let number = pull["number"].as_u64().unwrap();
    let head = pull["head"]["sha"]
        .as_str()
        .filter(|s| config::valid_revision(s))
        .unwrap();
    let files = api(
        f,
        "GET",
        &format!("repos/{}/pulls/{number}/files", f.target.repository),
        None,
    );
    let mut names: Vec<_> = files
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["filename"].as_str().unwrap())
        .collect();
    names.sort();
    assert_eq!(
        names,
        [".sops.yaml", "homelab.json", "secrets/vm-test.sops.yaml"]
    );
    let current_main = api(
        f,
        "GET",
        &format!("repos/{}/commits/main", f.target.repository),
        None,
    );
    assert_eq!(
        current_main["sha"], proposal.base,
        "fixture main changed during preparation"
    );
    // GitHub rejects a changed head; no admin override or bypass of branch rules.
    let result = api(
        f,
        "PUT",
        &format!("repos/{}/pulls/{number}/merge", f.target.repository),
        Some(json!({"sha":head,"merge_method":"merge"})),
    );
    assert_eq!(result["merged"], true);
    let merged = result["sha"]
        .as_str()
        .filter(|s| config::valid_revision(s))
        .unwrap()
        .to_owned();
    vm::write_private(
        &f.state_directory.join("merged-revision"),
        merged.as_bytes(),
    );
    merged
}

fn drive(f: &Fixture) {
    let hostname = vm::bounded(Command::new("/bin/hostname")).unwrap();
    assert_eq!(hostname.trim(), f.operator_hostname);
    let mut jump = Command::new("/usr/bin/ssh");
    jump.args(["-F"])
        .arg(f.state_directory.join("jump.conf"))
        .arg(&f.jump_host)
        .arg("/bin/hostname");
    assert_eq!(
        vm::bounded(jump)
            .expect("approved jump host unavailable")
            .trim(),
        f.target.physical_hostname
    );
    vm::guard_guest(&f.target, &f.state_directory.join("vm-ssh"));
    let repository = api(f, "GET", &format!("repos/{}", f.target.repository), None);
    assert_eq!(
        repository["private"], true,
        "fixture repository must be private"
    );
    assert_eq!(repository["full_name"], f.target.repository);
    let main = api(
        f,
        "GET",
        &format!("repos/{}/commits/main", f.target.repository),
        None,
    );
    assert_eq!(main["sha"], f.target.revision);
    use configuration_pr::Api;
    let github = configuration_pr::GitHub {
        executable: f.state_directory.join("gh"),
    };
    let remote_manifest: config::Manifest = serde_json::from_slice(
        &github
            .raw(&format!(
                "repos/{}/contents/homelab.json?ref={}",
                f.target.repository, f.target.revision
            ))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        remote_manifest,
        vm::manifest(&f.target),
        "local fixture manifest differs from pinned Git source"
    );
    let fresh = vm::bounded(vm::ssh(
        &f.target,
        &f.state_directory.join("vm-ssh"),
        "/usr/bin/sudo -n /bin/test ! -e /var/db/homelab-setup",
    ));
    assert!(
        fresh.is_some(),
        "use a fresh guest without a previous setup receipt"
    );
    let boot = vm::bounded(vm::ssh(
        &f.target,
        &f.state_directory.join("vm-ssh"),
        "/usr/sbin/sysctl -n kern.bootsessionuuid",
    ))
    .unwrap();
    let mut terminal = Terminal::start(f);
    terminal.wait("SSH access verified", Duration::from_secs(90));
    terminal.enter();
    terminal.wait("Begin setup", Duration::from_secs(90));
    terminal.enter();
    terminal.wait(
        "Review and merge the enrollment PR",
        Duration::from_secs(300),
    );
    let merged = merge_enrollment(f);
    terminal.wait("VM_FULL_ENROLLMENT_COMPLETE", Duration::from_secs(90 * 60));
    assert!(terminal.child.wait().unwrap().success());
    assert_eq!(
        tcgetattr(&terminal.slave).unwrap().local_modes,
        terminal.original
    );
    assert!(f.state_directory.join("issued").exists());
    assert!(!f.state_directory.join("revoked").exists());
    assert_ne!(
        vm::bounded(vm::ssh(
            &f.target,
            &f.state_directory.join("vm-ssh"),
            "/usr/sbin/sysctl -n kern.bootsessionuuid"
        ))
        .unwrap(),
        boot
    );
    let snapshot = || {
        let keys = api(
            f,
            "GET",
            &format!("repos/{}/keys?per_page=100", f.target.repository),
            None,
        );
        let pulls = api(
            f,
            "GET",
            &format!("repos/{}/pulls?state=all&per_page=100", f.target.repository),
            None,
        );
        assert!(keys.as_array().unwrap().len() < 100);
        assert!(pulls.as_array().unwrap().len() < 100);
        (keys, pulls)
    };
    let before_replay = snapshot();
    let replay_boot = vm::bounded(vm::ssh(
        &f.target,
        &f.state_directory.join("vm-ssh"),
        "/usr/sbin/sysctl -n kern.bootsessionuuid",
    ))
    .unwrap();
    let mut replay = Terminal::start(f);
    replay.wait("SSH access verified", Duration::from_secs(90));
    replay.enter();
    replay.wait("Begin setup", Duration::from_secs(90));
    replay.enter();
    replay.wait("VM_FULL_ENROLLMENT_COMPLETE", Duration::from_secs(600));
    assert!(replay.child.wait().unwrap().success());
    assert_eq!(
        tcgetattr(&replay.slave).unwrap().local_modes,
        replay.original
    );
    assert_eq!(
        fs::read(f.state_directory.join("issued")).unwrap(),
        b"one synthetic issuance"
    );
    assert!(!f.state_directory.join("revoked").exists());
    assert_eq!(
        snapshot(),
        before_replay,
        "completed replay changed GitHub keys or PRs"
    );
    assert_eq!(
        vm::bounded(vm::ssh(
            &f.target,
            &f.state_directory.join("vm-ssh"),
            "/usr/sbin/sysctl -n kern.bootsessionuuid"
        ))
        .unwrap(),
        replay_boot,
        "completed replay rebooted again"
    );
    let remote_ciphertext = github
        .raw(&format!(
            "repos/{}/contents/secrets/vm-test.sops.yaml?ref={merged}",
            f.target.repository
        ))
        .unwrap();
    let ciphertext = fs::read(
        f.state_directory
            .join(".local/state/homelab/provisioning/hosts/vm-test/review/vm-test.sops.yaml"),
    )
    .unwrap();
    assert_eq!(
        remote_ciphertext, ciphertext,
        "merged ciphertext differs from this enrollment"
    );
    let mut activated = f.target.clone();
    activated.revision = merged.clone();
    vm::verify_activation(&activated, &f.state_directory.join("vm-ssh"));
    vm::write_private(&f.state_directory.join("evidence.json"), &serde_json::to_vec_pretty(&json!({"repository":f.target.repository,"enrollmentRevision":merged,"wizardCompleted":true,"rebootVerified":true,"completedReplayVerified":true,"provider":"synthetic","tailscaleRoute":"pinned guest SSH adapter","comin":"real completion verification"})).unwrap());
    println!(
        "Full VM wizard completed. Evidence preserved; provider and Tailscale transport were synthetic."
    );
}

fn prepare_run(path: &Path) {
    let mut f = load(path);
    assert!(
        !f.state_directory.exists(),
        "operator state must be fresh; preserve existing attempts"
    );
    vm::directory(&f.state_directory);
    let state = f.state_directory.clone();
    for (name, source) in [
        ("guest-key", &f.target.ssh_private_key),
        ("guest-known-hosts", &f.target.known_hosts),
        ("manifest.json", &f.target.manifest_path),
        ("jump-known-hosts", &f.jump_known_hosts),
    ] {
        vm::write_private(&state.join(name), &vm::private_bytes(source, 65536));
    }
    f.target.ssh_private_key = state.join("guest-key");
    f.target.known_hosts = state.join("guest-known-hosts");
    f.target.manifest_path = state.join("manifest.json");
    f.jump_known_hosts = state.join("jump-known-hosts");
    let manifest = vm::manifest(&f.target);
    assert!(
        !manifest.hosts["vm-test"].activation_ready
            && manifest.hosts["vm-test"].authorized_keys.is_empty(),
        "full enrollment starts with an unready, unauthorised host"
    );
    let known = fs::read_to_string(&f.target.known_hosts).unwrap();
    let lines: Vec<_> = known
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    assert_eq!(lines.len(), 1);
    assert_eq!(
        lines[0].split_whitespace().next().unwrap(),
        f.target.guest_ip.to_string()
    );
    let jump_keys = fs::read_to_string(&f.jump_known_hosts).unwrap();
    let lines: Vec<_> = jump_keys
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .collect();
    assert_eq!(lines.len(), 1);
    assert_eq!(
        lines[0].split_whitespace().next(),
        Some(f.jump_host.as_str())
    );
    vm::write_private(&state.join("jump.conf"), format!("Host {}\n  User admin\n  StrictHostKeyChecking yes\n  UserKnownHostsFile \"{}\"\n  GlobalKnownHostsFile /dev/null\n  IdentityAgent \"{}\"\n  ForwardAgent no\n  ClearAllForwardings yes\n  ControlMaster no\n  ControlPath none\n  ProxyCommand none\n  ProxyJump none\n  ConnectTimeout 8\n", f.jump_host, f.jump_known_hosts.display(), f.jump_agent_socket.display()).as_bytes());
    let public = Command::new("/usr/bin/ssh-keygen")
        .args(["-y", "-f"])
        .arg(&f.target.ssh_private_key)
        .output()
        .unwrap();
    assert!(public.status.success());
    let public = String::from_utf8(public.stdout).unwrap();
    let public = public
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    assert!(public.starts_with("ssh-ed25519 "));
    vm::write_private(
        &state.join("selected.pub"),
        format!("{public}\n").as_bytes(),
    );
    inventory::add(
        &state.join("inventory.json"),
        inventory::HostProfile {
            name: "vm-fixture".into(),
            address: f.target.guest_ip.to_string(),
            user: "admin".into(),
            configuration_host: Some("vm-test".into()),
            identity: Some(inventory::AgentIdentity {
                public_key: public,
                agent_socket: state.join("selected-agent.sock"),
            }),
        },
    )
    .unwrap();
    vm::write_private(
        &state.join("repository.json"),
        &serde_json::to_vec(&json!({"schema":1,"repository":f.target.repository})).unwrap(),
    );
    vm::directory(&state.join("synthetic-vault"));
    for name in ["vm-ssh", "vm-scp", "vm-tailnet", "gh"] {
        fs::hard_link(std::env::current_exe().unwrap(), state.join(name)).unwrap();
    }
    for (name, source) in [
        ("homelab-host", &f.target.helper_path),
        ("age-keygen", &f.age_keygen),
        ("sops", &f.sops),
    ] {
        fs::copy(source, state.join(name)).unwrap();
        fs::set_permissions(state.join(name), fs::Permissions::from_mode(0o700)).unwrap();
    }
    f.age_keygen = state.join("age-keygen");
    f.sops = state.join("sops");
    let runner = state.join("vm-enrollment");
    fs::hard_link(std::env::current_exe().unwrap(), &runner).unwrap();
    vm::write_private(
        &state.join("enrollment.json"),
        &serde_json::to_vec(&f).unwrap(),
    );
    let status = Command::new(runner)
        .arg("--drive")
        .env_clear()
        .env(ENV, state.join("enrollment.json"))
        .env("HOME", &state)
        .env(
            "PATH",
            format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", state.display()),
        )
        .status()
        .unwrap();
    assert!(
        status.success(),
        "fixture failed; preserve operator state and VM before retrying"
    );
}

fn main() {
    regressions();
    let executable = std::env::args_os().next().unwrap();
    let name = Path::new(&executable)
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    if matches!(name, "vm-ssh" | "vm-scp" | "vm-tailnet" | "gh") {
        let f = fixture();
        if name == "gh" {
            github(&f);
        }
        transport(&f, name == "vm-tailnet", name == "vm-scp");
    }
    match std::env::args().nth(1).as_deref() {
        Some("--run") => prepare_run(Path::new(
            &std::env::args_os()
                .nth(2)
                .expect("private fixture path required"),
        )),
        Some("--drive") => drive(&fixture()),
        Some("--wizard-child") => wizard(&fixture()),
        _ => println!(
            "Full VM enrollment skipped. Explicit opt-in: vm_enrollment --run /absolute/private/fixture.json"
        ),
    }
}
