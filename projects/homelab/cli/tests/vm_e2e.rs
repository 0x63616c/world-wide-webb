//! Explicit opt-in guest test. Build with `cargo test --test vm_e2e --no-run` and
//! copy the resulting executable to the VM host; no Rust installation is needed there.
//! Running ordinary `cargo test` skips all host operations.
//!
//! Current real-VM coverage: `vm_e2e --complete /absolute/private/fixture.json`
//! on the named physical VM host, after an authentic synthetic bootstrap has
//! created its reservation and activation hold. The guest must offer its declared
//! synthetic Tailscale identity at 100.64.0.1; vm-tailnet maps that address solely
//! to the pinned guest SSH route. This tests completion/reboot/Comin, not Tailscale
//! networking or provider-backed enrollment. Provider contracts run separately.
//! No receipt, hold or deployment status is fabricated by this harness.
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom, Write};
use std::net::Ipv4Addr;
use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use homelab_client::{config, inventory};
use rustix::fs::{Mode, OFlags, open};
use serde::{Deserialize, Serialize};

const CONFIG_ENV: &str = "HOMELAB_VM_FIXTURE";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Fixture {
    pub(crate) repository: String,
    pub(crate) revision: String,
    pub(crate) manifest_path: PathBuf,
    pub(crate) configuration_host: String,
    pub(crate) guest_ip: Ipv4Addr,
    pub(crate) guest_hostname: String,
    pub(crate) physical_hostname: String,
    pub(crate) nonce: String,
    pub(crate) ssh_private_key: PathBuf,
    pub(crate) known_hosts: PathBuf,
    pub(crate) age_key: PathBuf,
    pub(crate) helper_path: PathBuf,
}

