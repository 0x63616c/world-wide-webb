use std::fs::{self, File};
use std::os::unix::fs::{PermissionsExt, symlink};

use homelab_client::inventory::{
    AgentIdentity, HostProfile, InventoryError, add, load, set_configuration, set_identity,
};
use rustix::fs::{FlockOperation, flock};
use serde_json::json;

fn private_directory() -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    directory
}

fn profile(name: &str) -> HostProfile {
    HostProfile {
        name: name.to_owned(),
        address: "example-host".to_owned(),
        user: "operator".to_owned(),
        identity: None,
        configuration_host: None,
    }
}

#[test]
fn remembered_agent_key_survives_reload_and_rejects_stale_updates() {
    let directory = private_directory();
    let path = directory.path().join("private/inventory.json");
    let first = profile("first");
    let second = profile("second");
    add(&path, first.clone()).unwrap();
    add(&path, second.clone()).unwrap();
    let identity = AgentIdentity {
        public_key: "ssh-ed25519 AAAA".into(),
        agent_socket: "/Users/example/Library/Group Containers/example/agent.sock".into(),
    };
    // Agent availability is a connection concern, not an inventory prerequisite.
    let updated = set_identity(&path, &first, Some(identity.clone())).unwrap();
    assert_eq!(updated.identity, Some(identity));
    assert_eq!(load(&path).unwrap(), [updated.clone(), second.clone()]);
    let saved = fs::read(&path).unwrap();
    assert_eq!(
        set_identity(&path, &first, None),
        Err(InventoryError::Changed)
    );
    assert_eq!(fs::read(&path).unwrap(), saved);
    let mut wrong_target = updated.clone();
    wrong_target.address = "different-host".into();
    assert_eq!(
        set_identity(&path, &wrong_target, None),
        Err(InventoryError::Changed)
    );
    assert_eq!(fs::read(&path).unwrap(), saved);
    assert_eq!(set_identity(&path, &updated, None).unwrap(), first.clone());
    assert_eq!(load(&path).unwrap(), [first, second]);
}

#[test]
fn invalid_agent_metadata_never_overwrites_saved_inventory() {
    let directory = private_directory();
    let path = directory.path().join("private/inventory.json");
    let host = profile("first");
    add(&path, host.clone()).unwrap();
    let saved = fs::read(&path).unwrap();
    for (key, socket) in [
        ("-----BEGIN OPENSSH PRIVATE KEY-----", "/tmp/agent.sock"),
        ("ssh-ed25519 AAAA comment", "/tmp/agent.sock"),
        ("ssh-ed25519 AAAA", "relative.sock"),
        ("ssh-ed25519 AAAA", "/tmp/agent\nInjected.sock"),
    ] {
        let identity = AgentIdentity {
            public_key: key.into(),
            agent_socket: socket.into(),
        };
        assert_eq!(
            set_identity(&path, &host, Some(identity)),
            Err(InventoryError::Invalid)
        );
        assert_eq!(fs::read(&path).unwrap(), saved);
    }
    let legacy = serde_json::json!({"schema": 1, "hosts": [{"name": "old", "address": "example", "user": "admin"}]});
    fs::write(&path, serde_json::to_vec(&legacy).unwrap()).unwrap();
    assert!(load(&path).unwrap()[0].identity.is_none());
}

#[test]
fn agent_metadata_cannot_make_the_saved_inventory_unreadable_by_size() {
    let directory = private_directory();
    let path = directory.path().join("private/inventory.json");
    for index in 0..5 {
        let mut host = profile(&format!("host-{index}"));
        host.identity = Some(AgentIdentity {
            public_key: format!("ssh-rsa {}", "A".repeat(12000)),
            agent_socket: "/tmp/agent.sock".into(),
        });
        add(&path, host).unwrap();
    }
    let last = profile("last");
    add(&path, last.clone()).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        set_identity(
            &path,
            &last,
            Some(AgentIdentity {
                public_key: format!("ssh-rsa {}", "A".repeat(12000)),
                agent_socket: "/tmp/agent.sock".into(),
            })
        ),
        Err(InventoryError::TooLarge)
    );
    assert_eq!(fs::read(&path).unwrap(), before);
    assert_eq!(load(&path).unwrap().len(), 6);
}

