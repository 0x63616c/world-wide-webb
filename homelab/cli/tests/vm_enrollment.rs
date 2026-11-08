//! Opt-in wizard rehearsal with real fixture Git publication and a disposable VM.
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
    #[serde(default)]
    review_required: bool,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password_file: Option<PathBuf>,
}

fn fixture() -> Fixture {
    load(Path::new(
        &std::env::var_os(ENV).expect("explicit enrollment fixture required"),
    ))
}
fn load(path: &Path) -> Fixture {
    let f: Fixture = serde_json::from_slice(&vm::private_bytes(path, 32 * 1024)).unwrap();
    vm::validate_fixture(&f.target);
    let manifest = vm::manifest(&f.target);
    assert!(
        manifest.schema == 2 && manifest.one_password.is_some(),
        "full enrollment requires schema 2 and the synthetic backup vault"
    );
    assert!(
        manifest.tailscale.unwrap().oauth.is_some(),
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
    // Parse only the forms emitted by the client. A single explicit method may
    // precede or follow the endpoint; aliases and overrides are never accepted.
    let mut endpoint = None;
    let mut method = None;
    let mut body = false;
    let mut index = 3;
    while index < args.len() {
        let Some(arg) = args[index].to_str() else {
            return false;
        };
        match arg {
            "--method" => {
                if method.is_some() {
                    return false;
                }
                index += 1;
                method = args.get(index).and_then(|value| value.to_str());
                if method.is_none() {
                    return false;
                }
            }
            "--input" | "--field" | "--raw-field" | "--jq" | "--header" => {
                body |= matches!(arg, "--input" | "--field" | "--raw-field");
                index += 1;
                let Some(value) = args.get(index).and_then(|value| value.to_str()) else {
                    return false;
                };
                if value.starts_with('-') && !(arg == "--input" && value == "-") {
                    return false;
                }
                if arg == "--header" && value != "Accept: application/vnd.github.raw+json" {
                    return false;
                }
            }
            "--paginate" | "--slurp" => {}
            value if !value.starts_with('-') && endpoint.is_none() => endpoint = Some(value),
            _ => return false,
        }
        index += 1;
    }
    let Some(endpoint) = endpoint else {
        return false;
    };
    let method = method.unwrap_or("GET");
    let relative = endpoint
        .strip_prefix(&format!("repos/{repository}/"))
        .unwrap_or("");
    let pull_number =
        |value: &str| !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit());
    let mutation_allowed = match method {
        "GET" => !body,
        "POST" => matches!(
            relative,
            "keys" | "git/trees" | "git/commits" | "git/refs" | "pulls"
        ),
        "PATCH" => {
            relative == "git/refs/heads/main"
                || relative.strip_prefix("pulls/").is_some_and(pull_number)
        }
        "PUT" => relative
            .strip_prefix("pulls/")
            .and_then(|path| path.strip_suffix("/merge"))
            .is_some_and(pull_number),
        _ => false,
    };
    let prefix = format!("repos/{repository}");
    mutation_allowed
        && (endpoint == prefix || endpoint.starts_with(&format!("{prefix}/")))
        && !endpoint.contains(['%', '\\'])
        && (!endpoint.contains("..")
            || (method == "GET"
                && relative
                    .strip_prefix("compare/")
                    .and_then(|value| value.strip_suffix("...main"))
                    .is_some_and(config::valid_revision)))
        && !args
            .iter()
            .skip(3)
            .any(|s| s.to_str().is_some_and(|s| s.starts_with("--hostname")))
}

