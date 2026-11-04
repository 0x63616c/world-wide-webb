use std::fs::{self, File};
use std::os::unix::fs::{PermissionsExt, symlink};

use homelab_client::inventory::{HostProfile, InventoryError, add, load};
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
    }
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