#[test]
fn saves_and_reloads_private_profiles() {
    let directory = private_directory();
    let path = directory.path().join("private/inventory.json");
    assert_eq!(load(&path), Err(InventoryError::Missing));
    assert_eq!(
        add(&path, profile("first")).unwrap(),
        vec![profile("first")]
    );
    let expected = vec![profile("first"), profile("second")];
    assert_eq!(add(&path, profile("second")).unwrap(), expected);
    assert_eq!(load(&path).unwrap(), expected);
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(path.parent().unwrap())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
}

#[test]
fn invalid_schema_and_extra_fields_are_rejected() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    for data in [
        json!({"schema": 2, "hosts": [profile("first")]}),
        json!({"schema": true, "hosts": [profile("first")]}),
        json!({"schema": 1, "hosts": []}),
        json!({"schema": 1, "hosts": [profile("first")], "command": "unexpected"}),
        json!({"schema": 1, "hosts": [{"name": "first", "address": "host", "user": "operator", "password": "fixture"}]}),
        json!({"schema": 1, "hosts": [{"name": "first", "address": "host"}]}),
        json!(["schema", "hosts"]),
    ] {
        fs::write(&path, serde_json::to_vec(&data).unwrap()).unwrap();
        assert_eq!(load(&path), Err(InventoryError::Invalid));
    }
}

#[test]
fn host_fields_accept_only_the_existing_ascii_contract() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    for value in [
        "",
        "-oProxyCommand=bad",
        "a;bad",
        "host\nother",
        "éxample",
        "a:b",
        "a/b",
    ] {
        for field in 0..3 {
            let mut host = profile("first");
            match field {
                0 => host.name = value.to_owned(),
                1 => host.address = value.to_owned(),
                _ => host.user = value.to_owned(),
            }
            assert_eq!(add(&path, host), Err(InventoryError::Invalid));
            assert!(!path.exists());
        }
    }
    assert_eq!(
        add(&path, profile(&"a".repeat(254))),
        Err(InventoryError::Invalid)
    );
    let mut host = profile(&"a".repeat(253));
    host.address = "host.example-1".to_owned();
    host.user = "user_1".to_owned();
    assert_eq!(add(&path, host.clone()).unwrap(), vec![host]);
}

#[test]
fn duplicate_and_full_inventory_preserve_existing_bytes() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    add(&path, profile("first")).unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(
        add(&path, profile("first")),
        Err(InventoryError::DuplicateName)
    );
    assert_eq!(fs::read(&path).unwrap(), before);

    let hosts: Vec<_> = (0..32)
        .map(|index| profile(&format!("host-{index}")))
        .collect();
    fs::write(
        &path,
        serde_json::to_vec(&json!({"schema": 1, "hosts": hosts})).unwrap(),
    )
    .unwrap();
    let before = fs::read(&path).unwrap();
    assert_eq!(add(&path, profile("extra")), Err(InventoryError::Full));
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn invalid_existing_inventory_is_not_replaced() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    for bytes in [b"{malformed".as_slice(), b"", b"\xff\xfe"] {
        fs::write(&path, bytes).unwrap();
        assert_eq!(add(&path, profile("first")), Err(InventoryError::Invalid));
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[test]
fn oversized_inventory_is_bounded_and_preserved() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    let bytes = vec![b' '; 65537];
    fs::write(&path, &bytes).unwrap();
    assert_eq!(load(&path), Err(InventoryError::TooLarge));
    assert_eq!(add(&path, profile("first")), Err(InventoryError::TooLarge));
    assert_eq!(fs::read(&path).unwrap(), bytes);
}

