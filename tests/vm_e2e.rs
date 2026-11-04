//! Explicit opt-in guest test. Build with `cargo test --test vm_e2e --no-run` and
//! copy the resulting executable to the VM host; no Rust installation is needed there.
//! Running ordinary `cargo test` skips all host operations.
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::Ipv4Addr;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use homelab_client::{config, first_access, inventory, remote_setup, setup_wizard};
use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
use rustix::io::{FdFlags, fcntl_setfd};
use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
use rustix::termios::{Winsize, tcgetattr, tcsetwinsize};
use serde::{Deserialize, Serialize};

const CONFIG_ENV: &str = "HOMELAB_VM_FIXTURE";
const SYNTHETIC_TOKEN: &str = "vm-fixture-unused-github-token";
const LIMIT: usize = 256 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    repository: String,
    revision: String,
    manifest_path: PathBuf,
    configuration_host: String,
    guest_ip: Ipv4Addr,
    guest_hostname: String,
    physical_hostname: String,
    nonce: String,
    ssh_private_key: PathBuf,
    known_hosts: PathBuf,
    age_key: PathBuf,
    helper_path: PathBuf,
}

fn private_bytes(path: &Path, limit: u64) -> Vec<u8> {
    assert!(path.is_absolute(), "fixture paths must be absolute");
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .expect("cannot open fixture file"),
    );
    let metadata = file.metadata().unwrap();
    assert!(
        metadata.is_file()
            && metadata.uid() == rustix::process::geteuid().as_raw()
            && metadata.mode() & 0o077 == 0
            && metadata.len() <= limit,
        "fixture files must be private, owned, regular and bounded"
    );
    let mut bytes = Vec::new();
    file.take(limit + 1).read_to_end(&mut bytes).unwrap();
    assert!(bytes.len() <= limit as usize);
    bytes
}
fn load(path: &Path) -> Fixture {
    let fixture: Fixture = serde_json::from_slice(&private_bytes(path, 16 * 1024))
        .expect("invalid fixture configuration");
    assert!(
        config::valid_repository(&fixture.repository) && config::valid_revision(&fixture.revision)
    );
    assert!(config::valid_host(&fixture.configuration_host));
    assert!(
        fixture.guest_ip.is_private(),
        "guest must use a private NAT address"
    );
    assert!(
        !fixture.physical_hostname.is_empty()
            && fixture.guest_hostname != fixture.physical_hostname
    );
    assert!(
        fixture.nonce.len() == 64 && fixture.nonce.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "a fresh 256-bit fixture nonce is required"
    );
    fixture
}
fn manifest(fixture: &Fixture) -> config::Manifest {
    let manifest: config::Manifest =
        serde_json::from_slice(&private_bytes(&fixture.manifest_path, 64 * 1024))
            .expect("invalid fixture manifest");
    manifest.validate().unwrap();
    assert_eq!(
        manifest.hosts.len(),
        1,
        "fixture must describe only one guest"
    );
    let host = manifest
        .hosts
        .get(&fixture.configuration_host)
        .expect("fixture host missing");
    assert!(
        host.activation_ready && manifest.tailscale.is_none(),
        "VM fixture must be ready and must not enroll Tailscale"
    );
    manifest
}
fn write_private(path: &Path, bytes: &[u8]) {
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .unwrap();
    file.write_all(bytes).unwrap();
    file.sync_all().unwrap();
}
fn directory(path: &Path) {
    fs::create_dir_all(path).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

fn transport_args_allowed(
    arguments: &[std::ffi::OsString],
    ip: Ipv4Addr,
    user: &str,
    scp: bool,
) -> bool {
    let mut index = 0;
    let mut login = None;
    while let Some(argument) = arguments.get(index).and_then(|value| value.to_str()) {
        match argument {
            "--" => {
                index += 1;
                break;
            }
            "-T" | "-tt" if !scp => index += 1,
            "-s" | "-p" if scp => index += 1,
            "-l" if !scp => {
                if login.is_some() {
                    return false;
                }
                login = arguments.get(index + 1).and_then(|value| value.to_str());
                if login != Some(user) {
                    return false;
                }
                index += 2;
            }
            "-o" => {
                let Some(option) = arguments.get(index + 1).and_then(|value| value.to_str()) else {
                    return false;
                };
                let Some((name, _)) = option.split_once('=') else {
                    return false;
                };
                if ![
                    "BatchMode",
                    "StrictHostKeyChecking",
                    "ForwardAgent",
                    "ClearAllForwardings",
                    "ConnectTimeout",
                    "ServerAliveInterval",
                    "ServerAliveCountMax",
                    "ControlMaster",
                    "ControlPath",
                    "ControlPersist",
                    "PreferredAuthentications",
                    "PubkeyAuthentication",
                    "PasswordAuthentication",
                    "KbdInteractiveAuthentication",
                    "NumberOfPasswordPrompts",
                ]
                .contains(&name)
                {
                    return false;
                }
                index += 2;
            }
            value if value.starts_with('-') => return false,
            _ => break,
        }
    }
    let target = format!("{user}@{ip}");
    if scp {
        let files = &arguments[index..];
        files.len() >= 2
            && files[..files.len() - 1]
                .iter()
                .all(|file| Path::new(file).is_absolute())
            && files
                .last()
                .and_then(|value| value.to_str())
                .is_some_and(|value| {
                    value.starts_with(&format!("{target}:/private/tmp/homelab-setup."))
                })
    } else {
        let Some(destination) = arguments.get(index).and_then(|value| value.to_str()) else {
            return false;
        };
        destination == target || (login == Some(user) && destination == ip.to_string())
    }
}

fn transport_regressions() {
    let ip = Ipv4Addr::new(192, 168, 64, 7);
    let args = |values: &[&str]| {
        values
            .iter()
            .map(std::ffi::OsString::from)
            .collect::<Vec<_>>()
    };
    assert!(transport_args_allowed(
        &args(&[
            "-T",
            "-o",
            "BatchMode=yes",
            "-l",
            "operator",
            "192.168.64.7",
            "/bin/sh -s"
        ]),
        ip,
        "operator",
        false
    ));
    assert!(transport_args_allowed(
        &args(&[
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "NumberOfPasswordPrompts=3",
            "-o",
            "PreferredAuthentications=publickey",
            "--",
            "operator@192.168.64.7",
            "true",
        ]),
        ip,
        "operator",
        false
    ));
    assert!(!transport_args_allowed(
        &args(&["-l", "operator", "192.168.64.1", "true"]),
        ip,
        "operator",
        false
    ));
    assert!(!transport_args_allowed(
        &args(&["-l", "root", "192.168.64.7", "true"]),
        ip,
        "operator",
        false
    ));
    assert!(!transport_args_allowed(
        &args(&[
            "-o",
            "HostName=physical-host",
            "operator@192.168.64.7",
            "true"
        ]),
        ip,
        "operator",
        false
    ));
    assert!(transport_args_allowed(
        &args(&[
            "-s",
            "-p",
            "--",
            "/tmp/fixture",
            "operator@192.168.64.7:/private/tmp/homelab-setup.ABC12345/"
        ]),
        ip,
        "operator",
        true
    ));
    assert!(!transport_args_allowed(
        &args(&[
            "--",
            "another@192.168.64.1:/data",
            "operator@192.168.64.7:/private/tmp/homelab-setup.ABC12345/"
        ]),
        ip,
        "operator",
        true
    ));
}

// This adapter executable is the test runner itself, reached through fixture-only
// names. Production wizard options, scripts and SSH host-key checks remain intact.
fn transport(fixture: &Fixture, scp: bool) -> ! {
    let manifest = manifest(fixture);
    let user = &manifest.hosts[&fixture.configuration_host].admin_user;
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    assert!(
        transport_args_allowed(&arguments, fixture.guest_ip, user, scp),
        "transport may address only the pinned guest using expected options"
    );
    let mut command = Command::new(if scp { "/usr/bin/scp" } else { "/usr/bin/ssh" });
    command
        .args(["-F", "/dev/null", "-i"])
        .arg(&fixture.ssh_private_key)
        .arg("-o")
        .arg(format!(
            "UserKnownHostsFile={}",
            fixture.known_hosts.display()
        ))
        .args([
            "-o",
            "GlobalKnownHostsFile=/dev/null",
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "UpdateHostKeys=no",
            "-o",
            "IdentitiesOnly=yes",
            "-o",
            "IdentityAgent=none",
            "-o",
            "ForwardAgent=no",
            "-o",
            "ClearAllForwardings=yes",
            "-o",
            "ProxyCommand=none",
            "-o",
            "ProxyJump=none",
            "-o",
            "Port=22",
        ])
        .args(arguments);
    let _ = command.exec();
    panic!("cannot execute native SSH transport");
}
fn github_fixture(fixture: &Fixture) {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    assert!(arguments.starts_with(&["api".into(), "--hostname".into(), "github.com".into()]));
    let endpoint = arguments.get(3).expect("missing fixture API path");
    if endpoint == &format!("repos/{}/commits/main", fixture.repository) {
        println!("{}", fixture.revision);
    } else if endpoint
        == &format!(
            "repos/{}/contents/homelab.json?ref={}",
            fixture.repository, fixture.revision
        )
    {
        std::io::stdout()
            .write_all(&private_bytes(&fixture.manifest_path, 64 * 1024))
            .unwrap();
    } else {
        panic!("fixture gh refuses other API requests");
    }
}

fn bounded(mut command: Command) -> Option<String> {
    let mut output = tempfile::tempfile().unwrap();
    command
        .stdin(Stdio::null())
        .stdout(output.try_clone().unwrap())
        .stderr(Stdio::null());
    let mut child = command.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if let Some(status) = child.try_wait().ok()? {
            if !status.success() {
                return None;
            }
            output.seek(SeekFrom::Start(0)).unwrap();
            let mut text = String::new();
            output.take(16 * 1024 + 1).read_to_string(&mut text).ok()?;
            return (text.len() <= 16 * 1024).then_some(text);
        }
        if Instant::now() >= deadline || output.metadata().ok()?.len() > 16 * 1024 {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        thread::sleep(Duration::from_millis(50));
    }
}
fn ssh(fixture: &Fixture, adapter: &Path, remote: &str) -> Command {
    let manifest = manifest(fixture);
    let mut command = Command::new(adapter);
    command
        .args([
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=5",
            "-o",
            "ServerAliveInterval=5",
            "-o",
            "ServerAliveCountMax=2",
            "--",
        ])
        .arg(format!(
            "{}@{}",
            manifest.hosts[&fixture.configuration_host].admin_user, fixture.guest_ip
        ))
        .arg(remote);
    command
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct GuestMarker {
    nonce: String,
    hostname: String,
}
fn guard_guest(fixture: &Fixture, adapter: &Path) {
    let model = bounded(ssh(fixture, adapter, "/usr/sbin/sysctl -n hw.model"))
        .expect("guest hardware proof unavailable");
    assert!(
        model.trim().starts_with("VirtualMac"),
        "refusing a physical or unrecognized machine"
    );
    let hostname =
        bounded(ssh(fixture, adapter, "/bin/hostname")).expect("guest hostname unavailable");
    assert_eq!(
        hostname.trim(),
        fixture.guest_hostname,
        "guest identity changed"
    );
    assert_ne!(
        hostname.trim(),
        fixture.physical_hostname,
        "refusing physical VM host"
    );
    let marker = bounded(ssh(
        fixture,
        adapter,
        "/bin/cat /var/tmp/homelab-vm-e2e.json",
    ))
    .expect("guest fixture marker unavailable");
    let marker: GuestMarker = serde_json::from_str(&marker).expect("invalid guest fixture marker");
    assert_eq!(marker.nonce, fixture.nonce, "guest nonce mismatch");
    assert_eq!(
        marker.hostname, fixture.guest_hostname,
        "guest marker hostname mismatch"
    );
}
fn verify_activation(fixture: &Fixture, adapter: &Path) {
    guard_guest(fixture, adapter);
    let current = bounded(ssh(
        fixture,
        adapter,
        "/usr/bin/readlink /run/current-system",
    ))
    .expect("Nix activation missing");
    assert!(current.trim().starts_with("/nix/store/"));
    let result = bounded(ssh(fixture, adapter, "/bin/cat /etc/homelab-vm-e2e.json"))
        .expect("declared fixture result missing");
    let result: serde_json::Value =
        serde_json::from_str(&result).expect("invalid fixture activation result");
    assert_eq!(result["host"], fixture.configuration_host);
    assert_eq!(result["revision"], fixture.revision);
    let permissions = bounded(ssh(
        fixture,
        adapter,
        "/usr/bin/sudo -n /usr/bin/stat -f '%u %Lp' /var/lib/sops-nix /var/lib/sops-nix/key.txt",
    ))
    .expect("host identity permissions unavailable");
    assert_eq!(
        permissions.lines().collect::<Vec<_>>(),
        ["0 700", "0 600"],
        "host identity must remain root-only"
    );
    assert!(
        bounded(ssh(
            fixture,
            adapter,
            "/usr/bin/sudo -n /bin/launchctl print system/org.homelab.vm-e2e"
        ))
        .is_some(),
        "fixture launch daemon is not loaded"
    );
    let boot = bounded(ssh(fixture, adapter, "/usr/sbin/sysctl -n kern.boottime"))
        .expect("boot time unavailable");
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if bounded(ssh(
            fixture,
            adapter,
            "/usr/bin/sudo -n /bin/cat /var/tmp/homelab-vm-e2e-boot",
        ))
        .is_some_and(|marker| marker.trim() == boot.trim())
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "fixture launch daemon did not record this boot"
        );
        thread::sleep(Duration::from_secs(1));
    }
}