fn regressions() {
    vm::manifest_guard_regressions();
    let report = homelab_client::bootstrap_privileged::VerifiedSetup {
        request_id: "a".repeat(64),
        schema: 1,
        main_revision: "b".repeat(40),
        system: "/nix/store/synthetic-system".into(),
        binding: "c".repeat(64),
        rebooted: true,
        completed: false,
        completed_at: None,
        reconciled_revision: None,
        boot_session: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE".into(),
        tailscale: homelab_client::tailscale::VerifiedNode {
            dns_name: "vm-test.synthetic.ts.net".into(),
            addresses: vec!["100.64.0.1".parse().unwrap()],
        },
    };
    assert!(completion_matches(
        &report,
        &report.binding,
        &report.system,
        &report.boot_session
    ));
    for changed in [
        homelab_client::bootstrap_privileged::VerifiedSetup {
            rebooted: false,
            ..report.clone()
        },
        homelab_client::bootstrap_privileged::VerifiedSetup {
            binding: "d".repeat(64),
            ..report.clone()
        },
        homelab_client::bootstrap_privileged::VerifiedSetup {
            system: "/nix/store/another-system".into(),
            ..report.clone()
        },
        homelab_client::bootstrap_privileged::VerifiedSetup {
            boot_session: "11111111-2222-3333-4444-555555555555".into(),
            ..report.clone()
        },
    ] {
        assert!(!completion_matches(
            &changed,
            &report.binding,
            &report.system,
            &report.boot_session
        ));
    }

    assert_eq!(observed_phase("unknown sensitive output"), None);
    assert_eq!(
        observed_phase(&format!(
            "{}\nsecret-sentinel\n{}",
            COMPLETION_PHASES[1], COMPLETION_PHASES[2]
        )),
        Some(COMPLETION_PHASES[2])
    );
    for error in [
        homelab_client::remote_completion::Error::Selection,
        homelab_client::remote_completion::Error::Verification,
        homelab_client::remote_completion::Error::Tailnet,
        homelab_client::remote_completion::Error::Reboot,
        homelab_client::remote_completion::Error::RebootRequest,
        homelab_client::remote_completion::Error::TailscaleClient,
    ] {
        assert_eq!(safe_failure(&[error.to_string()]), error.to_string());
    }

    let check = PRE_BOOTSTRAP_CHECK
        .replace("/usr/bin/sudo -n /bin/test", "fixture_test")
        .replace("/usr/bin/pgrep", "fixture_pgrep");
    for (journal, store, helper, installer, accepted) in [
        (0, 0, 1, 1, true),
        (1, 0, 1, 1, false),
        (0, 1, 1, 1, false),
        (0, 0, 0, 1, false),
        (0, 0, 1, 0, false),
        (0, 0, 2, 1, false),
        (0, 0, 1, 2, false),
    ] {
        let script = format!(
            "fixture_test() {{ case \"$3\" in /Users/admin/.local/state/homelab/bootstrap/progress.json) return {journal};; *) return {store};; esac; }}\nfixture_pgrep() {{ case \"$2\" in homelab-host) return {helper};; *) return {installer};; esac; }}\n{check}"
        );
        assert_eq!(
            Command::new("/bin/sh")
                .arg("-c")
                .arg(script)
                .status()
                .unwrap()
                .success(),
            accepted
        );
    }

    let directory = tempfile::tempdir().unwrap();
    let old = directory.path().join("old");
    let adapter = directory.path().join("adapter");
    let new = directory.path().join("new");
    fs::write(&old, b"old executable").unwrap();
    fs::hard_link(&old, &adapter).unwrap();
    fs::write(&new, b"new reviewed executable").unwrap();
    install_adapter(&new, &adapter);
    assert_eq!(fs::read(&old).unwrap(), b"old executable");
    assert_eq!(fs::read(&adapter).unwrap(), b"new reviewed executable");

    assert_eq!(
        safe_failure(&["secret sentinel should not escape".into()]),
        "Unclassified wizard outcome; saved state preserved."
    );
    assert_eq!(
        safe_failure(&[SAFE_FAILURES[0].into(), "secret sentinel".into()]),
        SAFE_FAILURES[0]
    );
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
    assert!(github_arguments_allowed(
        "owner/homelab-vm-test",
        &args(&[
            "api",
            "--hostname",
            "github.com",
            "repos/owner/homelab-vm-test/keys",
            "--method",
            "POST",
            "--raw-field",
            "title=fixture",
            "--raw-field",
            "key=ssh-ed25519 synthetic",
            "--field",
            "read_only=true"
        ])
    ));
    assert!(github_arguments_allowed(
        "owner/homelab-vm-test",
        &args(&[
            "api",
            "--hostname",
            "github.com",
            "repos/owner/homelab-vm-test/keys?per_page=100",
            "--paginate",
            "--slurp"
        ])
    ));
    for suffix in [
        vec!["--method", "DELETE"],
        vec!["--method", "POST"],
        vec!["-XDELETE"],
        vec!["--method=DELETE"],
        vec!["--hostname", "example.org"],
        vec!["repos/owner/production/keys"],
    ] {
        let mut command = args(&[
            "api",
            "--hostname",
            "github.com",
            "repos/owner/homelab-vm-test/keys",
            "--method",
            "POST",
        ]);
        command.extend(args(&suffix));
        assert!(!github_arguments_allowed("owner/homelab-vm-test", &command));
    }
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
    let comparison = format!(
        "repos/owner/homelab-vm-test/compare/{}...main",
        "a".repeat(40)
    );
    assert!(github_arguments_allowed(
        "owner/homelab-vm-test",
        &args(&[
            "api",
            "--hostname",
            "github.com",
            "--method",
            "GET",
            &comparison,
            "--jq",
            "{status}",
        ])
    ));
    for endpoint in [
        "repos/owner/production/pulls",
        "repos/owner/homelab-vm-test/compare/../main",
        "repos/owner/homelab-vm-test/compare/not-a-revision...main",
        "repos/owner/homelab-vm-test/compare/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa...main/../hooks",
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
        // Changing HOME makes gh lose access to the operator's macOS keychain.
        .env("XDG_STATE_HOME", f.state_directory.join(".local/state"))
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
    screen: vt100::Parser,
    last_phase: Option<&'static str>,
    password: Option<zeroize::Zeroizing<Vec<u8>>>,
    password_visible: bool,
    password_entries: usize,
    installation_acknowledged: bool,
}
impl Terminal {
    fn start(f: &Fixture) -> Self {
        let password = f.password_file.as_ref().map(|path| {
            let bytes = zeroize::Zeroizing::new(vm::private_bytes(path, 128));
            assert!(bytes.len() >= 16 && bytes.iter().all(u8::is_ascii_alphanumeric));
            bytes
        });
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
            screen: vt100::Parser::new(60, 120, 0),
            last_phase: None,
            password,
            password_visible: false,
            password_entries: 0,
            installation_acknowledged: false,
        }
    }
    fn wait(&mut self, expected: &'static str, duration: Duration) {
        let deadline = Instant::now() + duration;
        loop {
            let mut buffer = [0; 8192];
            match self.master.read(&mut buffer) {
                Ok(size) => {
                    self.text
                        .push_str(&String::from_utf8_lossy(&buffer[..size]));
                    self.screen.process(&buffer[..size]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                Err(_) => panic!(
                    "wizard terminal unavailable while waiting for {expected}; preserve fixture state"
                ),
            }
            let screen = self.screen.screen().contents();
            if !self.installation_acknowledged
                && screen.contains("Installation complete.")
                && screen.contains("Press Enter to continue")
            {
                self.enter();
                self.installation_acknowledged = true;
            }
            if let Some(password) = &self.password {
                let text = std::str::from_utf8(password).unwrap();
                assert!(
                    !self.text.contains(text) && !screen.contains(text),
                    "fixture password was rendered"
                );
                let visible = screen.contains("Password:") && screen.contains("Submit");
                if visible && !self.password_visible {
                    assert_eq!(
                        self.password_entries, 0,
                        "wizard requested a second password entry"
                    );
                    self.master.write_all(password).unwrap();
                    self.master.write_all(b"\r").unwrap();
                    self.password_entries += 1;
                }
                self.password_visible = visible;
            }
            self.last_phase = observed_phase(&screen)
                .or_else(|| observed_phase(&self.text))
                .or(self.last_phase);
            assert!(
                !self.text.contains(AUTH_KEY)
                    && !self.text.contains("AGE-SECRET-KEY-")
                    && !screen.contains(AUTH_KEY)
                    && !screen.contains("AGE-SECRET-KEY-"),
                "synthetic credential appeared while waiting for {expected}"
            );
            if self.text.contains(expected) || screen.contains(expected) {
                self.text.clear();
                return;
            }
            if self.text.contains("R Retry checks")
                || screen.contains("R Retry checks")
                || screen.contains("Setup needs attention")
                || screen.contains("Step failed")
            {
                let reason = SAFE_FAILURES
                    .iter()
                    .copied()
                    .find(|message| self.text.contains(message) || screen.contains(message))
                    .unwrap_or("Checklist step failed; preserve fixture state for inspection.");
                panic!("wizard needs attention before {expected}: {reason}");
            }
            // Live progress redraws indefinitely; retain a bounded tail instead
            // of treating a slow, healthy installation as excessive output.
            if self.text.len() > 128 * 1024 {
                let mut start = self.text.len() - 64 * 1024;
                while !self.text.is_char_boundary(start) {
                    start += 1;
                }
                self.text.drain(..start);
            }
            if self.child.try_wait().unwrap().is_some() {
                let reason = SAFE_FAILURES
                    .iter()
                    .copied()
                    .find(|message| self.text.contains(&format!("{FAILURE_PREFIX}{message}")))
                    .unwrap_or("Unclassified wizard outcome; saved state preserved.");
                let phase = self.last_phase.unwrap_or("No completion phase observed");
                panic!("wizard stopped before {expected}; last phase: {phase}; {reason}");
            }
            assert!(
                Instant::now() < deadline,
                "wizard timed out waiting for {expected}; last phase: {}; preserve fixture state",
                self.last_phase.unwrap_or("No completion phase observed")
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

// Only these reviewed static messages may leave the captured wizard. Never print
// Outcome lines wholesale: future errors could contain paths or provider data.
const SAFE_FAILURES: &[&str] = &[
    "The saved installation selection is invalid. Preserve this setup attempt.",
    "Setup verification could not be confirmed. Resume this attempt; do not reinstall.",
    "Tailscale SSH could not reach this Mac. Check this client's Tailscale connection, SSH access policy and any browser approval request, then resume setup.",
    "The Mac has not returned from reboot yet. Leave it powered on; FileVault may require a local unlock, then resume setup.",
    "Restart was not confirmed. Check administrator authentication and resume this setup attempt.",
    "Install the standalone Tailscale client with its CLI on this Mac, connect to your tailnet, then resume setup.",
    "GitHub access failed. Check your local GitHub sign-in and repository permissions.",
    "Existing configuration conflicts with this enrollment. Nothing was overwritten.",
    "A repository file was not found at the reviewed revision.",
    "The enrollment configuration is invalid or contains unexpected secret fields.",
    "The private bootstrap review bundle could not be prepared.",
    "The matching homelab-host helper is missing. Reinstall homelab from the official release or Homebrew tap.",
    "The setup selection is invalid or does not use the intended existing administrator.",
    "The local artifact, checksums, revision or setup plan could not be verified.",
    "The reviewed configuration is not ready for this host's first setup.",
    "The private credential files could not be safely prepared.",
    "The target could not be inspected through verified SSH.",
    "The target's Git identity could not be confirmed.",
    "A private remote staging directory could not be confirmed.",
    "The setup files could not be transferred.",
    "The staged artifact failed verification; bootstrap was not started.",
    "Remote staging cleanup could not be confirmed.",
];
const COMPLETION_PHASES: &[&str] = &[
    "Checking services, Tailscale and Git access",
    "Restarting the Mac and waiting for it to return",
    "Verifying the Mac after reboot",
    "Building and applying Git main",
];
fn observed_phase(text: &str) -> Option<&'static str> {
    COMPLETION_PHASES
        .iter()
        .filter_map(|phase| text.rfind(phase).map(|position| (position, *phase)))
        .max_by_key(|(position, _)| *position)
        .map(|(_, phase)| phase)
}
const FAILURE_PREFIX: &str = "VM_ENROLLMENT_FAILURE: ";
fn safe_failure(lines: &[String]) -> &'static str {
    SAFE_FAILURES
        .iter()
        .copied()
        .find(|message| lines.iter().any(|line| line == message))
        .unwrap_or("Unclassified wizard outcome; saved state preserved.")
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
        check_client_tools: || Ok(()),
        prepare_credentials: prepare,
        tailscale: Some(f.state_directory.join("vm-tailnet")),
    };
    let result = setup_wizard::launch_with_dependencies(&profile, &path, &tools, &dependencies)
        .expect("wizard IO failed");
    if !result.completed {
        println!("{FAILURE_PREFIX}{}", safe_failure(&result.lines));
    }
    assert!(
        result.completed && result.lines.iter().any(|line| line == "vm-test is set up!"),
        "enrollment did not complete; preserve fixture state"
    );
    drop(_selected_socket);
    fs::remove_file(f.state_directory.join("selected-agent.sock")).unwrap();
    println!("VM_FULL_ENROLLMENT_COMPLETE");
}

fn merge_enrollment(f: &Fixture) -> String {
    let path = f
        .state_directory
        .join(".homelab/profiles/default/provisioning/hosts/vm-test/proposal.json");
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

fn drive(f: &Fixture, resume: bool) {
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
    let resumed_revision = resume.then(|| validate_resume(f));
    assert_eq!(
        main["sha"],
        resumed_revision.as_deref().unwrap_or(&f.target.revision)
    );
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
        "/usr/bin/sudo -n /bin/test ! -e /Users/admin/.local/state/homelab/bootstrap/progress.json",
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
    terminal.wait("✓ Mac checked", Duration::from_secs(90));
    terminal.enter();
    terminal.wait("Begin setup", Duration::from_secs(90));
    terminal.enter();
    let merged = if let Some(revision) = resumed_revision {
        Some(revision)
    } else if f.review_required {
        terminal.wait("Review and merge the setup PR", Duration::from_secs(300));
        Some(merge_enrollment(f))
    } else {
        None
    };
    terminal.wait("VM_FULL_ENROLLMENT_COMPLETE", Duration::from_secs(90 * 60));
    if f.password_file.is_some() {
        assert_eq!(
            terminal.password_entries, 1,
            "native sudo authentication was not exercised"
        );
    }
    assert!(terminal.child.wait().unwrap().success());
    let approved = provisioning::approved_installation(
        &f.state_directory
            .join(".homelab/profiles/default/provisioning"),
        "vm-test",
    )
    .unwrap()
    .expect("completed setup must retain its exact approved revision");
    let merged = merged.unwrap_or_else(|| approved.revision.clone());
    assert_eq!(merged, approved.revision);
    vm::write_private(
        &f.state_directory.join("merged-revision"),
        merged.as_bytes(),
    );
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
    replay.wait("✓ Mac checked", Duration::from_secs(90));
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
            .join(".homelab/profiles/default/provisioning/hosts/vm-test/review/vm-test.sops.yaml"),
    )
    .unwrap();
    assert_eq!(
        remote_ciphertext, ciphertext,
        "merged ciphertext differs from this enrollment"
    );
    let mut activated = f.target.clone();
    activated.revision = merged.clone();
    vm::verify_activation(&activated, &f.state_directory.join("vm-ssh"));
    vm::write_private(&f.state_directory.join("evidence.json"), &serde_json::to_vec_pretty(&json!({"repository":f.target.repository,"enrollmentRevision":merged,"wizardCompleted":true,"rebootVerified":true,"completedReplayVerified":true,"provider":"synthetic","tailscaleRoute":"pinned guest SSH adapter","comin":"real completion verification","passwordEntries":terminal.password_entries,"passwordRequired":f.password_file.is_some()})).unwrap());
    println!(
        "Full VM wizard completed. Evidence preserved; provider and Tailscale transport were synthetic."
    );
}

fn install_adapter(source: &Path, destination: &Path) {
    // Rename a complete new inode; old hard links and running mappings stay intact.
    let mut staged = tempfile::NamedTempFile::new_in(destination.parent().unwrap()).unwrap();
    let mut source = File::open(source).unwrap();
    std::io::copy(&mut source, &mut staged).unwrap();
    staged
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o700))
        .unwrap();
    staged.as_file().sync_all().unwrap();
    staged.persist(destination).unwrap();
}

fn validate_resume(f: &Fixture) -> String {
    use configuration_pr::Api;
    let revision = String::from_utf8(vm::private_bytes(
        &f.state_directory.join("merged-revision"),
        40,
    ))
    .unwrap();
    assert!(config::valid_revision(&revision));
    assert_eq!(
        vm::private_bytes(&f.state_directory.join("issued"), 128),
        b"one synthetic issuance"
    );
    assert!(!f.state_directory.join("revoked").exists());
    assert!(
        !f.state_directory.join("evidence.json").exists(),
        "completed fixtures use the completion replay, not pre-bootstrap resume"
    );
    let root = f
        .state_directory
        .join(".homelab/profiles/default/provisioning");
    assert!(
        provisioning::approved_installation(&root, "vm-test")
            .unwrap()
            .is_none(),
        "resume is limited to the merged-PR, pre-bootstrap boundary"
    );
    let proposal = configuration_pr::Changes::load(
        &root.join("hosts/vm-test/proposal.json"),
        &f.target.repository,
        "vm-test",
    )
    .unwrap();
    assert_eq!(proposal.base, f.target.revision);
    // Validate with this reviewed executable, not a preserved older adapter.
    let temporary = tempfile::tempdir().unwrap();
    let adapter = temporary.path().join("gh");
    install_adapter(&std::env::current_exe().unwrap(), &adapter);
    let github = configuration_pr::GitHub {
        executable: adapter,
    };
    let owner = f.target.repository.split('/').next().unwrap();
    let pulls = github
        .json(
            "GET",
            &format!(
                "repos/{}/pulls?state=all&head={owner}:{}&base=main",
                f.target.repository,
                proposal.branch()
            ),
            None,
        )
        .unwrap();
    let pulls = pulls.as_array().unwrap();
    assert_eq!(pulls.len(), 1);
    let approved = configuration_pr::approved_workspace(
        &github,
        &proposal,
        pulls[0]["number"].as_u64().unwrap(),
    )
    .unwrap()
    .expect("saved enrollment PR must be merged");
    assert_eq!(approved.revision, revision);
    // Exact-main equality is checked by drive before launching the wizard.
    revision
}

fn preserved_run(path: &Path, action: &str) {
    let f = load(path);
    assert_eq!(
        path,
        f.state_directory.join("enrollment.json"),
        "use the preserved fixture snapshot"
    );
    let status = Command::new(std::env::current_exe().unwrap())
        .arg(action)
        .env_clear()
        .env(ENV, path)
        .env("HOME", &f.state_directory)
        .env(
            "PATH",
            format!(
                "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                f.state_directory.display()
            ),
        )
        .status()
        .unwrap();
    assert!(
        status.success(),
        "resume failed; preserve the existing attempt"
    );
}

const PRE_BOOTSTRAP_CHECK: &str = r#"
/usr/bin/sudo -n /bin/test ! -e /Users/admin/.local/state/homelab/bootstrap/progress.json || exit 2
/usr/bin/sudo -n /bin/test ! -e /nix/store || exit 2
/usr/bin/pgrep -x homelab-host >/dev/null
[ "$?" -eq 1 ] || exit 2
/usr/bin/pgrep -x nix-installer >/dev/null
[ "$?" -eq 1 ]
"#;

// Before enrollment, Nix may already exist from the unchanged-config build.
// No bootstrap journal or installed enrollment identities may exist.
const PRE_PREPARATION_CHECK: &str = r#"
/usr/bin/sudo -n /bin/test ! -e /Users/admin/.local/state/homelab/bootstrap || exit 2
/usr/bin/sudo -n /bin/test ! -e /var/lib/sops-nix/key.txt || exit 2
/usr/bin/sudo -n /bin/test ! -e /var/lib/homelab-git/key.txt || exit 2
/usr/bin/pgrep -x homelab-host >/dev/null
[ "$?" -eq 1 ] || exit 2
/usr/bin/pgrep -x nix-installer >/dev/null
[ "$?" -eq 1 ]
"#;

fn require_idle_operator(f: &Fixture) {
    // Match only executable paths in this attempt, not a potentially enormous
    // process listing or shell arguments mentioning the fixture path.
    let mut pattern = String::from("^");
    for character in f.state_directory.to_str().unwrap().chars() {
        if ".^$*+?()[]{}|\\".contains(character) {
            pattern.push('\\');
        }
        pattern.push(character);
    }
    pattern.push('/');
    let mut command = Command::new("/usr/bin/pgrep");
    command.args(["-f", &pattern]).stdin(Stdio::null());
    let result = homelab_client::process::capture(&mut command, Duration::from_secs(10)).unwrap();
    assert_eq!(
        result.status.code(),
        Some(1),
        "an operator process for this attempt may still be active"
    );
}

fn completion_matches(
    report: &homelab_client::bootstrap_privileged::VerifiedSetup,
    binding: &str,
    system: &Path,
    boot: &str,
) -> bool {
    report.schema == 1
        && report.rebooted
        && report.binding == binding
        && report.system == system
        && report.boot_session.eq_ignore_ascii_case(boot.trim())
}

fn complete_preserved(f: &Fixture, already_rebooted: bool) {
    use homelab_client::remote_completion;
    assert_eq!(
        vm::bounded(Command::new("/bin/hostname")).unwrap().trim(),
        f.operator_hostname
    );
    require_idle_operator(f);
    let ssh = f.state_directory.join("vm-ssh");
    vm::guard_guest(&f.target, &ssh);
    assert!(vm::bounded(vm::ssh(&f.target, &ssh,
        "/usr/bin/pgrep -x homelab-host >/dev/null; [ \"$?\" -eq 1 ] || exit 2; /usr/bin/pgrep -x nix-installer >/dev/null; [ \"$?\" -eq 1 ]"
    )).is_some(), "guest bootstrap/helper may still be active");
    let saved = provisioning::approved_installation(
        &f.state_directory
            .join(".homelab/profiles/default/provisioning"),
        "vm-test",
    )
    .unwrap()
    .expect("saved approved installation required");
    let merged = if already_rebooted {
        String::from_utf8(vm::private_bytes(
            &f.state_directory.join("merged-revision"),
            40,
        ))
        .unwrap()
    } else {
        saved.revision.clone()
    };
    assert!(config::valid_revision(&merged));
    assert_eq!(saved.repository, f.target.repository);
    assert_eq!(saved.host, "vm-test");
    assert_eq!(saved.revision, merged);
    let profiles = inventory::load(&f.state_directory.join("inventory.json")).unwrap();
    assert_eq!(profiles.len(), 1);
    let profile = &profiles[0];
    assert_eq!(profile.user, "admin");
    assert_eq!(profile.address, f.target.guest_ip.to_string());
    assert_eq!(profile.configuration_host.as_deref(), Some("vm-test"));
    let public = vm::private_bytes(&f.state_directory.join("selected.pub"), 16384);
    assert_eq!(
        profile.identity.as_ref().unwrap().public_key,
        String::from_utf8(public).unwrap().trim()
    );
    let read = |command: &str| {
        vm::bounded(vm::ssh(&f.target, &ssh, command))
            .expect("read-only completion preflight failed")
    };
    let system: PathBuf = serde_json::from_str(&read(
        "/run/current-system/sw/bin/homelab-host current-system",
    ))
    .unwrap();
    let metadata: Value = serde_json::from_str(&read(
        "/bin/cat /run/current-system/etc/homelab/revision.json",
    ))
    .unwrap();
    assert_eq!(
        metadata,
        json!({"repository":f.target.repository,"host":"vm-test","revision":merged})
    );
    let binding = config::setup_binding(&f.target.repository, "vm-test", &merged).unwrap();
    let boot = read("/usr/sbin/sysctl -n kern.bootsessionuuid");
    if already_rebooted {
        let report: homelab_client::bootstrap_privileged::VerifiedSetup = serde_json::from_str(
            &read(&format!("/bin/cat /var/db/homelab-setup/{binding}.json")),
        )
        .unwrap();
        // Authenticate the existing public report through the real read-only helper.
        assert!(
            report.request_id.len() == 64
                && report.request_id.bytes().all(|c| c.is_ascii_hexdigit())
        );
        let verified: homelab_client::bootstrap_privileged::VerifiedSetup = serde_json::from_str(&read(&format!("/run/current-system/sw/bin/homelab-host read-setup-report --binding '{binding}' --request-id '{}'", report.request_id))).unwrap();
        assert!(
            completion_matches(&verified, &binding, &system, &boot),
            "recovery requires proof this installation already rebooted"
        );
    } else {
        let journal: Value = serde_json::from_str(&read(
            "/bin/cat /Users/admin/.local/state/homelab/bootstrap/progress.json",
        ))
        .unwrap();
        assert_eq!(journal["phase"], "Activated");
        assert_eq!(journal["revision"], merged);
        assert_eq!(journal["repository"], f.target.repository);
        assert_eq!(journal["builtSystem"].as_str(), system.to_str());
    }
    let main = api(
        f,
        "GET",
        &format!("repos/{}/commits/main", f.target.repository),
        None,
    );
    assert_eq!(main["sha"], merged);
    assert_eq!(
        vm::private_bytes(&f.state_directory.join("issued"), 128),
        b"one synthetic issuance"
    );
    assert!(!f.state_directory.join("revoked").exists());
    let mut previous_boot = boot.clone();
    for attempt in 0..2 {
        let result = remote_completion::finish_with_tools(
            profile,
            &ssh,
            &f.state_directory.join("vm-tailnet"),
            remote_completion::Installation {
                repository: &f.target.repository,
                host: "vm-test",
                revision: &merged,
                tag: "tag:vm-test",
            },
            |phase| {
                if let Some(known) = observed_phase(phase.message()) {
                    println!("{known}");
                }
            },
        );
        let report = result.unwrap_or_else(|error| {
            panic!(
                "completion recovery failed: {}",
                safe_failure(&[error.to_string()])
            )
        });
        assert!(
            report.completed
                && report.rebooted
                && report.reconciled_revision.as_deref() == Some(merged.as_str())
        );
        let current_boot = read("/usr/sbin/sysctl -n kern.bootsessionuuid");
        if !already_rebooted && attempt == 0 {
            assert_ne!(
                current_boot, boot,
                "completion must reboot the activated VM"
            );
        } else {
            assert_eq!(
                current_boot, previous_boot,
                "completion replay must not reboot again"
            );
        }
        previous_boot = current_boot;
    }
    let mut activated = f.target.clone();
    activated.revision = merged.clone();
    vm::verify_activation(&activated, &ssh);
    vm::write_private(&f.state_directory.join("completion-recovery-evidence.json"), &serde_json::to_vec_pretty(&json!({"repository":f.target.repository,"enrollmentRevision":merged,"recoveredCompletion":true,"completionReplayVerified":true,"rebootVerified":true,"bootUnchanged":already_rebooted,"uninterruptedWizardVerified":false,"provider":"synthetic","tailscaleRoute":"pinned guest SSH adapter"})).unwrap());
    println!(
        "Preserved VM completion, reboot verification and replay passed; uninterrupted wizard still unverified."
    );
}

fn resume_prepare(f: &Fixture, merged: bool) {
    use std::os::unix::fs::FileTypeExt;
    require_idle_operator(f);
    vm::guard_guest(&f.target, &f.state_directory.join("vm-ssh"));
    assert!(
        vm::bounded(vm::ssh(
            &f.target,
            &f.state_directory.join("vm-ssh"),
            if merged {
                PRE_BOOTSTRAP_CHECK
            } else {
                PRE_PREPARATION_CHECK
            }
        ))
        .is_some(),
        "guest bootstrap state is not safely resumable"
    );
    let expected = if merged {
        validate_resume(f)
    } else {
        assert!(
            provisioning::approved_installation(
                &f.state_directory
                    .join(".homelab/profiles/default/provisioning"),
                "vm-test"
            )
            .unwrap()
            .is_none(),
            "approved setups use the existing resume/completion route"
        );
        f.target.revision.clone()
    };
    let main = api(
        f,
        "GET",
        &format!("repos/{}/commits/main", f.target.repository),
        None,
    );
    assert_eq!(main["sha"].as_str().unwrap(), expected);
    for name in ["vm-ssh", "vm-scp", "vm-tailnet", "gh", "vm-enrollment"] {
        install_adapter(
            &std::env::current_exe().unwrap(),
            &f.state_directory.join(name),
        );
    }
    let socket = f.state_directory.join("selected-agent.sock");
    if let Ok(metadata) = fs::symlink_metadata(&socket) {
        assert!(
            metadata.file_type().is_socket(),
            "unexpected selected-agent path"
        );
        fs::remove_file(socket).unwrap();
    }
    let status = Command::new(f.state_directory.join("vm-enrollment"))
        .arg(if merged { "--resume-drive" } else { "--drive" })
        .status()
        .unwrap();
    assert!(
        status.success(),
        "resume failed; preserve the existing attempt"
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
        manifest.hosts["vm-test"].authorized_keys.is_empty(),
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
    if let Some(status) = homelab_client::terminal_process::dispatch_bridge() {
        use std::process::Termination;
        std::process::exit(if status.report() == std::process::ExitCode::SUCCESS {
            0
        } else {
            1
        });
    }
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
        Some("--resume") => preserved_run(
            Path::new(
                &std::env::args_os()
                    .nth(2)
                    .expect("preserved fixture path required"),
            ),
            "--resume-prepare",
        ),
        Some("--complete") => preserved_run(
            Path::new(
                &std::env::args_os()
                    .nth(2)
                    .expect("preserved fixture path required"),
            ),
            "--complete-drive",
        ),
        Some("--complete-drive") => complete_preserved(&fixture(), true),
        Some("--finish-activated-drive") => complete_preserved(&fixture(), false),
        Some("--finish-activated") => preserved_run(
            Path::new(
                &std::env::args_os()
                    .nth(2)
                    .expect("preserved fixture path required"),
            ),
            "--finish-activated-drive",
        ),
        Some("--resume-prepare") => resume_prepare(&fixture(), true),
        Some("--retry-preparation-drive") => resume_prepare(&fixture(), false),
        Some("--retry-preparation") => preserved_run(
            Path::new(
                &std::env::args_os()
                    .nth(2)
                    .expect("preserved fixture path required"),
            ),
            "--retry-preparation-drive",
        ),
        Some("--resume-drive") => drive(&fixture(), true),
        Some("--drive") => drive(&fixture(), false),
        Some("--wizard-child") => wizard(&fixture()),
        _ => println!(
            "Full VM enrollment skipped. Explicit opt-in: vm_enrollment --run /absolute/private/fixture.json"
        ),
    }
}