#[test]
fn symlink_inventory_is_readable_but_never_replaced() {
    let directory = private_directory();
    let target = directory.path().join("target.json");
    add(&target, profile("first")).unwrap();
    let before = fs::read(&target).unwrap();
    let path = directory.path().join("inventory.json");
    symlink(&target, &path).unwrap();
    assert_eq!(load(&path).unwrap(), vec![profile("first")]);
    assert_eq!(
        add(&path, profile("second")),
        Err(InventoryError::UnsafeLocation)
    );
    assert_eq!(fs::read(&target).unwrap(), before);
    assert!(path.is_symlink());
    fs::remove_file(&target).unwrap();
    assert_eq!(load(&path), Err(InventoryError::Invalid));
}

#[test]
fn unsafe_parent_and_symlink_parent_are_not_modified() {
    let directory = private_directory();
    let parent = directory.path().join("shared");
    fs::create_dir(&parent).unwrap();
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(
        add(&parent.join("inventory.json"), profile("first")),
        Err(InventoryError::UnsafeLocation)
    );
    assert_eq!(
        fs::metadata(&parent).unwrap().permissions().mode() & 0o777,
        0o755
    );
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
    fs::set_permissions(&parent, fs::Permissions::from_mode(0o700)).unwrap();
    let alias = directory.path().join("alias");
    symlink(&parent, &alias).unwrap();
    assert_eq!(
        add(&alias.join("inventory.json"), profile("first")),
        Err(InventoryError::UnsafeLocation)
    );
    assert_eq!(fs::read_dir(&parent).unwrap().count(), 0);
}

#[test]
fn inventory_named_lock_uses_a_distinct_lock_file() {
    let directory = private_directory();
    let path = directory.path().join("hosts.lock");
    add(&path, profile("first")).unwrap();
    assert_eq!(load(&path).unwrap(), vec![profile("first")]);
    assert!(directory.path().join("hosts.lock.lock").is_file());
}

#[test]
fn active_lock_prevents_save_and_does_not_release_other_holder() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    add(&path, profile("first")).unwrap();
    let before = fs::read(&path).unwrap();
    let lock_path = directory.path().join("inventory.json.lock");
    let lock = File::open(&lock_path).unwrap();
    flock(&lock, FlockOperation::NonBlockingLockExclusive).unwrap();
    assert_eq!(add(&path, profile("second")), Err(InventoryError::Busy));
    assert_eq!(fs::read(&path).unwrap(), before);
    let competing_lock = File::open(&lock_path).unwrap();
    assert!(flock(&competing_lock, FlockOperation::NonBlockingLockExclusive).is_err());
    drop(lock);
    assert_eq!(add(&path, profile("second")).unwrap().len(), 2);
}

#[test]
fn symlink_and_world_readable_locks_are_rejected() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    let lock = directory.path().join("inventory.json.lock");
    let other = directory.path().join("other");
    fs::write(&other, "preserve").unwrap();
    symlink(&other, &lock).unwrap();
    assert_eq!(
        add(&path, profile("first")),
        Err(InventoryError::UnsafeLocation)
    );
    assert_eq!(fs::read_to_string(&other).unwrap(), "preserve");
    fs::remove_file(&lock).unwrap();
    fs::write(&lock, "").unwrap();
    fs::set_permissions(&lock, fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        add(&path, profile("first")),
        Err(InventoryError::UnsafeLocation)
    );
    assert!(!path.exists());
}