struct Pty {
    master: File,
    slave: File,
    original: rustix::termios::LocalModes,
    child: Child,
    output: String,
}
impl Pty {
    fn start(executable: &Path, config_path: &Path, home: &Path, bin: &Path) -> Self {
        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
        fcntl_setfd(&master, FdFlags::CLOEXEC).unwrap();
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
                ws_row: 40,
                ws_col: 100,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )
        .unwrap();
        let original = tcgetattr(&slave).unwrap().local_modes;
        let child = Command::new(executable)
            .arg("--wizard-child")
            .arg(config_path)
            .env_clear()
            .env(CONFIG_ENV, config_path)
            .env("HOME", home)
            .env(
                "PATH",
                format!("{}:/usr/bin:/bin:/usr/sbin:/sbin", bin.display()),
            )
            .env("TERM", "xterm-256color")
            .env("NO_COLOR", "1")
            .env_remove("SSH_AUTH_SOCK")
            .env_remove("GH_TOKEN")
            .env_remove("GITHUB_TOKEN")
            .env_remove("OP_SERVICE_ACCOUNT_TOKEN")
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave.try_clone().unwrap()))
            .spawn()
            .unwrap();
        fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
        Self {
            master: File::from(master),
            slave,
            original,
            child,
            output: String::new(),
        }
    }
    fn wait_for(&mut self, text: &str, timeout: Duration) {
        let deadline = Instant::now() + timeout;
        loop {
            let mut bytes = [0; 8192];
            match self.master.read(&mut bytes) {
                Ok(count) => self
                    .output
                    .push_str(&String::from_utf8_lossy(&bytes[..count])),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                _ => panic!("wizard terminal closed before expected stage"),
            }
            assert!(
                self.output.len() <= LIMIT,
                "wizard output exceeded fixture limit"
            );
            assert!(
                !self.output.contains(SYNTHETIC_TOKEN) && !self.output.contains("AGE-SECRET-KEY-"),
                "credential appeared in terminal output"
            );
            if self.output.contains(text) {
                self.output.clear();
                return;
            }
            assert!(
                Instant::now() < deadline,
                "wizard stage timed out: {text}; inspect the guest before retrying"
            );
            if self.child.try_wait().unwrap().is_some() {
                panic!("wizard exited before expected stage: {text}");
            }
            thread::sleep(Duration::from_millis(50));
        }
    }
    fn send(&mut self, bytes: &[u8]) {
        self.master.write_all(bytes).unwrap();
    }
    fn approve_review(&mut self, expected: &str) {
        self.wait_for(expected, Duration::from_secs(60));
        // Read every review row before the explicit approval key.
        for _ in 0..80 {
            self.send(b"\x1b[B");
        }
        self.send(b"\r");
    }
}
impl Drop for Pty {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn wizard_child(fixture: &Fixture) {
    let home = PathBuf::from(std::env::var_os("HOME").unwrap());
    let bin = home.join("bin");
    let path = home.join("inventory.json");
    guard_guest(fixture, &bin.join("vm-ssh"));
    let profile = inventory::load(&path).unwrap().remove(0);
    let tools = setup_wizard::WizardTools {
        first_access: first_access::Tools {
            ssh: bin.join("vm-ssh"),
            ssh_keygen: "/usr/bin/ssh-keygen".into(),
            ssh_add: "/usr/bin/ssh-add".into(),
        },
        remote_setup: remote_setup::Tools {
            ssh: bin.join("vm-ssh"),
            scp: bin.join("vm-scp"),
        },
    };
    let outcome = setup_wizard::launch_with_tools(&profile, &path, &tools).expect("wizard failed");
    assert!(
        outcome.completed
            && outcome
                .lines
                .iter()
                .any(|line| line.contains("configuration activated")),
        "wizard did not confirm activation"
    );
    assert_eq!(
        profile.configuration_host.as_deref(),
        Some(fixture.configuration_host.as_str())
    );
    println!("VM_WIZARD_ACTIVATED");
}

fn run(config_path: &Path) {
    let mut fixture = load(config_path);
    let mut local = Command::new("/bin/hostname");
    local.stdin(Stdio::null());
    assert_eq!(
        bounded(local).expect("local hostname unavailable").trim(),
        fixture.physical_hostname,
        "run only on the explicitly named VM host"
    );
    let key = private_bytes(&fixture.ssh_private_key, 64 * 1024);
    assert!(!key.is_empty());
    let known = String::from_utf8(private_bytes(&fixture.known_hosts, 16 * 1024)).unwrap();
    let lines: Vec<_> = known
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    assert_eq!(lines.len(), 1, "pin exactly one guest host key");
    assert_eq!(
        lines[0].split_whitespace().next(),
        Some(fixture.guest_ip.to_string().as_str())
    );
    let age = private_bytes(&fixture.age_key, 64 * 1024);
    let manifest = manifest(&fixture);
    let work = tempfile::tempdir().unwrap();
    let home = work.path();
    directory(home);
    let bin = home.join("bin");
    directory(&bin);
    // Freeze reviewed inputs before any target check or mutation. Editing the
    // original fixture cannot change the destination midway through a run.
    write_private(&home.join("ssh-key"), &key);
    write_private(&home.join("known-hosts"), known.as_bytes());
    write_private(&home.join("host.age"), &age);
    write_private(
        &home.join("manifest.json"),
        &serde_json::to_vec(&manifest).unwrap(),
    );
    fixture.ssh_private_key = home.join("ssh-key");
    fixture.known_hosts = home.join("known-hosts");
    fixture.age_key = home.join("host.age");
    fixture.manifest_path = home.join("manifest.json");
    let snapshot_path = home.join("fixture.json");
    write_private(&snapshot_path, &serde_json::to_vec(&fixture).unwrap());
    let config_path = snapshot_path.as_path();
    let executable = std::env::current_exe().unwrap();
    for name in ["vm-ssh", "vm-scp", "gh"] {
        fs::hard_link(&executable, bin.join(name)).unwrap();
    }
    // package::prepare resolves the helper beside the running wizard executable.
    let runner = home.join("vm-runner");
    fs::hard_link(&executable, &runner).unwrap();
    fs::copy(&fixture.helper_path, home.join("homelab-host")).unwrap();
    fs::set_permissions(home.join("homelab-host"), fs::Permissions::from_mode(0o700)).unwrap();
    let profile = inventory::HostProfile {
        name: "vm-fixture".into(),
        address: fixture.guest_ip.to_string(),
        user: manifest.hosts[&fixture.configuration_host]
            .admin_user
            .clone(),
        identity: None,
        configuration_host: Some(fixture.configuration_host.clone()),
    };
    inventory::add(&home.join("inventory.json"), profile).unwrap();
    let binding =
        serde_json::to_vec(&serde_json::json!({"schema":1,"repository":fixture.repository}))
            .unwrap();
    write_private(&home.join("repository.json"), &binding);
    let state = home.join(".local/state/homelab/provisioning");
    directory(&state);
    homelab_client::provisioning::bind_repository(&state, &fixture.repository).unwrap();
    let host = state.join("hosts").join(&fixture.configuration_host);
    directory(&host);
    write_private(&host.join("host-age-key.txt"), &age);
    write_private(&host.join("github-read-token"), SYNTHETIC_TOKEN.as_bytes());
    let adapter = bin.join("vm-ssh");
    // The adapter reads only this explicit fixture. No ambient SSH state is used.
    let guarded_ssh = |remote: &str| {
        let mut c = ssh(&fixture, &adapter, remote);
        c.env_clear()
            .env(CONFIG_ENV, config_path)
            .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin");
        c
    };
    // Use a separate runner child for guards so environment cannot leak into parallel tests.
    let mut guard = Command::new(&runner);
    guard
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .args(["--guard"])
        .arg(config_path)
        .env(CONFIG_ENV, config_path)
        .env("HOMELAB_VM_ADAPTER", &adapter);
    assert!(
        guard.status().unwrap().success(),
        "guest guard rejected the target"
    );
    assert!(
        bounded(guarded_ssh("/usr/bin/sudo -n /usr/bin/true")).is_some(),
        "guest fixture must allow noninteractive sudo"
    );
    let boot = bounded(guarded_ssh("/usr/sbin/sysctl -n kern.boottime")).unwrap();
    let mut terminal = Pty::start(&runner, config_path, home, &bin);
    terminal.wait_for("SSH access verified", Duration::from_secs(60));
    terminal.send(b"\x1b[B\r");
    terminal.approve_review("Review private configuration");
    terminal.wait_for("Setup attempt", Duration::from_secs(60));
    terminal.send(b"\r");
    terminal.approve_review("Continue to approval");
    terminal.wait_for("Approve setup", Duration::from_secs(60));
    terminal.send(format!("{}\r", fixture.configuration_host).as_bytes());
    terminal.wait_for("VM_WIZARD_ACTIVATED", Duration::from_secs(90 * 60));
    assert!(terminal.child.wait().unwrap().success());
    assert_eq!(
        tcgetattr(&terminal.slave).unwrap().local_modes,
        terminal.original
    );
    let mut verify = Command::new(&runner);
    verify
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .arg("--verify")
        .arg(config_path)
        .env(CONFIG_ENV, config_path)
        .env("HOMELAB_VM_ADAPTER", &adapter);
    assert!(
        verify.status().unwrap().success(),
        "activation verification failed"
    );
    println!("VM bootstrap verified; requesting guest-only reboot.");
    let _ = bounded(guarded_ssh("/usr/bin/sudo -n /sbin/shutdown -r now"));
    let deadline = Instant::now() + Duration::from_secs(600);
    loop {
        if let Some(after) = bounded(guarded_ssh("/usr/sbin/sysctl -n kern.boottime"))
            && after != boot
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "guest reboot was not confirmed; inspect the VM"
        );
        thread::sleep(Duration::from_secs(3));
    }
    assert!(
        verify.status().unwrap().success(),
        "post-reboot fixture verification failed"
    );
    println!(
        "VM e2e passed: guided activation and guest reboot verified. VM preserved for inspection."
    );
}

