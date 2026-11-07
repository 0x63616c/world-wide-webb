use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
use rustix::io::{FdFlags, fcntl_setfd};
use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
use rustix::termios::{LocalModes, Winsize, tcgetattr, tcsetwinsize};

struct Terminal {
    master: File,
    slave: File,
    original_modes: LocalModes,
    child: Child,
}

impl Terminal {
    fn start(inventory: &Path) -> Self {
        Self::with_arguments(inventory, &[])
    }

    fn with_arguments(inventory: &Path, arguments: &[&str]) -> Self {
        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
        fcntl_setfd(&master, FdFlags::CLOEXEC).unwrap();
        grantpt(&master).unwrap();
        unlockpt(&master).unwrap();
        let name = ptsname(&master, Vec::new()).unwrap();
        let slave = File::from(
            open(
                &name,
                OFlags::RDWR | OFlags::NOCTTY | OFlags::CLOEXEC,
                Mode::empty(),
            )
            .unwrap(),
        );
        tcsetwinsize(
            &slave,
            Winsize {
                ws_row: 24,
                ws_col: 80,
                ws_xpixel: 0,
                ws_ypixel: 0,
            },
        )
        .unwrap();
        let original_modes = tcgetattr(&slave).unwrap().local_modes;
        let child = Command::new(env!("CARGO_BIN_EXE_homelab"))
            .arg("--inventory")
            .arg(inventory)
            .args(arguments)
            .env("TERM", "xterm-256color")
            .env("HOME", inventory.parent().unwrap().parent().unwrap())
            .env(
                "PATH",
                inventory.parent().unwrap().parent().unwrap().join("bin"),
            )
            .stdin(Stdio::from(slave.try_clone().unwrap()))
            .stdout(Stdio::from(slave.try_clone().unwrap()))
            .stderr(Stdio::from(slave.try_clone().unwrap()))
            .spawn()
            .unwrap();
        fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
        Self {
            master: File::from(master),
            slave,
            original_modes,
            child,
        }
    }

