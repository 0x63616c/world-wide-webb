use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

fn main() {
    let marker = Path::new(env!("HOMELAB_FIXTURE_MARKER"));
    let executable = std::env::current_exe().unwrap();
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    let environment: BTreeSet<_> = std::env::vars().map(|(key, _)| key).collect();
    assert_eq!(
        environment,
        BTreeSet::from(["HOME".into(), "LC_ALL".into(), "PATH".into()])
    );
    assert_eq!(std::env::var("HOME").unwrap(), "/var/root");
    assert_eq!(std::env::var("LC_ALL").unwrap(), "C");
    let null = fs::metadata("/dev/null").unwrap();
    for descriptor in ["/dev/fd/0", "/dev/fd/1", "/dev/fd/2"] {
        assert_eq!(fs::metadata(descriptor).unwrap().rdev(), null.rdev());
    }
    if executable.file_name().unwrap() == "nix-installer" {
        assert_eq!(arguments, ["install", "--no-confirm"]);
        assert_eq!(fs::metadata(&executable).unwrap().mode() & 0o7777, 0o700);
        assert_eq!(
            fs::metadata(executable.parent().unwrap()).unwrap().mode() & 0o7777,
            0o700
        );
        assert_eq!(
            std::env::current_dir().unwrap(),
            executable.parent().unwrap().canonicalize().unwrap()
        );
        assert_eq!(
            std::env::var("PATH").unwrap(),
            "/usr/bin:/bin:/usr/sbin:/sbin"
        );
    } else {
        assert_eq!(executable.file_name().unwrap(), "darwin-rebuild");
        assert_eq!(arguments.len(), 4);
        assert_eq!(arguments[0], "switch");
        assert_eq!(arguments[1], "--flake");
        assert_eq!(
            arguments[2],
            format!(
                "{}#workstation",
                marker.parent().unwrap().join("checkout").display()
            )
        );
        assert_eq!(arguments[3], "--no-update-lock-file");
        assert_eq!(
            std::env::current_dir().unwrap(),
            marker
                .parent()
                .unwrap()
                .join("checkout")
                .canonicalize()
                .unwrap()
        );
        assert!(
            std::env::var("PATH")
                .unwrap()
                .starts_with(executable.parent().unwrap().to_str().unwrap())
        );
    }
    fs::write(marker, executable.to_str().unwrap()).unwrap();
    println!("private-output-must-not-escape");
    eprintln!("private-error-must-not-escape");
    if marker.with_extension("fail").exists() {
        std::process::exit(1);
    }
}
