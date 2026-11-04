use homelab_client::provisioning::{BaseTokens, Error, Session, Tools};
use std::{
    fs,
    os::unix::fs::{MetadataExt, PermissionsExt, symlink},
    path::PathBuf,
};

fn executable(name: &str, variable: &str) -> PathBuf {
    if let Some(path) = std::env::var_os(variable) {
        return path.into();
    }
    std::env::split_paths(&std::env::var_os("PATH").unwrap())
        .map(|directory| directory.join(name))
        .find(|path| path.is_file())
        .expect("real age and SOPS tools must be available in the test environment")
}
fn tools() -> Tools {
    Tools {
        age_keygen: executable("age-keygen", "HOMELAB_TEST_AGE_KEYGEN"),
        sops: executable("sops", "HOMELAB_TEST_SOPS"),
    }
}
fn tokens() -> BaseTokens {
    BaseTokens {
        github_read: "synthetic-github-token-with-\"quote".into(),
        tailscale_auth: "synthetic-tailscale-token".into(),
    }
}

#[test]
fn real_tools_prepare_dual_recipient_ciphertext_and_resume_without_replacing_keys_or_tokens() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("state");
    let tools = tools();
    let mut session = Session::open("homelab-macbook", &root, &tools).unwrap();
    let initial = session.details();
    assert_ne!(initial.host_recipient, initial.recovery_recipient);
    let host_inode = fs::metadata(&initial.host_key_path).unwrap().ino();
    let recovery_inode = fs::metadata(&initial.recovery_key_path).unwrap().ino();
    assert!(matches!(
        Session::open("homelab-macbook", &root, &tools),
        Err(Error::Busy)
    ));
    let details = session.encrypt(tokens()).unwrap();
    assert!(details.completed);
    let ciphertext = fs::read_to_string(&details.ciphertext_path).unwrap();
    assert!(!ciphertext.contains("synthetic-github"));
    assert!(!ciphertext.contains("synthetic-tailscale"));
    let files: Vec<_> = fs::read_dir(&details.review_directory)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(files.len(), 4);
    for path in [
        &details.host_key_path,
        &details.recovery_key_path,
        &details.github_token_path,
        &details.ciphertext_path,
    ] {
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
    assert_eq!(
        fs::read_to_string(&details.github_token_path).unwrap(),
        tokens().github_read
    );
    assert!(matches!(
        session.encrypt(tokens()),
        Err(Error::AlreadyCompleted)
    ));
    drop(session);
    let resumed = Session::open("homelab-macbook", &root, &tools).unwrap();
    assert!(resumed.details().completed);
    assert_eq!(
        fs::metadata(&details.host_key_path).unwrap().ino(),
        host_inode
    );
    assert_eq!(
        fs::metadata(&details.recovery_key_path).unwrap().ino(),
        recovery_inode
    );
    assert_eq!(
        fs::read_to_string(&details.ciphertext_path).unwrap(),
        ciphertext
    );
    drop(resumed);
    let document: serde_json::Value = serde_json::from_str(&ciphertext).unwrap();
    for tamper in ["plaintext", "recipient", "provider"] {
        let mut changed = document.clone();
        match tamper {
            "plaintext" => changed["github-read-token"] = serde_json::json!("not encrypted"),
            "recipient" => {
                changed["sops"]["age"][0]["recipient"] = serde_json::json!("unapproved recipient")
            }
            _ => changed["sops"]["kms"] = serde_json::json!([{"arn":"unexpected"}]),
        }
        fs::write(
            &details.ciphertext_path,
            serde_json::to_vec(&changed).unwrap(),
        )
        .unwrap();
        assert!(matches!(
            Session::open("homelab-macbook", &root, &tools),
            Err(Error::Encryption)
        ));
    }
    fs::write(&details.ciphertext_path, &ciphertext).unwrap();
    for key in [&details.host_key_path, &details.recovery_key_path] {
        let retained = temporary.path().join("retained-key");
        fs::rename(key, &retained).unwrap();
        assert!(matches!(
            Session::open("homelab-macbook", &root, &tools),
            Err(Error::Interrupted)
        ));
        assert!(!key.exists(), "a missing original identity was regenerated");
        if key == &details.recovery_key_path {
            assert!(matches!(
                Session::open("homelab-mac-mini", &root, &tools),
                Err(Error::Interrupted)
            ));
            assert!(!key.exists());
        }
        fs::rename(retained, key).unwrap();
    }
}

#[test]
fn unsafe_locations_partial_generation_and_invalid_tokens_fail_without_publication() {
    let temporary = tempfile::tempdir().unwrap();
    let tools = tools();
    let shared = temporary.path().join("shared");
    fs::create_dir(&shared).unwrap();
    fs::set_permissions(&shared, fs::Permissions::from_mode(0o755)).unwrap();
    assert!(matches!(
        Session::open("homelab-macbook", &shared, &tools),
        Err(Error::UnsafeState)
    ));
    let linked = temporary.path().join("linked");
    symlink(&shared, &linked).unwrap();
    assert!(matches!(
        Session::open("homelab-macbook", &linked, &tools),
        Err(Error::UnsafeState)
    ));
    let root = temporary.path().join("private");
    let mut session = Session::open("homelab-macbook", &root, &tools).unwrap();
    let details = session.details();
    assert!(matches!(
        session.encrypt(BaseTokens {
            github_read: "token\nsecond-line".into(),
            tailscale_auth: "synthetic".into()
        }),
        Err(Error::InvalidToken)
    ));
    assert!(!details.review_directory.exists());
    assert!(!details.github_token_path.exists());
    drop(session);
    let marker = details.host_key_path.with_extension("creating");
    fs::write(marker, b"interrupted").unwrap();
    assert!(matches!(
        Session::open("homelab-macbook", &root, &tools),
        Err(Error::Interrupted)
    ));
    assert!(details.host_key_path.exists());
}

#[test]
fn failed_sops_output_is_never_published_and_keys_remain_reusable() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("state");
    let mut tools = tools();
    tools.sops = "/usr/bin/false".into();
    let mut session = Session::open("homelab-macbook", &root, &tools).unwrap();
    let details = session.details();
    assert!(matches!(session.encrypt(tokens()), Err(Error::Encryption)));
    assert!(!details.review_directory.exists());
    assert!(!details.github_token_path.exists());
    drop(session);
    assert!(Session::open("homelab-macbook", &root, &tools).is_ok());
}
