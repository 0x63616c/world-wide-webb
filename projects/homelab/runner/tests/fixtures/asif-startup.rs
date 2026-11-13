//! Fake Tart reproduces the unsafe observation boundary without any real VM.
use std::{fs::OpenOptions, io::Write};
fn main() {
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let args: Vec<String> = std::env::args().skip(1).collect();
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
    if args.first().map(String::as_str) == Some("owner-before-pidlock") {
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .open(root.join("prelock-owner.lock"))
            .unwrap();
        file.lock().unwrap();
        std::fs::write(root.join("prelock-owner-ready"), b"").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    if args.first().map(String::as_str) == Some("boot-lease-owner") {
        // The test parent passed its already-locked operation lease as fd0.
        // Retaining fd0 models a native run surviving its controller.
        std::fs::write(root.join("boot-lease-owner-ready"), b"").unwrap();
        std::thread::sleep(std::time::Duration::from_secs(30));
        return;
    }
    let require_owner_exit = || {
        if root.join("prelock-owner.lock").exists() {
            let file = OpenOptions::new()
                .read(true)
                .write(true)
                .open(root.join("prelock-owner.lock"))
                .unwrap();
            if file.try_lock().is_err() {
                event("unsafe_inventory_or_delete_before_owner_exit");
                std::process::exit(42);
            }
        }
    };
    match args.first().map(String::as_str) {
        Some("list" | "get") => {
            require_owner_exit();
            event("diskutil_metadata_probe");
            if root.join("booting").exists() {
                std::process::exit(35);
            }
            match std::fs::read_to_string(root.join("reported-stopped")) {
                Ok(name) => println!(
                    r#"[{{"Source":"local","Name":"{}","State":"stopped","Running":false}}]"#,
                    name.trim()
                ),
                Err(_) => println!("[]"),
            }
        }
        Some("delete") => {
            require_owner_exit();
            if root.join("require-diagnostic").exists() {
                let summary = std::fs::read_to_string(root.join("last-attempt.json")).unwrap();
                assert!(summary.contains("\"last_operation\":\"DeleteVm\""));
                assert!(summary.contains("\"exit_code\":5"));
                event("diagnostic_exists_before_delete");
            }
            event("owned_delete");
            std::fs::remove_file(root.join("reported-stopped")).unwrap();
        }
        Some("exec") if args.get(2).map(String::as_str) == Some("/usr/bin/id") => {
            event("guest_agent");
            assert_eq!(args.get(3).map(String::as_str), Some("-u"));
            if !root.join("guest-agent-ready").exists() {
                std::process::exit(1);
            }
            println!("501");
        }
        Some("exec") if args.get(3).map(String::as_str) == Some("status") => {
            event("guest_status");
            if !root.join("helper-ready").exists() {
                std::process::exit(1);
            }
            println!(
                r#"{{"schema":1,"attempt_id":null,"phase":"ready","updated_at":1,"exit_code":null,"reason":null}}"#
            );
        }
        _ => {
            event("unexpected_effect_or_replay");
            std::process::exit(9);
        }
    }
}
