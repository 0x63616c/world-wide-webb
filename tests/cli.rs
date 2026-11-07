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
