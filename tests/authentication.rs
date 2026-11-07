//! Exercises the production PTY and bridge with synthetic native authentication.
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, ExitCode, Termination};
use std::time::{Duration, Instant};

use filedescriptor::FileDescriptor;
use portable_pty::{CommandBuilder, PtySize, native_pty_system};

fn child(mode: &str, fixture: &Path) {
    use crossterm::{execute, terminal};
    struct Restore;
    impl Drop for Restore {
        fn drop(&mut self) {
            let _ = terminal::disable_raw_mode();
            let _ = execute!(std::io::stdout(), terminal::LeaveAlternateScreen);
        }
    }
    terminal::enable_raw_mode().unwrap();
    execute!(std::io::stdout(), terminal::EnterAlternateScreen).unwrap();
    let restore = Restore;
    let mut command = Command::new(fixture);
    command.arg(mode);
    let result = homelab_client::terminal_process::within(
        "Authentication test",
        "disposable fixture",
        || match mode {
            "input" => {
                let mut input = tempfile::NamedTempFile::new().unwrap();
                input.write_all(b"fixture-public-key\n").unwrap();
                homelab_client::terminal_process::status_with_input(&mut command, input.path())
            }
            "capture" | "timeout" => {
                let timeout = if mode == "timeout" {
                    Duration::from_millis(300)
                } else {
                    Duration::from_secs(5)
                };
                homelab_client::terminal_process::capture(&mut command, timeout)
                    .map(|output| {
                        assert_eq!(output.stdout, b"{\"verified\":true}\n");
                        output.status
                    })
                    .map_err(std::io::Error::other)
            }
            _ => homelab_client::terminal_process::status(&mut command),
        },
    );
    if mode == "cancel" || mode == "timeout" {
        assert!(result.is_err());
    } else {
        assert_eq!(result.unwrap().success(), !mode.starts_with("failure"));
    }
    drop(restore);
    println!("TRANSPORT_VERIFIED");
}

fn scenario(mode: &str, fixture: &Path) {
    let pair = native_pty_system()
        .openpty(PtySize {
            rows: 30,
            cols: 100,
            pixel_width: 0,
            pixel_height: 0,
        })
        .unwrap();
    let mut command = CommandBuilder::new(std::env::current_exe().unwrap());
    command.cwd(std::env::current_dir().unwrap());
    command.args(["--child", mode]);
    command.arg(fixture);
    command.env("HOMELAB_NO_UPDATE_CHECK", "1");
    let mut child = pair.slave.spawn_command(command).unwrap();
    drop(pair.slave);
    let mut reader = FileDescriptor::dup(&pair.master.as_raw_fd().unwrap()).unwrap();
    reader.set_non_blocking(true).unwrap();
    let mut writer = pair.master.take_writer().unwrap();
    let mut transcript = Vec::new();
    let mut parser = vt100::Parser::new(30, 100, 0);
    let started = Instant::now();
    let mut answered = false;
    let mut acknowledged = false;
    let mut mask_verified = false;
    let mut retried = false;
    let mut build_verified = false;
    let mut exit = None;
    loop {
        let mut buffer = [0; 8192];
        match reader.read(&mut buffer) {
            Ok(count) => {
                transcript.extend_from_slice(&buffer[..count]);
                parser.process(&buffer[..count]);
            }
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.raw_os_error() == Some(5) => {}
            Err(error) => panic!("PTY read: {error}"),
        }
        let screen = parser.screen().contents();
        if !answered && screen.contains("Password:") {
            answered = true;
            pair.master
                .resize(PtySize {
                    rows: 24,
                    cols: 80,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .unwrap();
            parser.set_size(24, 80);
            if mode == "cancel" {
                writer.write_all(b"\x03").unwrap();
            } else if mode == "masked" {
                writer.write_all(b"dR?fixture-password").unwrap();
            } else if mode != "timeout" {
                writer.write_all(b"dR?fixture-password\r").unwrap();
            }
        }
        if mode == "retry" && !retried && screen.contains("Password not accepted. Try again.") {
            assert_eq!(screen.matches("Password:").count(), 1);
            assert!(!screen.contains("Sorry, try again."));
            retried = true;
            writer.write_all(b"dR?fixture-password\r").unwrap();
        }
        if mode == "retry" && screen.contains("Building configuration…") {
            assert!(!screen.contains("Password:"));
            assert!(!screen.contains("Password not accepted"));
            assert!(!screen.contains("Working…"));
            build_verified = true;
        }
        if mode == "masked" && !mask_verified && screen.contains("******************") {
            mask_verified = true;
            writer.write_all(b"\r").unwrap();
        }
        if mode.starts_with("failure")
            && !acknowledged
            && screen.contains("Fixture command failed")
            && screen.contains("Continue")
        {
            acknowledged = true;
            writer
                .write_all(if mode == "failure-quit" {
                    b"\x03\x03"
                } else {
                    b"\r"
                })
                .unwrap();
        }
        if exit.is_none() {
            exit = child.try_wait().unwrap();
        }
        if exit.is_some() && String::from_utf8_lossy(&transcript).contains("TRANSPORT_VERIFIED") {
            break;
        }
        if started.elapsed() > Duration::from_secs(12) {
            let _ = child.kill();
            let _ = child.wait();
            panic!("{mode} timeout: {}", String::from_utf8_lossy(&transcript));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(exit.unwrap().success());
    let transcript = String::from_utf8_lossy(&transcript);
    assert!(
        !transcript.contains("fixture-password"),
        "password was echoed"
    );
    assert!(
        !transcript.contains("\x1b]52;"),
        "clipboard escape escaped parser"
    );
    assert!(
        !transcript.contains("Documentation and source"),
        "password key opened help"
    );
    assert!(
        !transcript.contains("{\"verified\":true}"),
        "protocol stdout leaked into pane"
    );
    assert_eq!(transcript.matches("\x1b[?1049h").count(), 1);
    assert_eq!(transcript.matches("\x1b[?1049l").count(), 1);
    assert!(mode != "masked" || mask_verified);
    assert!(mode != "retry" || (retried && build_verified));
    assert!(answered, "native prompt wasn't displayed");
}

fn main() {
    if let Some(status) = homelab_client::terminal_process::dispatch_bridge() {
        std::process::exit(if status.report() == ExitCode::SUCCESS {
            0
        } else {
            1
        });
    }
    let args: Vec<_> = std::env::args_os().collect();
    if args.get(1).is_some_and(|arg| arg == "--child") {
        child(args[2].to_str().unwrap(), Path::new(&args[3]));
        return;
    }
    let temp = tempfile::tempdir().unwrap();
    let fixture = temp.path().join("native-authentication");
    assert!(
        Command::new("rustc")
            .arg("tests/fixtures/authentication.rs")
            .arg("-o")
            .arg(&fixture)
            .status()
            .unwrap()
            .success()
    );
    for mode in [
        "status",
        "masked",
        "retry",
        "input",
        "capture",
        "failure",
        "failure-quit",
        "cancel",
        "timeout",
    ] {
        scenario(mode, &fixture);
        println!("passed: embedded authentication {mode}");
    }
}
