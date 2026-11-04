use std::{env, fs, io::{self, Read}};
fn main() {
    let executable = env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let args: Vec<String> = env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("-l") {
        assert_eq!(&args[..4], ["-l", "-E", "sha256", "-f"]);
        let key = fs::read_to_string(&args[4]).unwrap();
        assert_eq!(key, "ssh-ed25519 AAAA\n");
        if root.join("bad-key").exists() { std::process::exit(1); }
        println!("256 SHA256:fixture key-comment-should-not-leak (ED25519)");
        return;
    }
    let options = args.join("\n");
    for option in ["ControlMaster=no", "ControlPath=none", "ControlPersist=no", "ForwardAgent=no", "ClearAllForwardings=yes"] {
        assert!(options.contains(option));
    }
    let destination = args.iter().position(|arg| arg == "--").unwrap();
    assert_eq!(args[destination + 1], "admin@192.0.2.1");
    if args.last().unwrap() == "/usr/bin/true" {
        assert!(options.contains("BatchMode=yes"));
        assert!(options.contains("PreferredAuthentications=publickey"));
        assert!(!options.contains("PubkeyAuthentication=no"));
        assert!(!options.contains("PreferredAuthentications=keyboard-interactive,password"));
        assert_eq!(env::var("LC_ALL").unwrap(), "C");
        fs::write(root.join("check-args"), options).unwrap();
        if let Ok(message) = fs::read_to_string(root.join("diagnostic")) { eprint!("{message}"); std::process::exit(255); }
        if root.join("fail-check").exists() { eprintln!("private diagnostic"); std::process::exit(255); }
    } else {
        assert!(options.contains("BatchMode=no"));
        for option in ["PreferredAuthentications=keyboard-interactive,password", "PubkeyAuthentication=no", "PasswordAuthentication=yes", "KbdInteractiveAuthentication=yes"] {
            assert!(options.contains(option));
        }
        assert!(options.contains("StrictHostKeyChecking=yes"));
        assert!(!options.contains("accept-new"));
        if root.join("changed-host").exists() { std::process::exit(255); }
        let script = args.last().unwrap();
        assert!(script.contains("authorized_keys"));
        let mut key = String::new();
        io::stdin().read_to_string(&mut key).unwrap();
        assert_eq!(key, "ssh-ed25519 AAAA\n");
        fs::write(root.join("installed"), key).unwrap();
        if let Ok(code) = fs::read_to_string(root.join("exit")) { std::process::exit(code.trim().parse().unwrap()); }
    }
}
