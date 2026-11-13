use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

fn main() {
    let executable = std::env::current_exe().unwrap();
    let directory = executable.parent().unwrap();
    fs::write(directory.join("executed"), "").unwrap();
    let expected: BTreeSet<String> = [
        "PATH",
        "HOME",
        "XDG_CONFIG_HOME",
        "GNUPGHOME",
        "SOPS_GPG_EXEC",
        "AWS_EC2_METADATA_DISABLED",
        "SOPS_AGE_KEY_FILE",
    ]
    .map(String::from)
    .into();
    assert_eq!(
        std::env::vars()
            .map(|(name, _)| name)
            .collect::<BTreeSet<_>>(),
        expected
    );
    assert_eq!(std::env::var("PATH").unwrap(), "/usr/bin:/bin");
    assert_eq!(std::env::var("SOPS_GPG_EXEC").unwrap(), "/usr/bin/false");
    assert_eq!(std::env::var("AWS_EC2_METADATA_DISABLED").unwrap(), "true");
    let home = std::env::var("HOME").unwrap();
    for variable in ["HOME", "XDG_CONFIG_HOME", "GNUPGHOME"] {
        let path = std::env::var(variable).unwrap();
        assert!(Path::new(&path).starts_with(&home));
        assert_eq!(fs::metadata(path).unwrap().mode() & 0o777, 0o700);
    }
    let key = std::env::var("SOPS_AGE_KEY_FILE").unwrap();
    assert!(Path::new(&key).starts_with(&home));
    assert_eq!(fs::metadata(&key).unwrap().mode() & 0o777, 0o600);
    fs::write(directory.join("isolated-home"), &home).unwrap();
    let args: Vec<_> = std::env::args().skip(1).collect();
    assert_eq!(
        &args[..5],
        ["--decrypt", "--input-type", "yaml", "--output-type", "yaml"]
    );
    assert_eq!(args.len(), 6);
    assert_eq!(
        fs::read_to_string(&args[5]).unwrap(),
        "synthetic-ciphertext"
    );
    // Prove plaintext/error streams are discarded at the descriptor boundary.
    let null = fs::metadata("/dev/null").unwrap();
    for fd in ["/dev/fd/1", "/dev/fd/2"] {
        assert_eq!(fs::metadata(fd).unwrap().rdev(), null.rdev());
    }
    std::io::stdout().write_all(&vec![b'p'; 100_000]).unwrap();
    eprintln!("private-key-and-plaintext-must-never-escape");
    if fs::read_to_string(key).unwrap() != "synthetic-correct-key" {
        std::process::exit(1);
    }
}
