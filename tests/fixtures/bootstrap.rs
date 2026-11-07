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
                let ssh = std::env::var("GIT_SSH_COMMAND").unwrap();
                for required in [
                    "StrictHostKeyChecking=yes",
                    "IdentitiesOnly=yes",
                    "IdentityAgent=none",
                    "-F /dev/null",
                    "github_known_hosts",
                ] {
                    assert!(ssh.contains(required));
                }
                assert!(std::env::var_os("GIT_ASKPASS").is_none());
                event(root, "git-ssh-verified");
                assert!(
                    args.iter()
                        .any(|arg| arg == "git@github.com:example/private-config.git")
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
            } else if args.iter().any(|arg| arg == "diff") {
                event(root, "repair-protected-files");
                if flag("repair-changed-inputs") { fail(); }
            } else if args.iter().any(|arg| arg == "merge-base") {
                event(root, "repair-ancestry");
                if flag("repair-not-descendant") { fail(); }
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
                if flag("evaluation-fails") { fail(); }
                if flag("build-supervision-fails") {
                    fs::remove_file(root.join("nix")).unwrap();
                }
                print!(
                    "{}",
                    fs::read_to_string(root.join("readiness.json")).unwrap()
                );
            } else if args[0] == "build" {
                event(root, "build");
                if flag("build-fails") {
                    fail();
                }
                if flag("build-output-missing") {
                    return;
                }
                symlink(root.join(if flag("different-system") { "system-other" } else { "system" }), after("--out-link")).unwrap();
            } else {
                panic!("unexpected Nix arguments");
            }
        }
        "sudo" => {
            if args == ["-v"] || args == ["-n", "-v"] {
                event(root, if args == ["-v"] { "authenticate" } else { "validate-authorization" });
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
if args.iter().any(|arg| arg == "bootstrap-nix-status") {
    event(root, "nix-status");
    assert_eq!(after("--version"), "1.2.3");
    std::process::exit(if flag("nix-confirmed") { 0 } else { 1 });
}
if args.iter().any(|arg| arg == "bootstrap-key-status") {

                std::process::exit(if flag("existing-key") { 0 } else { 3 });
            }
            if args.iter().any(|arg| arg == "bootstrap-activation-status") {
                event(root, "activation-status");
                std::process::exit(if flag("activation-confirmed") { 0 } else { 1 });
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
            } else if args.iter().any(|arg| arg == "install-deploy-key") {
                assert!(
                    fs::read_to_string(root.join("state/progress.json"))
                        .unwrap()
                        .contains("InstallingKey")
                );
                event(root, "install-deploy-key");
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
                if !flag("nix-unconfirmed") { fs::write(root.join("nix-confirmed"), "").unwrap(); }
                if flag("installer-exit-fails") { fail(); }
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
            if args.len() == 2 && args[1] == "--help" && ["install-deploy-key", "bootstrap-activation-status", "complete-setup", "run-updater"].contains(&args[0].as_str()) {
                if flag("old-helper") {
                    fail();
                }
                return;
            }
            assert_eq!(args[0], "verify-host-secrets");
            event(root, "verify-secrets");
            if flag("decrypt-fails") {
                fail();
            }
        }
        _ => panic!("unexpected fixture tool {program}"),
    }
}
