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
        assert_eq!(
            tcgetattr(&self.slave).unwrap().local_modes,
            self.original_modes
        );
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn first_run_add_quit_and_reopen_restore_the_terminal() {
    let directory = tempfile::tempdir().unwrap();
    let inventory = directory.path().join("private/inventory.json");
    let mut terminal = Terminal::start(&inventory);
    terminal.until("No hosts yet");
    terminal.master.write_all(b"n").unwrap();
    terminal.until("Add a host connection");
    terminal
        .master
        .write_all(b"example\rexample.invalid\roperator\r\r")
        .unwrap();
    terminal.until("Connection profile saved locally");
    terminal.quit_and_verify_restoration();
    drop(terminal);

    let hosts = homelab_client::inventory::load(&inventory).unwrap();
    assert_eq!(hosts.len(), 1);
    assert_eq!(hosts[0].address, "example.invalid");
    let mut reopened = Terminal::start(&inventory);
    reopened.until("> example");
    reopened.quit_and_verify_restoration();
}

fn setup_inventory(path: &Path) {
    homelab_client::inventory::add(
        path,
        homelab_client::inventory::HostProfile {
            name: "example".into(),
            address: "example.invalid".into(),
            user: "operator".into(),
            identity: None,
        },
    )
    .unwrap();
}

#[test]
fn cancelling_first_access_before_any_ssh_returns_to_menu_without_changes() {
    let directory = tempfile::tempdir().unwrap();
    let inventory = directory.path().join("private/inventory.json");
    setup_inventory(&inventory);
    let before = std::fs::read(&inventory).unwrap();
    let mut terminal = Terminal::start(&inventory);
    terminal.until("> example");
    terminal.master.write_all(b"\r").unwrap();
    terminal.until("Connect to your Mac");
    // No check or trust action was approved: no SSH process should be started.
    // K cannot skip the initial existing-key check and initiate installation.
    terminal.master.write_all(b"k").unwrap();
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.until("Setup cancelled.");
    terminal.quit_and_verify_restoration();
    assert_eq!(std::fs::read(&inventory).unwrap(), before);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn direct_setup_control_c_restores_terminal_before_reporting_cancellation() {
    let directory = tempfile::tempdir().unwrap();
    let inventory = directory.path().join("private/inventory.json");
    setup_inventory(&inventory);
    let before = std::fs::read(&inventory).unwrap();
    let mut terminal = Terminal::with_arguments(&inventory, &["setup", "--host", "example"]);
    terminal.until("Connect to your Mac");
    terminal.master.write_all(b"\x03").unwrap();
    terminal.until("No bootstrap credentials were transferred");
    terminal.wait_and_verify_restoration(false);
    assert_eq!(std::fs::read(&inventory).unwrap(), before);
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
}

#[test]
fn first_access_primary_action_is_visible_at_minimum_size() {
    let directory = tempfile::tempdir().unwrap();
    let inventory = directory.path().join("private/inventory.json");
    setup_inventory(&inventory);
    let mut terminal = Terminal::with_arguments(&inventory, &["setup", "--host", "example"]);
    terminal.until("Connect to your Mac");
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
    // Trigger a redraw at the smaller size without starting SSH.
    terminal.master.write_all(b"\x1b[B").unwrap();
    let screen = terminal.until("Enter: Check SSH access");
    assert!(screen.contains("Connect to your Mac"));
    assert!(screen.contains("Esc back"));
    assert!(!screen.contains("T approves trust"));
    terminal.master.write_all(b"\x1b").unwrap();
    terminal.wait_and_verify_restoration(false);
}
