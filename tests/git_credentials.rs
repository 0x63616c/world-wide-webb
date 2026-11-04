use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::{Command, Output};

fn ask(prompt: &str, path: &std::path::Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_homelab-host"))
        .args(["credential-askpass", prompt])
        .env_clear()
        .env("HOMELAB_GITHUB_TOKEN_FILE", path)
        .output()
        .unwrap()
}

#[test]
fn credentials_are_returned_only_for_the_expected_github_prompts() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("token");
    fs::write(&path, "github_pat_fixture123\n").unwrap();
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
    let username = ask("Username for 'https://github.com': ", &path);
    assert!(username.status.success());
    assert_eq!(username.stdout, b"x-access-token\n");
    let password = ask("Password for 'https://x-access-token@github.com': ", &path);
    assert!(password.status.success());
    assert_eq!(password.stdout, b"github_pat_fixture123\n");
    for prompt in [
        "Password for 'https://evil.example': ",
        "Password for 'https://github.com@evil.example': ",
    ] {
        let result = ask(prompt, &path);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&result.stderr).contains("github_pat_fixture123"));
    }
}

#[test]
fn unsafe_token_files_never_emit_credentials() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("token");
    let prompt = "Password for 'https://x-access-token@github.com': ";
    for (value, mode) in [
        ("fixture", 0o644),
        ("", 0o600),
        ("fixture\ninjection", 0o600),
        ("fixture secret", 0o600),
    ] {
        fs::write(&path, value).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(mode)).unwrap();
        let result = ask(prompt, &path);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
    }
    fs::write(&path, "fixture").unwrap();
    let alias = directory.path().join("alias");
    symlink(&path, &alias).unwrap();
    assert!(!ask(prompt, &alias).status.success());
    fs::remove_file(&path).unwrap();
    assert!(!ask(prompt, &path).status.success());
}
