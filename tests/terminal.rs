use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use rustix::fs::{Mode, OFlags, fcntl_setfl, open};
use rustix::io::{FdFlags, fcntl_setfd};
use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
use rustix::termios::{LocalModes, Winsize, tcgetattr, tcgetwinsize, tcsetwinsize};

struct Terminal {
    master: File,
    slave: File,
    original_modes: LocalModes,
    child: Child,
    transcript: Vec<u8>,
    parser: vt100::Parser,
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
        let mut command = Command::new(env!("CARGO_BIN_EXE_homelab"));
        if !arguments.contains(&"--profile") {
            command.arg("--inventory").arg(inventory);
        }
        let child = command
            .args(arguments)
            .env("TERM", "xterm-256color")
            .env("HOMELAB_NO_UPDATE_CHECK", "1")
            .env("HOMELAB_NO_STATUS_CHECK", "1")
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
            transcript: Vec::new(),
            parser: vt100::Parser::new(24, 80, 0),
        }
    }

    fn until(&mut self, expected: &str) -> String {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut output = Vec::new();
        loop {
            let mut buffer = [0; 4096];
            match self.master.read(&mut buffer) {
                Ok(count) => {
                    output.extend_from_slice(&buffer[..count]);
                    self.transcript.extend_from_slice(&buffer[..count]);
                    let size = tcgetwinsize(&self.slave).unwrap();
                    self.parser.set_size(size.ws_row, size.ws_col);
                    self.parser.process(&buffer[..count]);
                }
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {}
                result => panic!("terminal read failed: {result:?}"),
            }
            let screen = self.parser.screen().contents();
            if !output.is_empty()
                && (screen.contains(expected)
                    || String::from_utf8_lossy(&output).contains(expected))
            {
                return screen;
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

    fn continue_configuration(&mut self) {
        let screen = self.until("Configuration loaded");
        assert!(screen.contains("Opening homelab"));
        assert!(!self.parser.screen().contents().contains("> build-mac"));
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
                        if root.join("slow-main").exists() { std::thread::sleep(std::time::Duration::from_millis(350)); }
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
        std::fs::write(self.directory.path().join(file),serde_json::json!({"schema":1,"hosts":{host:{"adminUser":user,"adminUID":501,"authorizedKeys":[],"services":[]}},"tailscale":null}).to_string()).unwrap();
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
fn first_run_attaches_git_and_derives_address_without_a_prompt() {
    let fixture = Fixture::new();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("Which repo do you want to use?");
    terminal.master.write_all(b"example/config\r").unwrap();
    terminal.continue_configuration();
    terminal.until("> build-mac");
    // A changed manifest stops before SSH while exercising automatic connection saving.
    fixture.manifest("main.json", "build-mac", "changed-admin");
    terminal.master.write_all(b"\r").unwrap();
    terminal.until("administrator differs from this saved connection");
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.continue_configuration();
    terminal.until("> build-mac");
    terminal.quit_and_verify_restoration();
    let profile = homelab_client::inventory::load(&fixture.inventory)
        .unwrap()
        .remove(0);
    assert_eq!(profile.address, "build-mac.local");
    assert_eq!(profile.user, "admin");
    assert!(!String::from_utf8_lossy(&terminal.transcript).contains("SSH address"));
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
    terminal.until("Using saved setup; GitHub is unavailable.");
    terminal.master.write_all(b"\r").unwrap();
    terminal.until("Resume");
    terminal.quit_and_verify_restoration();
}

#[test]
fn host_menu_keeps_actions_visible_at_minimum_size() {
    let fixture = Fixture::new();
    fixture.attach();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.continue_configuration();
    terminal.until("> build-mac");
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
    terminal.master.write_all(b"\x1b[B").unwrap();
    let screen = terminal.until("Enter Select");
    assert!(screen.contains("build-mac"));
    assert!(!screen.contains("Edit address"));
    terminal.quit_and_verify_restoration();
    assert!(!fixture.inventory.exists());
}

#[test]
fn removed_edit_shortcut_cannot_change_cached_routes() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    let before = std::fs::read(&fixture.inventory).unwrap();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.continue_configuration();
    let screen = terminal.until("> build-mac");
    assert!(!screen.contains("Edit address"));
    terminal.master.write_all(b"e?").unwrap();
    terminal.until("Documentation and source");
    terminal.master.write_all(b"\x1b").unwrap();
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

#[test]
fn internal_menu_wizard_and_result_transitions_keep_one_alternate_screen() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    fixture.manifest("main.json", "build-mac", "original-admin");
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.continue_configuration();
    terminal.until("> build-mac");
    // A changed Git login stops the wizard before any SSH command. This exercises
    // the actual menu → wizard → outcome → menu path without a live host.
    fixture.manifest("main.json", "build-mac", "changed-admin");
    terminal.master.write_all(b"\r").unwrap();
    terminal.until("administrator differs from this saved connection");
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.continue_configuration();
    terminal.until("> build-mac");
    let screen = String::from_utf8_lossy(&terminal.transcript);
    assert_eq!(screen.matches("\x1b[?1049h").count(), 1);
    assert_eq!(screen.matches("\x1b[?1049l").count(), 0);
    terminal.quit_and_verify_restoration();
    let screen = String::from_utf8_lossy(&terminal.transcript);
    assert_eq!(screen.matches("\x1b[?1049l").count(), 1);
}

#[test]
fn fresh_profile_starts_at_repository_prompt_and_remembers_only_its_own_choice() {
    let fixture = Fixture::new();
    fixture.attach();
    fixture.cache();
    let original = std::fs::read(&fixture.inventory).unwrap();
    let binding = fixture.inventory.with_file_name("repository.json");
    let original_binding = std::fs::read(&binding).unwrap();
    let mut fresh = Terminal::with_arguments(&fixture.inventory, &["--profile", "demo"]);
    let screen = fresh.until("Which repo do you want to use?");
    assert!(screen.contains("homelab (demo)"));
    fresh
        .master
        .write_all(b"https://github.com/example/config.git\r")
        .unwrap();
    fresh.continue_configuration();
    fresh.until("> build-mac");
    fresh.quit_and_verify_restoration();
    assert!(
        String::from_utf8_lossy(&fresh.transcript)
            .contains("\x1b]8;;https://github.com/example/config\x1b\\")
    );
    assert_eq!(std::fs::read(&fixture.inventory).unwrap(), original);
    assert_eq!(std::fs::read(&binding).unwrap(), original_binding);
    let home = fixture.inventory.parent().unwrap().parent().unwrap();
    assert!(home.join(".homelab/profiles/demo/repository.json").exists());
    let mut resumed = Terminal::with_arguments(&fixture.inventory, &["--profile", "demo"]);
    resumed.continue_configuration();
    resumed.until("> build-mac");
    resumed.quit_and_verify_restoration();
    let mut other = Terminal::with_arguments(&fixture.inventory, &["--profile", "another"]);
    other.until("Which repo do you want to use?");
    other.master.write_all(b"\x1b").unwrap();
    other.wait_and_verify_restoration(true);
}

#[test]
fn ctrl_c_requires_confirmation_and_another_key_cancels_it() {
    let fixture = Fixture::new();
    fixture.attach();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.continue_configuration();
    terminal.until("> build-mac");
    terminal.master.write_all(b"\x03").unwrap();
    terminal.until("Press Ctrl-C again to quit");
    assert!(terminal.child.try_wait().unwrap().is_none());
    terminal.master.write_all(b"x").unwrap();
    terminal.until("Details");
    assert!(terminal.child.try_wait().unwrap().is_none());
    terminal.master.write_all(b"\x03").unwrap();
    terminal.until("Press Ctrl-C again to quit");
    terminal.master.write_all(b"\x03").unwrap();
    terminal.wait_and_verify_restoration(true);
}

#[test]
fn ctrl_c_confirmation_also_exits_fresh_repository_entry() {
    let fixture = Fixture::new();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("Which repo do you want to use?");
    terminal.master.write_all(b"\x03").unwrap();
    terminal.until("Press Ctrl-C again to quit");
    terminal.master.write_all(b"\x03").unwrap();
    terminal.wait_and_verify_restoration(true);
    assert!(!fixture.inventory.with_file_name("repository.json").exists());
}

#[test]
fn loading_animates_before_the_host_list_arrives() {
    let fixture = Fixture::new();
    fixture.attach();
    std::fs::write(fixture.directory.path().join("slow-main"), "").unwrap();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("Reading configuration");
    terminal.continue_configuration();
    terminal.until("> build-mac");
    let output = String::from_utf8_lossy(&terminal.transcript);
    let frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    assert!(
        frames
            .iter()
            .filter(|frame| output.contains(**frame))
            .count()
            >= 2
    );
    terminal.quit_and_verify_restoration();
}

#[test]
fn configuration_loaded_advances_after_one_second_without_enter() {
    let fixture = Fixture::new();
    fixture.attach();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.until("Configuration loaded");
    let loaded = Instant::now();
    terminal.until("> build-mac");
    assert!(loaded.elapsed() >= Duration::from_millis(800));
    terminal.quit_and_verify_restoration();
}

#[test]
fn success_preview_celebrates_and_enter_finishes_without_back() {
    let fixture = Fixture::new();
    let mut terminal =
        Terminal::with_arguments(&fixture.inventory, &["preview", "--screen", "complete"]);
    let screen = terminal.until("studio-mac is set up!");
    assert!(screen.contains("Press Enter to finish"));
    assert!(screen.contains("Configuration: #a1b2c3d4"));
    assert!(!screen.contains("Esc Back"));
    assert!(!screen.contains("/commit/"));
    assert!(!screen.contains("✓ studio-mac is set up!"));
    terminal.until("\x1b]8;;https://github.com/example/homelab/commit/a1b2c3d4");
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
    let compact = terminal.until("Configuration: #a1b2c3d4");
    assert!(compact.contains("Tailscale:") || compact.contains("Navigation"));
    terminal.master.write_all(b"\x1b").unwrap();
    thread::sleep(Duration::from_millis(100));
    assert!(terminal.child.try_wait().unwrap().is_none());
    terminal.master.write_all(b"\r").unwrap();
    terminal.wait_and_verify_restoration(true);
}

#[test]
fn mac_details_are_read_only_and_escape_returns_to_the_host_list() {
    let fixture = Fixture::new();
    fixture.attach();
    let mut terminal = Terminal::start(&fixture.inventory);
    terminal.continue_configuration();
    terminal.until("> build-mac");
    terminal.master.write_all(b"i").unwrap();
    let screen = terminal.until("About build-mac");
    assert!(screen.contains("admin@build-mac.local"));
    assert!(screen.contains("Configuration: build-mac"));
    assert!(!screen.contains("Enter Back"));
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.until("> build-mac");
    terminal.quit_and_verify_restoration();
    assert!(!fixture.inventory.exists());
}
