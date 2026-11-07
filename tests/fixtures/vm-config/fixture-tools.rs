//! Disposable-VM adapters: real local health evidence, synthetic Tailscale status.
use std::fs;
use std::path::Path;
use std::process::{Command, ExitCode};
use std::time::{Duration, Instant};

fn sysctl(name: &str) -> Option<String> {
    let output = Command::new("/usr/sbin/sysctl")
        .args(["-n", name])
        .output()
        .ok()?;
    if !output.status.success() || output.stdout.len() > 1024 {
        return None;
    }
    String::from_utf8(output.stdout)
        .ok()
        .map(|s| s.trim().into())
}

fn healthy() -> bool {
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let decrypted = fs::read_to_string("/run/secrets/tailscale-auth-key")
            .is_ok_and(|value| value.trim() == "tskey-auth-synthetic-vm-only");
        let booted = sysctl("kern.boottime").is_some_and(|boot| {
            fs::read_to_string("/var/tmp/homelab-vm-e2e-boot")
                .is_ok_and(|marker| marker.trim() == boot)
        });
        if decrypted && booted {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_secs(1));
    }
}

fn main() -> ExitCode {
    // The adapter must not impersonate a healthy Tailscale node on real hardware.
    if !sysctl("hw.model").is_some_and(|model| model.starts_with("VirtualMac")) {
        return ExitCode::FAILURE;
    }
    let mut arguments = std::env::args();
    let executable = arguments.next().unwrap_or_default();
    let arguments: Vec<_> = arguments.collect();
    match Path::new(&executable)
        .file_name()
        .and_then(|name| name.to_str())
    {
        Some("tailscale") if arguments == ["status", "--json", "--peers=false"] => {
            print!("{}", include_str!("tailscale-status.json"));
            ExitCode::SUCCESS
        }
        Some("homelab-health") if arguments.is_empty() && healthy() => ExitCode::SUCCESS,
        _ => ExitCode::FAILURE,
    }
}