#[test]
fn legacy_profiles_need_manifest_resolution_and_never_infer_from_address() {
    let old: HostProfile =
        serde_json::from_value(json!({"name":"old", "address":"build-mac", "user":"admin"}))
            .unwrap();
    assert_eq!(old.configuration_host, None);
    assert_eq!(old.resolved_configuration(), None);
    for name in ["build-mac", "service-mac"] {
        assert_eq!(profile(name).resolved_configuration(), None);
    }
    let mut bound = profile("build-mac");
    bound.configuration_host = Some("service-mac".into());
    assert_eq!(bound.resolved_configuration(), Some("service-mac"));
    bound.configuration_host = Some("../unsafe".into());
    assert_eq!(bound.resolved_configuration(), None);
    assert!(
        serde_json::to_value(old)
            .unwrap()
            .get("configuration_host")
            .is_none()
    );
}

#[test]
fn configuration_binding_is_durable_preserves_agent_and_rejects_stale_route() {
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    let mut host = profile("living-room");
    host.identity = Some(AgentIdentity {
        public_key: "ssh-ed25519 AAAA".into(),
        agent_socket: "/tmp/agent.sock".into(),
    });
    add(&path, host.clone()).unwrap();
    let bound = set_configuration(&path, &host, "service-mac").unwrap();
    assert_eq!(bound.resolved_configuration(), Some("service-mac"));
    assert_eq!(bound.identity, host.identity);
    assert_eq!(
        load(&path).unwrap().as_slice(),
        std::slice::from_ref(&bound)
    );
    let saved = fs::read(&path).unwrap();
    assert_eq!(
        set_configuration(&path, &host, "build-mac"),
        Err(InventoryError::Changed)
    );
    let mut changed_route = bound.clone();
    changed_route.address = "other-host".into();
    assert_eq!(
        set_configuration(&path, &changed_route, "build-mac"),
        Err(InventoryError::Changed)
    );
    for invalid in ["", "../macbook", "build-mac;false", "BUILD-MAC"] {
        assert_eq!(
            set_configuration(&path, &bound, invalid),
            Err(InventoryError::Invalid)
        );
    }
    assert_eq!(fs::read(&path).unwrap(), saved);
    let invalid = json!({"schema":1,"hosts":[{"name":"living-room","address":"example","user":"admin","configuration_host":"../unknown"}]});
    fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
    assert_eq!(load(&path), Err(InventoryError::Invalid));
}

#[test]
fn reviewed_git_connection_updates_cache_without_losing_other_profiles() {
    use homelab_client::inventory::save_connection;
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    let original = profile("build-mac");
    let other = profile("unrelated-alias");
    add(&path, original.clone()).unwrap();
    add(&path, other.clone()).unwrap();
    let mut updated = original.clone();
    updated.user = "git-admin".into();
    updated.configuration_host = Some("build-mac".into());
    assert_eq!(
        save_connection(&path, Some(&original), updated.clone()).unwrap(),
        updated
    );
    assert_eq!(load(&path).unwrap(), [updated.clone(), other]);
    assert_eq!(
        save_connection(&path, Some(&original), updated),
        Err(InventoryError::Changed)
    );
}

#[test]
fn connection_save_rechecks_bindings_added_since_review() {
    use homelab_client::inventory::save_connection;
    let directory = private_directory();
    let path = directory.path().join("inventory.json");
    let mut proposed = profile("build-mac");
    proposed.configuration_host = Some("build-mac".into());
    let mut competitor = profile("another-alias");
    competitor.configuration_host = Some("build-mac".into());
    add(&path, competitor.clone()).unwrap();
    assert_eq!(
        save_connection(&path, None, proposed.clone()),
        Err(InventoryError::Changed)
    );
    assert_eq!(load(&path).unwrap(), [competitor]);
    let second = directory.path().join("second.json");
    let mut saved = save_connection(&second, None, proposed.clone()).unwrap();
    saved.address = "reviewed-new-address.local".into();
    save_connection(&second, Some(&proposed), saved.clone()).unwrap();
    let mut renamed = saved.clone();
    renamed.name = "different-journal-name".into();
    assert_eq!(
        save_connection(&second, Some(&saved), renamed),
        Err(InventoryError::Changed)
    );
    assert_eq!(load(&second).unwrap(), [saved]);
}
