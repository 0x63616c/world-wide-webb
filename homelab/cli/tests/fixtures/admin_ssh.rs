use std::io::Read;
use std::os::unix::fs::FileTypeExt;
fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    assert!(!args.iter().any(|arg| arg.contains("synthetic-")));
    if args.last().unwrap() == "/bin/cat /etc/ssh/ssh_host_ed25519_key.pub" {
        println!(
            "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
        return;
    }
    let remote = args.last().unwrap();
    let prompt = remote
        .strip_prefix("LC_ALL=C /usr/bin/sudo -k -S -p '")
        .unwrap()
        .strip_suffix("' -v")
        .unwrap();
    assert!(prompt.starts_with("HL-"));
    assert!(prompt.ends_with(" password:"));
    assert!(
        args.iter()
            .any(|arg| arg == "HostKeyAlgorithms=ssh-ed25519")
    );
    assert!(args.iter().any(|arg| arg == "StrictHostKeyChecking=yes"));
    assert!(args.iter().any(|arg| arg == "-T"));
    assert!(!args.iter().any(|arg| arg == "-tt"));
    assert!(
        std::fs::File::open("/dev/stdin")
            .unwrap()
            .metadata()
            .unwrap()
            .file_type()
            .is_fifo()
    );
    let mut input = String::new();
    std::io::stdin().read_to_string(&mut input).unwrap();
    if input == "synthetic-no-prompt\n" {
        return;
    }
    eprint!("{prompt}");
    if input != "synthetic-validated-password\n" {
        std::process::exit(1);
    }
}
