//! A rejected synthetic SSH connection must not reach any enrollment provider.
use homelab_client::{first_access, inventory::HostProfile, remote_setup, setup_wizard};
use std::{
    fs::{self, File},
    io::{Read, Write},
    os::unix::fs::PermissionsExt,
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

#[test]
fn rejected_connection_child() {
    let Some(root) = std::env::var_os("HOMELAB_CONNECTION_GUARD_ROOT") else {
        return;
    };
    let root = PathBuf::from(root);
    let ssh = root.join("bin/ssh");
    let tools = setup_wizard::WizardTools {
        first_access: first_access::Tools {
            ssh: ssh.clone(),
            ssh_keygen: "/usr/bin/ssh-keygen".into(),
            ssh_add: "/usr/bin/ssh-add".into(),
        },
        remote_setup: remote_setup::Tools {
            ssh,
            scp: root.join("must-not-run"),
        },
    };
    let dependencies = setup_wizard::EnrollmentDependencies {
        check_client_tools: || panic!("SSH failure reached enrollment tools"),
        prepare_credentials: |_, _, _, _, _| panic!("SSH failure reached credential issuance"),
        prepare_administrator: |_, _, _, _, _| {
            panic!("SSH failure reached administrator authorization")
        },
        tailscale: Some(root.join("must-not-run")),
    };
    let profile = HostProfile {
        name: "test-mac".into(),
        address: "test-mac.local".into(),
        user: "calum".into(),
        identity: None,
        configuration_host: Some("test-mac".into()),
    };
    let result = setup_wizard::launch_with_dependencies(
        &profile,
        &root.join("private/inventory.json"),
        &tools,
        &dependencies,
    )
    .unwrap();
    assert!(!result.completed);
    assert_eq!(
        fs::read_to_string(root.join("ssh-calls"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    println!("CONNECTION_GUARD_RETURNED");
}

#[test]
fn failed_ssh_returns_without_starting_later_enrollment_steps() {
    use rustix::{
        fs::{Mode, OFlags, fcntl_setfl, open},
        io::{FdFlags, fcntl_setfd},
        pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt},
        termios::{Winsize, tcsetwinsize},
    };
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    fs::create_dir(root.join("bin")).unwrap();
    fs::create_dir(root.join("private")).unwrap();
    fs::set_permissions(root.join("private"), fs::Permissions::from_mode(0o700)).unwrap();
    fs::write(
        root.join("private/repository.json"),
        r#"{"schema":1,"repository":"example/config"}"#,
    )
    .unwrap();
    fs::set_permissions(
        root.join("private/repository.json"),
        fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    fs::write(root.join("manifest.json"), serde_json::json!({"schema":2,"onePassword":{"backupVault":"test-vault"},"hosts":{"test-mac":{"adminUser":"calum","adminUID":501,"authorizedKeys":[],"services":[]}}}).to_string()).unwrap();
    fs::write(root.join("bin/gh"), "#!/bin/sh\ncase \"$4\" in\n*/commits/main) printf '%s\\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa ;;\n*/contents/projects/homelab/homelab.json*) /bin/cat \"$HOMELAB_CONNECTION_GUARD_ROOT/manifest.json\" ;;\n*) exit 9 ;;\nesac\n").unwrap();
    fs::write(root.join("bin/ssh"), "#!/bin/sh\nprintf '%s\\n' checked >> \"$HOMELAB_CONNECTION_GUARD_ROOT/ssh-calls\"\nprintf '%s\\n' 'ssh: connect to host test-mac.local port 22: Connection refused' >&2\nexit 255\n").unwrap();
    for file in ["gh", "ssh"] {
        fs::set_permissions(
            root.join("bin").join(file),
            fs::Permissions::from_mode(0o700),
        )
        .unwrap();
    }
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
            ws_row: 24,
            ws_col: 80,
            ws_xpixel: 0,
            ws_ypixel: 0,
        },
    )
    .unwrap();
    let mut child = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "rejected_connection_child", "--nocapture"])
        .env("HOMELAB_CONNECTION_GUARD_ROOT", root)
        .env("HOME", root)
        .env(
            "PATH",
            format!("{}:/usr/bin:/bin", root.join("bin").display()),
        )
        .env("TERM", "xterm-256color")
        .stdin(Stdio::from(slave.try_clone().unwrap()))
        .stdout(Stdio::from(slave.try_clone().unwrap()))
        .stderr(Stdio::from(slave))
        .spawn()
        .unwrap();
    fcntl_setfl(&master, OFlags::NONBLOCK).unwrap();
    let mut master = File::from(master);
    let mut parser = vt100::Parser::new(24, 80, 0);
    let deadline = Instant::now() + Duration::from_secs(10);
    let mut cancelled = false;
    loop {
        let mut bytes = [0; 4096];
        match master.read(&mut bytes) {
            Ok(n) => parser.process(&bytes[..n]),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => (),
            Err(e) => panic!("synthetic PTY failed: {e}"),
        }
        if !cancelled
            && parser
                .screen()
                .contents()
                .contains("Remote Login unavailable")
        {
            master.write_all(b"\x1b").unwrap();
            cancelled = true;
        }
        if let Some(status) = child.try_wait().unwrap() {
            assert!(status.success(), "{}", parser.screen().contents());
            assert!(cancelled);
            break;
        }
        if Instant::now() > deadline {
            let _ = child.kill();
            panic!("synthetic setup stalled: {}", parser.screen().contents());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(!root.join("must-not-run").exists());
}
