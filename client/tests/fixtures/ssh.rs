use std::io::{Read, Write};

fn main() {
    let executable = std::env::current_exe().unwrap();
    let directory = executable.parent().unwrap();
    std::fs::write(directory.join("executed"), "").unwrap();
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    let expected = [
        "-T",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "ForwardAgent=no",
        "-o",
        "ClearAllForwardings=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ServerAliveInterval=5",
        "-o",
        "ServerAliveCountMax=2",
        "-l",
        "operator",
        "example-host",
        "/bin/sh -s",
    ];
    assert_eq!(arguments, expected);
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    assert_eq!(input, include_str!("../../src/probe.sh"));
    assert!(!input.contains("operator"));
    assert!(!input.contains("sudo"));
    if directory.join("check-environment").exists() {
        assert_eq!(
            std::env::var("SSH_AUTH_SOCK").unwrap(),
            "fixture-agent-socket"
        );
        assert_eq!(std::env::var("HOMELAB_INSPECT_ENV").unwrap(), "inherited");
    }
    if directory.join("fail").exists() {
        eprintln!("secret-fixture-do-not-display");
        println!("secret-fixture-do-not-display");
        std::process::exit(255);
    }
    std::io::stdout()
        .write_all(&std::fs::read(directory.join("response")).unwrap())
        .unwrap();
}
