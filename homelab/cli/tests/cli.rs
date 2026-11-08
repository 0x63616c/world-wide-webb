use std::process::Command;

#[test]
fn help_describes_setup_from_an_unrelated_directory() {
    let directory = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .arg("--help")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("setup"));
    assert!(!help.contains("--inventory"));
    assert!(help.contains("Git configuration"));
    assert!(!help.contains("inspect"));
    assert!(!help.contains("management"));
}

#[test]
fn noninteractive_setup_explains_how_to_open_the_wizard() {
    for arguments in [vec![], vec!["setup", "--host", "saved-mac"]] {
        let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
            .args(arguments)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        let message = String::from_utf8(output.stderr).unwrap();
        assert!(message.contains("Setup needs an interactive terminal"));
        assert!(message.contains("start or resume setup"));
        assert!(!message.contains("inspect"));
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn removed_inspection_command_does_not_read_or_change_saved_state() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("inventory.json");
    let original = b"preserve even malformed state";
    std::fs::write(&path, original).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .arg("--inventory")
        .arg(&path)
        .args(["inspect", "--host", "arbitrary", "--json"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("unrecognized subcommand")
    );
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn preview_help_needs_no_home_accounts_or_saved_state() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("inventory.json");
    let original = b"preserve malformed operator state";
    std::fs::write(&path, original).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .arg("--inventory")
        .arg(&path)
        .args(["preview", "--help"])
        .env_remove("HOME")
        .env("PATH", "")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("synthetic UI"));
    assert!(help.contains("--screen"));
    assert!(help.contains("attention"));
    assert_eq!(std::fs::read(path).unwrap(), original);
}

#[test]
fn noninteractive_preview_stops_before_any_state_or_provider_access() {
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .args(["preview", "--screen", "progress"])
        .env_remove("HOME")
        .env("PATH", "")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains("Preview needs an interactive terminal"));
    assert!(!error.contains("inventory-unavailable"));
}

#[test]
fn preview_dump_renders_without_home_or_provider_executables() {
    let directory = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .args([
            "preview", "--screen", "progress", "--dump", "--width", "80", "--height", "24",
        ])
        .env_remove("HOME")
        .env("PATH", "")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("[~] homelab"));
    assert!(text.contains("Backing up and encrypting keys"));
    assert!(text.contains("Esc Exit"));
    assert!(!text.contains('\u{1b}'));
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[test]
fn profile_child() {
    let Ok(name) = std::env::var("HOMELAB_PROFILE_TEST") else {
        return;
    };
    homelab_client::operator_profile::select(Some(name.clone())).unwrap();
    let home = std::path::PathBuf::from(std::env::var_os("HOME").unwrap());
    let inventory = homelab_client::operator_profile::inventory_path().unwrap();
    let state = homelab_client::enrollment_credentials::state_directory().unwrap();
    assert_eq!(
        inventory,
        home.join(format!(".homelab/profiles/{name}/inventory.json"))
    );
    assert_eq!(
        state,
        home.join(format!(".homelab/profiles/{name}/provisioning"))
    );
    assert!(!inventory.exists());
    assert!(!state.exists());
}

#[test]
fn profiles_scope_config_and_recovery_state_without_changing_home() {
    let directory = tempfile::tempdir().unwrap();
    for name in ["default", "demo", "other"] {
        let status = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "profile_child"])
            .env("HOMELAB_PROFILE_TEST", name)
            .env("HOME", directory.path())
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[test]
fn profile_names_reject_paths_before_accessing_state() {
    let directory = tempfile::tempdir().unwrap();
    for bad in ["../default", "/tmp/profile", "foo/bar", ""] {
        let result = Command::new(env!("CARGO_BIN_EXE_homelab"))
            .args(["--profile", bad, "config", "schema"])
            .env("HOME", directory.path())
            .output()
            .unwrap();
        assert_eq!(result.status.code(), Some(2));
    }
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}