pub(crate) fn private_bytes(path: &Path, limit: u64) -> Vec<u8> {
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
pub(crate) fn load(path: &Path) -> Fixture {
    let fixture: Fixture = serde_json::from_slice(&private_bytes(path, 16 * 1024))
        .expect("invalid fixture configuration");
    validate_fixture(&fixture);
    fixture
}
pub(crate) fn validate_fixture(fixture: &Fixture) {
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
}

pub(crate) fn manifest(fixture: &Fixture) -> config::Manifest {
    let manifest: config::Manifest =
        serde_json::from_slice(&private_bytes(&fixture.manifest_path, 64 * 1024))
            .expect("invalid fixture manifest");
    manifest.validate().unwrap();
    assert_eq!(
        manifest.hosts.len(),
        1,
        "fixture must describe only one guest"
    );
    assert!(
        fixture.configuration_host == "vm-test" && valid_fixture_manifest(&manifest),
        "VM fixture requires only vm-test/admin501, no services and synthetic tag:vm-test"
    );
    manifest
}
fn valid_fixture_manifest(manifest: &config::Manifest) -> bool {
    manifest.hosts.len() == 1
        && manifest
            .one_password
            .as_ref()
            .is_none_or(|settings| settings.backup_vault == "aaaaaaaaaaaaaaaaaaaaaaaaaa")
        && manifest.hosts.get("vm-test").is_some_and(|host| {
            host.admin_user == "admin" && host.admin_uid == 501 && host.services.is_empty()
        })
        && manifest.tailscale.as_ref().is_some_and(|tailscale| {
            tailscale.tag == "tag:vm-test"
                && tailscale.oauth.as_ref().is_none_or(|reference| {
                    reference.vault == "aaaaaaaaaaaaaaaaaaaaaaaaaa"
                        && reference.item == "dddddddddddddddddddddddddd"
                })
        })
}

pub(crate) fn manifest_guard_regressions() {
    let mut manifest: config::Manifest = serde_json::from_value(serde_json::json!({
        "schema":1,"hosts":{"vm-test":{"adminUser":"admin","adminUID":501,
        "authorizedKeys":[],"activationReady":false,"services":[]}},"tailscale":{"tag":"tag:vm-test"}
    })).unwrap();
    assert!(valid_fixture_manifest(&manifest));
    manifest.schema = 2;
    manifest.one_password = Some(config::OnePasswordConfig {
        backup_vault: "aaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
    });
    assert!(valid_fixture_manifest(&manifest));
    manifest.one_password.as_mut().unwrap().backup_vault = "production".into();
    assert!(!valid_fixture_manifest(&manifest));
    manifest.schema = 1;
    manifest.one_password = None;
    manifest
        .hosts
        .get_mut("vm-test")
        .unwrap()
        .authorized_keys
        .push("ssh-ed25519 synthetic".into());
    assert!(valid_fixture_manifest(&manifest));
    manifest.tailscale.as_mut().unwrap().oauth = Some(config::OAuthReference {
        vault: "aaaaaaaaaaaaaaaaaaaaaaaaaa".into(),
        item: "dddddddddddddddddddddddddd".into(),
    });
    assert!(valid_fixture_manifest(&manifest));
    manifest
        .tailscale
        .as_mut()
        .unwrap()
        .oauth
        .as_mut()
        .unwrap()
        .item = "production".into();
    assert!(!valid_fixture_manifest(&manifest));
    manifest.tailscale.as_mut().unwrap().oauth = None;
    manifest.tailscale.as_mut().unwrap().tag = "tag:production".into();
    assert!(!valid_fixture_manifest(&manifest));
    manifest.tailscale = None;
    assert!(!valid_fixture_manifest(&manifest));
}

pub(crate) fn write_private(path: &Path, bytes: &[u8]) {
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
pub(crate) fn directory(path: &Path) {
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
                if name == "HostKeyAlias" {
                    if option != format!("HostKeyAlias={ip}") {
                        return false;
                    }
                    index += 2;
                    continue;
                }
                if [
                    "HostKeyAlgorithms=ssh-ed25519",
                    "GlobalKnownHostsFile=/dev/null",
                    "UpdateHostKeys=no",
                ]
                .contains(&option)
                {
                    index += 2;
                    continue;
                }
                if let Some(path) = option.strip_prefix("UserKnownHostsFile=") {
                    if !Path::new(path).is_absolute() || path.contains(['\n', '\r']) {
                        return false;
                    }
                    index += 2;
                    continue;
                }
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
    for alias in ["192.168.64.8", "arbitrary-host", "/tmp/key"] {
        assert!(!transport_args_allowed(
            &args(&[
                "-o",
                &format!("HostKeyAlias={alias}"),
                "-l",
                "operator",
                "192.168.64.7",
                "true"
            ]),
            ip,
            "operator",
            false
        ));
    }
    assert!(transport_args_allowed(
        &args(&[
            "-o",
            "HostKeyAlias=192.168.64.7",
            "-l",
            "operator",
            "192.168.64.7",
            "true"
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
    transport_with_arguments(fixture, scp, std::env::args_os().skip(1).collect())
}

pub(crate) fn transport_with_arguments(
    fixture: &Fixture,
    scp: bool,
    arguments: Vec<std::ffi::OsString>,
) -> ! {
    transport_with_jump(fixture, scp, arguments, None)
}

pub(crate) fn transport_with_jump(
    fixture: &Fixture,
    scp: bool,
    arguments: Vec<std::ffi::OsString>,
    jump_config: Option<(&Path, &str)>,
) -> ! {
    let manifest = manifest(fixture);
    let user = &manifest.hosts[&fixture.configuration_host].admin_user;
    assert!(
        transport_args_allowed(&arguments, fixture.guest_ip, user, scp),
        "transport may address only the pinned guest using expected options"
    );
    let mut command = Command::new(if scp { "/usr/bin/scp" } else { "/usr/bin/ssh" });
    command.arg("-F").arg(
        jump_config
            .map(|(path, _)| path)
            .unwrap_or(Path::new("/dev/null")),
    );
    if let Some((_, host)) = jump_config {
        command.arg("-J").arg(format!("admin@{host}"));
    }
    command
        .arg("-i")
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
            "Port=22",
        ]);
    if jump_config.is_none() {
        command.args(["-o", "ProxyCommand=none", "-o", "ProxyJump=none"]);
    }
    command.args(arguments);
    let _ = command.exec();
    panic!("cannot execute native SSH transport");
}
// A synthetic route adapter exercises completion sequencing, not Tailscale's
// network or ACLs. It can only reach the same already pinned disposable guest.
pub(crate) fn synthetic_tailnet(fixture: &Fixture) -> ! {
    let user = manifest(fixture).hosts[&fixture.configuration_host]
        .admin_user
        .clone();
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    assert_eq!(args.first().and_then(|arg| arg.to_str()), Some("ssh"));
    assert_eq!(
        args.get(1).and_then(|arg| arg.to_str()),
        Some(format!("{user}@100.64.0.1").as_str())
    );
    let mut forwarded = Vec::new();
    let mut index = 2;
    while index + 1 < args.len() {
        if args[index] == "-F" {
            assert_eq!(
                args.get(index + 1).and_then(|arg| arg.to_str()),
                Some("/dev/null")
            );
            index += 2;
        } else {
            forwarded.push(args[index].clone());
            index += 1;
        }
    }
    forwarded.extend([
        "-l".into(),
        user.into(),
        fixture.guest_ip.to_string().into(),
    ]);
    forwarded.push(args.last().expect("remote command required").clone());
    transport_with_arguments(fixture, false, forwarded)
}

pub(crate) fn bounded(mut command: Command) -> Option<String> {
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
pub(crate) fn ssh(fixture: &Fixture, adapter: &Path, remote: &str) -> Command {
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
pub(crate) fn guard_guest(fixture: &Fixture, adapter: &Path) {
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
pub(crate) fn verify_activation(fixture: &Fixture, adapter: &Path) {
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

/// Resume real completion on an already activated synthetic guest. Provider
/// preparation is covered separately; this does not claim a full enrollment run.
fn complete(config_path: &Path) {
    let mut fixture = load(config_path);
    let mut hostname = Command::new("/bin/hostname");
    hostname.stdin(Stdio::null());
    assert_eq!(bounded(hostname).unwrap().trim(), fixture.physical_hostname);
    let work = tempfile::tempdir().unwrap();
    directory(work.path());
    for (name, source) in [
        ("ssh-key", &fixture.ssh_private_key),
        ("known-hosts", &fixture.known_hosts),
        ("manifest.json", &fixture.manifest_path),
    ] {
        write_private(&work.path().join(name), &private_bytes(source, 64 * 1024));
    }
    fixture.ssh_private_key = work.path().join("ssh-key");
    fixture.known_hosts = work.path().join("known-hosts");
    fixture.manifest_path = work.path().join("manifest.json");
    let known = fs::read_to_string(&fixture.known_hosts).unwrap();
    let entries: Vec<_> = known
        .lines()
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .collect();
    assert_eq!(entries.len(), 1, "pin exactly one guest host key");
    assert_eq!(
        entries[0].split_whitespace().next(),
        Some(fixture.guest_ip.to_string().as_str())
    );
    let snapshot = work.path().join("fixture.json");
    write_private(&snapshot, &serde_json::to_vec(&fixture).unwrap());
    let executable = std::env::current_exe().unwrap();
    for name in ["vm-ssh", "vm-tailnet"] {
        fs::hard_link(&executable, work.path().join(name)).unwrap();
    }
    let status = Command::new(executable)
        .arg("--completion-child")
        .arg(&snapshot)
        .env_clear()
        .env(CONFIG_ENV, &snapshot)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .status()
        .unwrap();
    assert!(
        status.success(),
        "VM completion failed; preserve and resume the same attempt"
    );
}

fn completion_child(fixture: &Fixture, config_path: &Path) {
    let root = config_path.parent().unwrap();
    let adapter = root.join("vm-ssh");
    guard_guest(fixture, &adapter);
    let manifest = manifest(fixture);
    let host = &manifest.hosts[&fixture.configuration_host];
    let profile = inventory::HostProfile {
        name: "vm-fixture".into(),
        address: fixture.guest_ip.to_string(),
        user: host.admin_user.clone(),
        identity: None,
        configuration_host: Some(fixture.configuration_host.clone()),
    };
    let tag = &manifest
        .tailscale
        .as_ref()
        .expect("synthetic fixture requires Tailscale metadata")
        .tag;
    let selection = || homelab_client::remote_completion::Installation {
        branch: "main",
        repository: &fixture.repository,
        host: &fixture.configuration_host,
        revision: &fixture.revision,
        tag,
    };
    let report = homelab_client::remote_completion::finish_with_tools(
        &profile,
        &adapter,
        &root.join("vm-tailnet"),
        selection(),
        |message| println!("{message}"),
    )
    .expect("real guest completion was not confirmed");
    assert!(report.completed && report.rebooted);
    assert!(
        report
            .reconciled_revision
            .as_deref()
            .is_some_and(config::valid_revision)
    );
    let boot = bounded(ssh(
        fixture,
        &adapter,
        "/usr/sbin/sysctl -n kern.bootsessionuuid",
    ))
    .unwrap();
    // Completed resume must remain read-only with respect to reboot.
    homelab_client::remote_completion::finish_with_tools(
        &profile,
        &adapter,
        &root.join("vm-tailnet"),
        selection(),
        |_| {},
    )
    .expect("completed guest could not be resumed");
    assert_eq!(
        bounded(ssh(
            fixture,
            &adapter,
            "/usr/sbin/sysctl -n kern.bootsessionuuid"
        ))
        .unwrap(),
        boot
    );
    verify_activation(fixture, &adapter);
    println!(
        "VM completion passed: real guest reboot, receipt and Git reconciliation; synthetic Tailscale transport only. Provider preparation and full PR enrollment are separate tests."
    );
}

fn main() {
    manifest_guard_regressions();
    transport_regressions();
    let arguments: Vec<_> = std::env::args_os().collect();
    let name = Path::new(&arguments[0])
        .file_name()
        .unwrap()
        .to_string_lossy();
    if matches!(name.as_ref(), "vm-ssh" | "vm-scp" | "vm-tailnet") {
        let fixture = load(Path::new(
            &std::env::var_os(CONFIG_ENV).expect("explicit fixture required"),
        ));
        if name == "vm-tailnet" {
            synthetic_tailnet(&fixture);
        } else {
            transport(&fixture, name == "vm-scp");
        }
    }
    let mode = arguments
        .get(1)
        .and_then(|value| value.to_str())
        .unwrap_or("");
    if !matches!(
        mode,
        "--run" | "--complete" | "--completion-child" | "--guard" | "--verify"
    ) {
        println!(
            "VM e2e skipped. Explicit opt-in: vm_e2e --complete /absolute/private/fixture.json"
        );
        return;
    }
    if mode == "--run" {
        eprintln!(
            "The old manual-token VM journey is obsolete. Use --complete for an already activated synthetic fixture; automated provider/PR enrollment requires coherent published Git fixtures."
        );
        std::process::exit(2);
    }
    let path = Path::new(
        arguments
            .get(2)
            .expect("explicit fixture configuration required"),
    );
    let fixture = load(path);
    match mode {
        "--complete" => complete(path),
        "--completion-child" => completion_child(&fixture, path),
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
