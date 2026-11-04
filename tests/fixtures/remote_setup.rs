use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::MetadataExt;
use std::path::Path;

fn main() {
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let mut args: Vec<_> = std::env::args().skip(1).collect();
    if root.join("expected-key").exists() {
        assert_eq!(&args[..3], ["-F", "/dev/null", "-i"]);
        let public_file = &args[3];
        assert_eq!(
            std::fs::read_to_string(public_file).unwrap().trim(),
            std::fs::read_to_string(root.join("expected-key")).unwrap()
        );
        assert_eq!(
            std::env::var_os("SSH_AUTH_SOCK").unwrap(),
            root.join("selected agent.sock")
        );
        for option in [
            "IdentitiesOnly=yes",
            "IdentityAgent=SSH_AUTH_SOCK",
            "ControlMaster=no",
            "ControlPath=none",
            "ControlPersist=no",
        ] {
            assert!(args.iter().any(|arg| arg == option));
        }
        use std::io::Write as _;
        writeln!(
            std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(root.join("identity-files"))
                .unwrap(),
            "{public_file}"
        )
        .unwrap();
        let start = args
            .iter()
            .position(|arg| ["-T", "-tt", "-s"].contains(&arg.as_str()))
            .unwrap();
        args.drain(..start);
    }

    let event = |name: &str| {
        writeln!(
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(root.join("events"))
                .unwrap(),
            "{name}"
        )
        .unwrap();
    };
    for option in [
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "ForwardAgent=no",
        "ClearAllForwardings=yes",
        "ConnectTimeout=8",
        "ServerAliveInterval=5",
        "ServerAliveCountMax=2",
    ] {
        assert!(args.iter().any(|arg| arg == option));
    }
    assert!(!args.iter().any(|arg| arg.contains("synthetic-private")));
    let program = std::env::args().next().unwrap();
    if Path::new(&program).file_name().unwrap() == "scp" {
        assert!(args.iter().any(|arg| arg == "-s"));
        event("transfer");
        let start = args.iter().position(|arg| arg == "--").unwrap() + 1;
        assert_eq!(args.len() - start, 8);
        assert_eq!(
            args.last().unwrap(),
            "admin@example-host:/private/tmp/homelab-setup.ABC12345/"
        );
        for file in &args[start..args.len() - 1] {
            let metadata = fs::metadata(file).unwrap();
            assert!(metadata.mode() & 0o077 == 0);
            assert!(metadata.is_file());
            assert!(!file.contains("source"));
        }
        let key = args[start..args.len() - 1]
            .iter()
            .find(|path| path.ends_with("/host.age"))
            .unwrap();
        assert_eq!(fs::read_to_string(key).unwrap(), "synthetic-private-age");
        if root.join("transfer-fails").exists() {
            std::process::exit(1);
        }
        return;
    }
    assert_eq!(
        args[args.iter().position(|arg| arg == "-l").unwrap() + 1],
        "admin"
    );
    if args[0] == "-tt" {
        event("bootstrap");
        let remote = args.last().unwrap();
        assert!(remote.contains("HOMELAB_BOOTSTRAP_APPROVED='build-mac'"));
        assert!(remote.contains("/homelab-host' bootstrap 'build-mac'"));
        assert!(remote.contains(&format!("'{}'", "a".repeat(40))));
        assert!(!remote.contains("sudo"));
        if let Ok(status) = fs::read_to_string(root.join("interrupted-status")) {
            std::process::exit(status.parse().unwrap());
        }
        if root.join("bootstrap-fails").exists() {
            std::process::exit(1);
        }
        return;
    }
    assert_eq!(args[0], "-T");
    assert!(args.last().unwrap().starts_with("/bin/sh -s"));
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    if input.contains("sw_vers") {
        event("inspect");
        let events = fs::read_to_string(root.join("events")).unwrap();
        if root.join("reconnect-fails").exists() && events.contains("bootstrap") {
            std::process::exit(255);
        }
        println!(
            "27.2\narm64\nadmin\n{}\n104857600",
            if root.join("changed-uid").exists() {
                "502"
            } else {
                "501"
            }
        );
    } else if input.contains("mktemp") {
        event("stage");
        assert!(input.contains("umask 077"));
        if root.join("unsafe-stage").exists() {
            println!("/private/tmp/other-user");
        } else {
            println!("/private/tmp/homelab-setup.ABC12345");
        }
    } else if input.contains("shasum") {
        event("verify");
        if root.join("remote-hash-fails").exists() {
            std::process::exit(1);
        }
    } else if input.contains("rmdir") {
        event("cleanup");
        assert!(!input.contains("rm -r"));
        assert!(input.contains("host.age"));
        assert_eq!(
            args.last().unwrap(),
            "/bin/sh -s -- '/private/tmp/homelab-setup.ABC12345'"
        );
        if root.join("cleanup-fails").exists() {
            std::process::exit(1);
        }
    } else {
        panic!("unexpected fixed remote program");
    }
}
