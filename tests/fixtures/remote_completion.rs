use std::fs::{self, OpenOptions};
use std::io::Write;

fn main() {
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let tailnet = args.first().is_some_and(|arg| arg == "ssh");
    for expected in ["ControlPath=none", "ForwardAgent=no"] {
        assert!(args.iter().any(|arg| arg == expected));
    }
    if tailnet {
        assert!(!args.iter().any(|arg| arg.contains("HostKeyAlias") || arg.contains("UserKnownHostsFile") || arg == "-i"));
        assert!(args.windows(2).any(|args| args == ["-F", "/dev/null"]));
    } else {
        assert!(args.iter().any(|arg| arg == "StrictHostKeyChecking=yes"));
        assert!(args.iter().any(|arg| arg == "HostKeyAlias=example-host"));
    }
    let command = args.last().unwrap();
    let address = if tailnet { args[1].strip_prefix("admin@").unwrap() } else { &args[args.len() - 2] };
    let mut events = OpenOptions::new().create(true).append(true).open(root.join("events")).unwrap();
    writeln!(events, "{address}: {command}").unwrap();
    if address == "100.80.1.2" && root.join("tailnet-fails").exists() {
        std::process::exit(255);
    }
    let field = |name: &str| command.split(&format!("--{name} '")).nth(1).unwrap().split('\'').next().unwrap().to_owned();
    if command.ends_with("tailscale status --json --peers=false") {
        let pending = root.join("enrollment-pending");
        if pending.exists() {
            fs::remove_file(pending).unwrap();
            println!("{{\"BackendState\":\"NeedsLogin\"}}");
        } else {
            println!("{{\"BackendState\":\"Running\"}}");
        }
    } else if command.contains("read-setup-completion") {
        print!("{}", fs::read_to_string(root.join("completion")).unwrap_or_else(|_| "null".into()));
    } else if command.ends_with(" current-system") {
        println!("\"/nix/store/test-system\"");
    } else if command.contains("read-setup-report") {
        let report = fs::read_to_string(root.join("report")).unwrap();
        print!("{}", if root.join("stale-report").exists() { report.replace(&field("request-id"), &"0".repeat(64)) } else { report });
    } else if command.contains("kern.bootsessionuuid") {
        println!("bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee");
    } else if command.starts_with("/usr/bin/sudo ") {
        assert_eq!(args[0], "-tt");
        if command.contains("/bin/sh -c") {
            if command.contains("homelab-health") && root.join("service-health-fails").exists() {
                std::process::exit(1);
            }
            return;
        }
        assert!(command.contains("--system '/nix/store/test-system'"));
        if command.contains("verify-setup") && root.join("service-health-fails").exists() {
            std::process::exit(1);
        }
        if command.contains("request-setup-reboot") {
            if root.join("reboot-denied").exists() { std::process::exit(1); }
            fs::write(root.join("rebooted"), "yes").unwrap();
            if root.join("lost-reboot-response").exists() { std::process::exit(255); }
            return;
        }
        let completed = command.contains("complete-setup");
        let reconciled = if completed { format!("\"{}\"", "b".repeat(40)) } else { "null".into() };
        let completed_at = if completed { "1730000000" } else { "null" };
        let rebooted = root.join("rebooted").exists();
        if completed { assert!(rebooted); }
        let boot = if rebooted { "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee" } else { "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
        let report = format!(
            "{{\"schema\":1,\"requestId\":\"{}\",\"binding\":\"{}\",\"system\":\"/nix/store/test-system\",\"mainRevision\":\"{}\",\"rebooted\":{rebooted},\"completed\":{completed},\"completedAt\":{completed_at},\"reconciledRevision\":{reconciled},\"bootSession\":\"{boot}\",\"tailscale\":{{\"dns_name\":\"build-mac.example.ts.net\",\"addresses\":[\"100.80.1.2\"]}}}}",
            field("request-id"), field("binding"), "b".repeat(40));
        fs::write(root.join("report"), &report).unwrap();
        if completed { fs::write(root.join("completion"), &report).unwrap(); }
    } else { panic!("unexpected command: {command}"); }
}