    fn until(&mut self, expected: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut output = Vec::new();
        loop {
            let mut buffer = [0; 4096];
            match self.master.read(&mut buffer) {
                Ok(count) => output.extend_from_slice(&buffer[..count]),
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                result => panic!("terminal read failed: {result:?}"),
            }
            if String::from_utf8_lossy(&output).contains(expected) {
                return String::from_utf8_lossy(&output).into_owned();
            }
            assert!(
                output.len() <= 256 * 1024,
                "terminal output exceeded fixture limit"
            );
            assert!(
                Instant::now() < deadline,
                "missing {expected:?}: {}",
                String::from_utf8_lossy(&output)
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn quit_and_verify_restoration(&mut self) {
        self.master.write_all(b"q").unwrap();
        self.wait_and_verify_restoration(true);
        self.until("\x1b[?1049l");
    }

    fn wait_and_verify_restoration(&mut self, success: bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert_eq!(status.success(), success);
                break;
            }
            assert!(Instant::now() < deadline, "menu did not exit");
            thread::sleep(Duration::from_millis(10));
        }
        // PENDIN is a kernel input-reprocessing flag, not a user terminal mode.
        assert_eq!(
            tcgetattr(&self.slave).unwrap().local_modes & !LocalModes::PENDIN,
            self.original_modes & !LocalModes::PENDIN
        );
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

struct Fixture {
    directory: tempfile::TempDir,
    inventory: std::path::PathBuf,
}
impl Fixture {
    fn new() -> Self {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::OnceLock;
        static BINARY: OnceLock<tempfile::TempDir> = OnceLock::new();
        let binary = BINARY.get_or_init(|| {
            let directory = tempfile::tempdir().unwrap();
            let source = directory.path().join("gh.rs");
            std::fs::write(&source, r#"
                use std::{env,fs,process};
                fn main() {
                    let root=env::current_exe().unwrap().parent().unwrap().parent().unwrap().to_owned();
                    let args:Vec<String>=env::args().skip(1).collect();
                    assert_eq!(&args[..3], ["api", "--hostname", "github.com"]);
                    assert!(args[3].starts_with("repos/example/config/"));
                    if args[3].ends_with("/commits/main") {
                        if root.join("main-unavailable").exists() { process::exit(1); }
                        println!("{}", "b".repeat(40));
                    } else if args[3].ends_with(&format!("?ref={}","a".repeat(40))) {
                        print!("{}",fs::read_to_string(root.join("approved.json")).unwrap());
                    } else {
                        assert!(args[3].ends_with(&format!("?ref={}","b".repeat(40))));
                        print!("{}",fs::read_to_string(root.join("main.json")).unwrap());
                    }
                }
            "#).unwrap();
            assert!(Command::new("rustc").arg("--edition=2024").arg(source).arg("-o").arg(directory.path().join("gh")).status().unwrap().success());
            directory
        });
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("bin")).unwrap();
        std::fs::copy(binary.path().join("gh"), directory.path().join("bin/gh")).unwrap();
        let parent = directory.path().join("private");
        std::fs::create_dir(&parent).unwrap();
        std::fs::set_permissions(&parent, std::fs::Permissions::from_mode(0o700)).unwrap();
        let inventory = parent.join("inventory.json");
        let result = Self {
            directory,
            inventory,
        };
        result.manifest("main.json", "build-mac", "admin");
        result
    }
    fn manifest(&self, file: &str, host: &str, user: &str) {
        std::fs::write(self.directory.path().join(file),serde_json::json!({"schema":1,"hosts":{host:{"adminUser":user,"adminUID":501,"authorizedKeys":[],"activationReady":false,"services":[]}},"tailscale":null}).to_string()).unwrap();
    }
    fn attach(&self) {
        use std::os::unix::fs::PermissionsExt;
        let path = self.inventory.with_file_name("repository.json");
        std::fs::write(&path, r#"{"schema":1,"repository":"example/config"}"#).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
    fn cache(&self) {
        homelab_client::inventory::add(
            &self.inventory,
            homelab_client::inventory::HostProfile {
                name: "legacy-alias".into(),
                address: "example.invalid".into(),
                user: "original-admin".into(),
                identity: None,
                configuration_host: Some("build-mac".into()),
            },
        )
        .unwrap();
    }
}

#[test]
fn first_run_attaches_git_then_cancels_address_without_creating_inventory() {
    let fixture = Fixture::new();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("Attach your configuration");
    terminal.master.write_all(b"example/config\r").unwrap();
    terminal.until("> build-mac");
    terminal.master.write_all(b"\r").unwrap();
    terminal.until("Connect to this Mac");
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.until("> build-mac");
    terminal.quit_and_verify_restoration();
    assert!(!fixture.inventory.exists());
    assert!(
        fixture
            .inventory
            .with_file_name("repository.json")
            .is_file()
    );
}

#[test]
fn changed_git_admin_requires_review_before_saving_or_ssh() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    let before = std::fs::read(&fixture.inventory).unwrap();
    let mut terminal =
        Terminal::with_arguments(&fixture.inventory, &["setup", "--host", "legacy-alias"]);
    terminal.until("Administrator changed in Git");
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.wait_and_verify_restoration(false);
    assert_eq!(std::fs::read(&fixture.inventory).unwrap(), before);
}

#[test]
fn approved_setup_is_listed_when_main_is_unavailable() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    fixture.manifest("approved.json", "build-mac", "original-admin");
    std::fs::write(fixture.directory.path().join("main-unavailable"), "").unwrap();
    homelab_client::provisioning::save_approved_installation(
        &fixture
            .directory
            .path()
            .join(".local/state/homelab/provisioning"),
        "example/config",
        "build-mac",
        &"a".repeat(40),
    )
    .unwrap();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("build-mac · Resume");
    terminal.quit_and_verify_restoration();
}

#[test]
fn address_only_form_keeps_actions_visible_at_minimum_size() {
    let fixture = Fixture::new();
    fixture.attach();
    let mut terminal =
        Terminal::with_arguments(&fixture.inventory, &["setup", "--host", "build-mac"]);
    terminal.until("Connect to this Mac");
    tcsetwinsize(
        &terminal.slave,
        Winsize {
            ws_row: 12,
            ws_col: 40,
            ws_xpixel: 0,
            ws_ypixel: 0,
        },
    )
    .unwrap();
    terminal.master.write_all(b"x").unwrap();
    let screen = terminal.until("Esc back");
    assert!(screen.contains("SSH address"));
    assert!(screen.contains("Enter: Connect"));
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.wait_and_verify_restoration(false);
    assert!(!fixture.inventory.exists());
}

#[test]
fn correcting_cached_address_preserves_identity_and_returns_without_ssh() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    let original = homelab_client::inventory::load(&fixture.inventory)
        .unwrap()
        .remove(0);
    let original = homelab_client::inventory::set_identity(
        &fixture.inventory,
        &original,
        Some(homelab_client::inventory::AgentIdentity {
            public_key: "ssh-ed25519 AAAA".into(),
            agent_socket: "/tmp/synthetic-agent.sock".into(),
        }),
    )
    .unwrap();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("e Edit address");
    terminal.master.write_all(b"e").unwrap();
    terminal.until("Edit SSH address");
    terminal
        .master
        .write_all(b"\x15corrected.invalid\r")
        .unwrap();
    terminal.until("> build-mac");
    terminal.quit_and_verify_restoration();
    let updated = homelab_client::inventory::load(&fixture.inventory)
        .unwrap()
        .remove(0);
    assert_eq!(updated.address, "corrected.invalid");
    assert_eq!(updated.identity, original.identity);
    assert_eq!(updated.name, original.name);
    assert_eq!(
        updated.user, original.user,
        "editing address must not approve Git admin change"
    );
    assert_eq!(updated.configuration_host, original.configuration_host);
}

#[test]
fn cancelling_cached_address_edit_preserves_bytes() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    let before = std::fs::read(&fixture.inventory).unwrap();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("e Edit address");
    terminal.master.write_all(b"e").unwrap();
    terminal.until("Edit SSH address");
    terminal
        .master
        .write_all(b"\x15changed.invalid\x1b")
        .unwrap();
    terminal.until("> build-mac");
    terminal.quit_and_verify_restoration();
    assert_eq!(std::fs::read(&fixture.inventory).unwrap(), before);
}

#[test]
fn a_local_only_profile_cannot_become_a_git_host_or_ssh_target() {
    let fixture = Fixture::new();
    fixture.attach();
    homelab_client::inventory::add(
        &fixture.inventory,
        homelab_client::inventory::HostProfile {
            name: "stale-local-only".into(),
            address: "example.invalid".into(),
            user: "admin".into(),
            identity: None,
            configuration_host: None,
        },
    )
    .unwrap();
    let before = std::fs::read(&fixture.inventory).unwrap();
    let mut terminal =
        Terminal::with_arguments(&fixture.inventory, &["setup", "--host", "stale-local-only"]);
    terminal.until("Choose a Git host or an unambiguous saved connection");
    terminal.wait_and_verify_restoration(false);
    assert_eq!(std::fs::read(&fixture.inventory).unwrap(), before);
}