fn main() {
    transport_regressions();
    let arguments: Vec<_> = std::env::args_os().collect();
    let name = Path::new(&arguments[0])
        .file_name()
        .unwrap()
        .to_string_lossy();
    if matches!(name.as_ref(), "vm-ssh" | "vm-scp" | "gh") {
        let fixture = load(Path::new(
            &std::env::var_os(CONFIG_ENV).expect("explicit fixture required"),
        ));
        if name == "gh" {
            github_fixture(&fixture);
        } else {
            transport(&fixture, name == "vm-scp");
        }
        return;
    }
    let mode = arguments
        .get(1)
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !matches!(mode, "--run" | "--wizard-child" | "--guard" | "--verify") {
        println!("VM e2e skipped. Explicit opt-in: vm_e2e --run /absolute/private/fixture.json");
        return;
    }
    let path = Path::new(
        arguments
            .get(2)
            .expect("explicit fixture configuration required"),
    );
    let fixture = load(path);
    match mode {
        "--run" => run(path),
        "--wizard-child" => wizard_child(&fixture),
        "--guard" => guard_guest(
            &fixture,
            Path::new(&std::env::var_os("HOMELAB_VM_ADAPTER").unwrap()),
        ),
        "--verify" => verify_activation(
            &fixture,
            Path::new(&std::env::var_os("HOMELAB_VM_ADAPTER").unwrap()),
        ),
        _ => unreachable!(),
    }
}
