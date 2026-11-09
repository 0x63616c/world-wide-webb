use homelab_client::config;
use serde_json::{Value, json};
use std::process::Command;

fn example() -> Value {
    serde_json::from_str(include_str!("../examples/homelab.json")).unwrap()
}

#[test]
fn committed_schema_matches_types_and_validates_current_example() {
    let generated = config::schema();
    assert_eq!(
        format!("{}\n", serde_json::to_string_pretty(&generated).unwrap()),
        include_str!("../schema/homelab-v3.schema.json")
    );
    assert_eq!(
        generated["$schema"],
        "https://json-schema.org/draft/2020-12/schema"
    );
    let validator = jsonschema::validator_for(&generated).unwrap();
    fn example() -> Value {
        serde_json::from_str(include_str!("../examples/homelab-v3.json")).unwrap()
    }
    assert!(validator.is_valid(&example()));
    assert!(config::parse(&serde_json::to_vec(&example()).unwrap()).is_ok());
    for (pointer, value) in [
        ("/schema", json!(1)),
        ("/deployment", Value::Null),
        ("/deployment/branch", json!("main")),
        ("/deployment/repository", json!("-invalid/repo")),
        ("/onePassword", Value::Null),
        ("/onePassword/backupVault", json!("")),
        ("/hosts/build-mac/adminUID", json!(500)),
        ("/hosts/build-mac/authorizedKeys", json!(["   "])),
        ("/hosts/build-mac/adminUser", json!("-root")),
        ("/tailscale/tag", json!("not-a-tag")),
        ("/hosts/build-mac/services", json!(["invalid name"])),
    ] {
        let mut invalid = example();
        *invalid.pointer_mut(pointer).unwrap() = value;
        assert!(
            !validator.is_valid(&invalid),
            "constraint not enforced: {pointer}"
        );
        // Version 1 remains readable for history; invalid field values do not.
        if pointer != "/schema" {
            assert!(config::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
        }
    }
}

#[test]
fn historical_config_is_readable_but_v2_requires_independent_backup_vault() {
    let mut value = example();
    value.as_object_mut().unwrap().remove("onePassword");
    let error = config::parse(&serde_json::to_vec(&value).unwrap()).unwrap_err();
    assert_eq!(error.path, "$.onePassword.backupVault");
    value["schema"] = json!(1);
    assert!(config::parse(&serde_json::to_vec(&value).unwrap()).is_ok());
    value["schema"] = json!(2);
    value["onePassword"] = json!({"backupVault":"Recovery"});
    value["tailscale"]["oauth"] = Value::Null;
    assert!(config::parse(&serde_json::to_vec(&value).unwrap()).is_ok());
}

#[test]
fn retired_activation_milestone_is_readable_but_never_written_or_required() {
    let current = example();
    let expected = config::parse(&serde_json::to_vec(&current).unwrap()).unwrap();
    for old_value in [false, true] {
        let mut historical = current.clone();
        historical["hosts"]["build-mac"]["activationReady"] = json!(old_value);
        let parsed = config::parse(&serde_json::to_vec(&historical).unwrap()).unwrap();
        assert_eq!(parsed, expected);
        assert!(
            serde_json::to_value(parsed).unwrap()["hosts"]["build-mac"]
                .get("activationReady")
                .is_none()
        );
    }
    let mut invalid = current;
    invalid["hosts"]["build-mac"]["activationReady"] = json!("secret-not-a-bool");
    assert!(config::parse(&serde_json::to_vec(&invalid).unwrap()).is_err());
}

#[test]
fn diagnostics_never_echo_invalid_values_or_unknown_field_names() {
    for bytes in [
        br#"{"ATTACKER_SECRET_FIELD":"SENSITIVE_VALUE"}"#.as_slice(),
        br#"{"schema":"SENSITIVE_VALUE"}"#.as_slice(),
        br#"{"schema":2,"hosts":{"SENSITIVE_VALUE":{"adminUID":"SECRET"}}}"#.as_slice(),
    ] {
        let error = config::parse(bytes).unwrap_err().to_string();
        for forbidden in ["ATTACKER", "SENSITIVE", "SECRET"] {
            assert!(!error.contains(forbidden));
        }
    }
}

#[test]
fn file_validation_rejects_nonregular_and_oversized_inputs() {
    let directory = tempfile::tempdir().unwrap();
    assert!(config::validate_file(directory.path()).is_err());
    let path = directory.path().join("large.json");
    std::fs::write(&path, vec![b' '; 65537]).unwrap();
    assert!(config::validate_file(&path).is_err());
    assert_eq!(
        config::parse(br#"{"schema":2,"hosts":{"untrusted-name":{"adminUID":"bad"}}}"#)
            .unwrap_err()
            .path,
        "$.hosts.*.adminUID"
    );
}

#[test]
fn offline_cli_needs_neither_home_terminal_nor_schema_fetch() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("homelab.json");
    let mut value = example();
    value["$schema"] = json!("https://unreachable.invalid/never-fetch-this");
    std::fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .env_clear()
        .args(["config", "validate"])
        .arg(&path)
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .env_clear()
        .args(["config", "schema"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        serde_json::from_slice::<Value>(&output.stdout).unwrap(),
        config::schema()
    );
    std::fs::write(&path, b"{\"ATTACKER_SECRET_FIELD\":123}").unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_homelab"))
        .env_clear()
        .args(["config", "validate"])
        .arg(&path)
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(output.stdout.is_empty());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("ATTACKER"));
}
