use std::collections::BTreeSet;
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::path::Path;

fn main() {
    let marker = Path::new(env!("HOMELAB_FIXTURE_MARKER"));
    let executable = std::env::current_exe().unwrap();
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    let environment: BTreeSet<_> = std::env::vars().map(|(key, _)| key).collect();
    let mut expected = BTreeSet::from(["HOME".into(), "LC_ALL".into(), "PATH".into()]);
    if executable.file_name().unwrap() != "nix-installer" {
        expected.insert("NIX_REMOTE".into());
        assert_eq!(std::env::var("NIX_REMOTE").unwrap(), "daemon");
    }
    assert_eq!(environment, expected);
    assert_eq!(std::env::var("HOME").unwrap(), "/var/root");
    assert_eq!(std::env::var("LC_ALL").unwrap(), "C");
    let null = fs::metadata("/dev/null").unwrap();
    for descriptor in ["/dev/fd/0", "/dev/fd/1", "/dev/fd/2"] {
        assert_eq!(fs::metadata(descriptor).unwrap().rdev(), null.rdev());
    }
    if executable.file_name().unwrap() == "nix-installer" {
        assert_eq!(arguments, ["install", "--no-confirm", "--diagnostic-endpoint", ""]);
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
        assert_eq!(std::env::current_dir().unwrap(), Path::new("/"));
        let stage = executable.file_name().unwrap().to_str().unwrap();
        if stage == "nix-env" {
            assert_eq!(arguments, ["-p", "/nix/var/nix/profiles/system", "--set", marker.parent().unwrap().join("store/system").to_str().unwrap()]);
        } else {
            assert_eq!(stage, "darwin-rebuild");
            assert_eq!(arguments, ["activate", "--no-flake"]);
            assert_eq!(fs::read_to_string(marker).unwrap(), "nix-env\n");
        }
        use std::io::Write;
        writeln!(fs::OpenOptions::new().create(true).append(true).open(marker).unwrap(), "{stage}").unwrap();
        if marker.with_extension(stage).exists() {
            eprintln!("private-error-must-not-escape");
            std::process::exit(1);
        }
        return;
    }
    fs::write(marker, executable.to_str().unwrap()).unwrap();
    println!("private-output-must-not-escape");
    eprintln!("private-error-must-not-escape");
    if marker.with_extension("fail").exists() {
        std::process::exit(1);
    }
}
