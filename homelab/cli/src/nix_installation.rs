//! Read-only reconciliation of a completed Determinate installation.
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::MetadataExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use serde::Deserialize;

use crate::bootstrap_privileged::Error;

#[derive(Deserialize)]
struct Receipt {
    version: String,
    actions: Vec<Action>,
}
#[derive(Deserialize)]
struct Action {
    state: String,
    action: ActionName,
}
#[derive(Deserialize)]
struct ActionName {
    action_name: String,
}

fn completed_receipt(bytes: &[u8], version: &str) -> bool {
    let Ok(receipt) = serde_json::from_slice::<Receipt>(bytes) else {
        return false;
    };
    receipt.version == version
        && !receipt.actions.is_empty()
        && receipt
            .actions
            .iter()
            .all(|action| action.state == "Completed")
        && [
            "provision_nix",
            "configure_nix",
            "create_users_and_group",
            "configure_determinate_nixd_init_service",
        ]
        .iter()
        .all(|required| {
            receipt
                .actions
                .iter()
                .any(|action| action.action.action_name == *required)
        })
}

fn protected(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| {
        metadata.uid() == 0 && (metadata.file_type().is_symlink() || metadata.mode() & 0o022 == 0)
    })
}

/// Paths are fixed, not supplied by an operator or by the receipt.
pub fn verify(version: &str) -> Result<(), Error> {
    let failure = || Error::InstallationUnconfirmed;
    if !protected(Path::new("/nix")) {
        return Err(failure());
    }
    let file = File::from(
        open(
            "/nix/receipt.json",
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| failure())?,
    );
    let metadata = file.metadata().map_err(|_| failure())?;
    if !metadata.is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
        || metadata.len() > 1024 * 1024
    {
        return Err(failure());
    }
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| failure())?;
    if bytes.len() > 1024 * 1024 || !completed_receipt(&bytes, version) {
        return Err(failure());
    }
    let nix = Path::new("/nix/var/nix/profiles/default/bin/nix");
    // Resolve the profile into the immutable store before running anything as root.
    let store = Path::new("/nix/store");
    let resolved =
        crate::bootstrap_privileged::trusted_store_path(nix, store, 0).map_err(|_| failure())?;
    let store_metadata = fs::symlink_metadata(store).map_err(|_| failure())?;
    // Nix build users may create entries in a sticky store; they cannot replace
    // existing root-owned objects. Each resolved object is checked above.
    let protected_store = store_metadata.is_dir()
        && store_metadata.uid() == 0
        && store_metadata.mode() & 0o002 == 0
        && (store_metadata.mode() & 0o020 == 0 || store_metadata.mode() & 0o1000 != 0);
    if !resolved.is_file() || !protected_store || !nix.ancestors().all(protected) {
        return Err(failure());
    }
    let mut command = Command::new(resolved);
    command
        .args([
            "--extra-experimental-features",
            "nix-command",
            "store",
            "ping",
            "--store",
            "daemon",
        ])
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("HOME", "/var/root")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    if !crate::process::run_silent(&mut command, Duration::from_secs(30))
        .is_ok_and(|status| status.success())
    {
        return Err(failure());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn receipt() -> serde_json::Value {
        let actions = [
            "provision_nix",
            "configure_nix",
            "create_users_and_group",
            "configure_determinate_nixd_init_service",
        ]
        .map(|name| serde_json::json!({"state":"Completed", "action":{"action_name":name}}));
        serde_json::json!({"version":"3.24.1", "actions": actions})
    }
    fn valid(value: &serde_json::Value) -> bool {
        completed_receipt(&serde_json::to_vec(value).unwrap(), "3.24.1")
    }
    #[test]
    fn requires_expected_version_and_every_action_completed() {
        assert!(valid(&receipt()));
        for state in ["Progress", "Uncompleted", "Skipped", "unknown"] {
            let mut value = receipt();
            value["actions"][0]["state"] = state.into();
            assert!(!valid(&value));
        }
        let mut value = receipt();
        value["version"] = "3.24.2".into();
        assert!(!valid(&value));
    }
    #[test]
    fn empty_missing_or_malformed_receipts_are_not_confirmation() {
        for value in [
            serde_json::json!({}),
            serde_json::json!({"version":"3.24.1","actions":[]}),
            serde_json::json!({"version":"3.24.1","actions":[{"state":"Completed","action":{"action_name":"unknown"}}]}),
        ] {
            assert!(!valid(&value));
        }
        assert!(!completed_receipt(b"not json", "3.24.1"));
    }
}
