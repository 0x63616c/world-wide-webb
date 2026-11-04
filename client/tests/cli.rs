use std::process::Command;

use homelab_client::inventory::{HostProfile, add};

#[test]
fn help_works_from_an_unrelated_directory() {
    let directory = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .arg("--help")
        .current_dir(directory.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("inspect"));
    assert!(help.contains("--inventory"));
}

#[test]
fn noninteractive_menu_explains_the_automation_interface() {
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("inspect --host NAME --json")
    );
}

#[test]
fn missing_inventory_reports_a_structured_failure() {
    let directory = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .args(["inspect", "--host", "missing", "--json", "--inventory"])
        .arg(directory.path().join("missing.json"))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["schema"], 1);
    assert_eq!(json["state"], "blocked");
    assert_eq!(json["code"], "inventory-missing");
    assert!(json["nextAction"].as_str().unwrap().contains("profile"));
    assert!(output.stderr.is_empty());
}

#[test]
fn unknown_profile_does_not_fall_back_to_an_ssh_address() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("private/inventory.json");
    add(
        &path,
        HostProfile {
            name: "saved".into(),
            address: "example.invalid".into(),
            user: "operator".into(),
            identity: None,
        },
    )
    .unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .arg("--inventory")
        .arg(path)
        .args(["inspect", "--host", "arbitrary", "--json"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let json: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(json["code"], "unknown-host");
    assert!(
        !String::from_utf8(output.stdout)
            .unwrap()
            .contains("example.invalid")
    );
}
