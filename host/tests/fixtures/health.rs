use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

fn main() {
    let executable = std::env::current_exe().unwrap();
    let root = executable.parent().unwrap();
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(arguments[0], "--host");
    let socket = &arguments[1];
    assert_eq!(std::env::var("HOME").unwrap(), "/var/empty");
    assert!(std::env::var("DOCKER_HOST").is_err());
    let name = if arguments[2] == "inspect" {
        arguments.last().unwrap()
    } else {
        &arguments[3]
    };
    assert_eq!(
        socket,
        if name == "www-home-assistant-home-assistant-1" {
            "unix:///var/lib/_containers/.colima-ha/ha/docker.sock"
        } else {
            "unix:///var/lib/_containers/.colima/services/docker.sock"
        }
    );
    writeln!(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("events"))
            .unwrap(),
        "{} {name}",
        arguments[2]
    )
    .unwrap();
    if root.join("slow").exists() {
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
    if root.join("noisy").exists() {
        print!("{}", "private-payload".repeat(20_000));
        return;
    }
    if root.join("fail").exists() {
        eprintln!("private-payload");
        std::process::exit(1);
    }
    let response = if arguments[2] == "inspect" {
        assert_eq!(arguments[3], "--format");
        assert!(arguments[4].contains(".State.Running"));
        assert!(arguments[4].contains(".State.Health.Status"));
        assert!(arguments[4].contains(".Config.Image"));
        assert!(!arguments[4].contains(".State}}"));
        root.join(format!("{name}.json"))
    } else if name == "www-control-center-www-1" {
        assert_eq!(arguments[4], "bun");
        assert_eq!(arguments[5], "-e");
        assert_eq!(
            arguments[6],
            include_str!("../../src/probes/control-center.mjs")
        );
        root.join("control-center.json")
    } else if name == "bambuddy-tailscale" {
        assert_eq!(
            &arguments[4..],
            [
                "/usr/local/bin/tailscale",
                "status",
                "--json",
                "--peers=false"
            ]
        );
        root.join("tailscale.json")
    } else {
        assert_eq!(name, "www-tunnel-cloudflared-1");
        assert_eq!(
            &arguments[4..],
            [
                "/usr/local/bin/cloudflared",
                "tunnel",
                "--metrics",
                "127.0.0.1:20241",
                "ready"
            ]
        );
        if root.join("tunnel-fails").exists() {
            std::process::exit(1);
        }
        return;
    };
    print!("{}", fs::read_to_string(Path::new(&response)).unwrap());
}
