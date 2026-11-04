use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};

fn event(root: &Path, value: &str) {
    writeln!(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(root.join("events"))
            .unwrap(),
        "{value}"
    )
    .unwrap();
}
fn fail() -> ! {
    std::process::exit(1)
}
fn main() {
    let executable = std::env::current_exe().unwrap();
    let root = executable
        .parent()
        .unwrap()
        .ancestors()
        .find(|path| path.join("readiness.json").is_file())
        .unwrap();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let program = PathBuf::from(std::env::args().next().unwrap());
    let program = program.file_name().unwrap().to_str().unwrap();
    let flag = |name: &str| root.join(name).exists();
    let after = |name: &str| args[args.iter().position(|arg| arg == name).unwrap() + 1].clone();
    match program {
        "uname" => println!(
            "{}",
            if flag("wrong-architecture") {
                "wrong"
            } else if args[0] == "-s" {
                "Darwin"
            } else {
                "arm64"
            }
        ),
        "id" => println!(
            "{}",
            if args[0] == "-u" {
                "501"
            } else if flag("wrong-user") {
                "other"
            } else {
                "admin"
            }
        ),
        "dseditgroup" => println!("yes admin is a member of admin"),
        "xcode-select" => {
            assert_eq!(args, ["--print-path"]);
            if flag("missing-clt") {
                fail();
            }
            println!("/Library/Developer/CommandLineTools");
        }
        "git" => {
            if args == ["--version"] {
                fs::write(root.join("git-invoked"), "").unwrap();
                if flag("broken-git") {
                    fail();
                }
                println!("git version fixture");
                return;
            }

            assert_eq!(
                std::env::var("GIT_CONFIG_KEY_0").unwrap(),
                "credential.helper"
            );
            assert_eq!(std::env::var("GIT_CONFIG_VALUE_0").unwrap(), "");
            assert_eq!(std::env::var("GIT_CONFIG_KEY_1").unwrap(), "core.hooksPath");
            assert_eq!(std::env::var("GIT_CONFIG_VALUE_1").unwrap(), "/dev/null");
            if args[0] == "clone" {
                if let Ok(git) = fs::read_to_string(root.join("actual-git")) {
                    let mut child = std::process::Command::new(git.trim())
                        .args(["credential", "fill"])
                        .stdin(std::process::Stdio::piped())
                        .stdout(std::process::Stdio::piped())
                        .stderr(std::process::Stdio::piped())
                        .spawn()
                        .unwrap();
                    child
                        .stdin
                        .take()
                        .unwrap()
                        .write_all(b"protocol=https\nhost=github.com\n\n")
                        .unwrap();
                    let result = child.wait_with_output().unwrap();
                    assert!(result.status.success(), "real Git askpass failed");
                    let output = String::from_utf8(result.stdout).unwrap();
                    assert!(output.contains("username=x-access-token\n"));
                    assert!(output.contains("password=github_pat_synthetic123\n"));
                    assert!(result.stderr.is_empty());
                    event(root, "git-askpass-verified");
                }
                assert!(
                    args.iter()
                        .any(|arg| arg == "https://github.com/example/private-config.git")
                );
                event(root, "fetch");
                let repo = Path::new(args.last().unwrap());
                fs::create_dir_all(repo.join("secrets")).unwrap();
                fs::create_dir_all(repo.join("bootstrap")).unwrap();
                fs::write(repo.join("flake.lock"), "fixture-lock").unwrap();
                fs::copy(root.join("manifest.json"), repo.join("homelab.json")).unwrap();
                if !flag("missing-ciphertext") {
                    fs::write(
                        repo.join("secrets/workstation.sops.yaml"),
                        "fixture-ciphertext",
                    )
                    .unwrap();
                }
                fs::copy(
                    root.join("installer.json"),
                    repo.join("bootstrap/installer.json"),
                )
                .unwrap();
            } else if args.iter().any(|arg| arg == "rev-parse") {
                println!(
                    "{}",
                    if flag("wrong-revision") {
                        "b".repeat(40)
                    } else {
                        "a".repeat(40)
                    }
                );
            }
        }
        "curl" => {
            event(root, "download-installer");
            fs::write(after("--output"), b"fixture-installer").unwrap();
        }
        "nix" | "installed-nix" => {
            if args[0] == "--version" {
                if flag("broken-nix") {
                    fail();
                }
                println!("nix fixture");
            } else if args[0] == "eval" {
                event(root, "evaluate");
                print!(
                    "{}",
                    fs::read_to_string(root.join("readiness.json")).unwrap()
                );
            } else if args[0] == "build" {
                event(root, "build");
                symlink(root.join("system"), after("--out-link")).unwrap();
            } else {
                panic!("unexpected Nix arguments");
            }
        }
        "sudo" => {
            if args == ["-v"] {
                event(root, "authenticate");
                if flag("late-auth-fails")
                    && fs::read_to_string(root.join("events"))
                        .unwrap()
                        .contains("verify-secrets")
                {
                    fail();
                }
                return;
            }
            assert_eq!(args[0], "-n");
            if args.iter().any(|arg| arg == "bootstrap-key-status") {
                std::process::exit(if flag("existing-key") { 0 } else { 3 });
            }
            if args.iter().any(|arg| arg == "install-host-key") {
                assert!(
                    fs::read_to_string(root.join("state/progress.json"))
                        .unwrap()
                        .contains("\"phase\":\"InstallingKey\"")
                );
                event(root, "install-key");
                if flag("late-key") {
                    fail();
                }
                fs::write(root.join("installed-key"), "installed fixture identity").unwrap();
            } else if args.iter().any(|arg| arg == "bootstrap-install-nix")
                || args.get(2).is_some_and(|arg| arg == "install")
            {
                assert!(
                    fs::read_to_string(root.join("state/progress.json"))
                        .unwrap()
                        .contains("\"phase\":\"InstallingNix\"")
                );
                event(root, "install-nix");
                symlink(&executable, root.join("installed-nix")).unwrap();
            } else if args.iter().any(|arg| arg == "bootstrap-activate")
                || args.get(2).is_some_and(|arg| arg == "switch")
            {
                assert!(
                    fs::read_to_string(root.join("state/progress.json"))
                        .unwrap()
                        .contains("\"phase\":\"Activating\"")
                );
                event(root, "activate");
                assert!(root.join("installed-key").exists());
            } else {
                panic!("unexpected privileged command: {args:?}");
            }
        }
        "homelab-host" | "helper" => {
            assert_eq!(args[0], "verify-host-secrets");
            event(root, "verify-secrets");
            if flag("decrypt-fails") {
                fail();
            }
        }
        _ => panic!("unexpected fixture tool {program}"),
    }
}
