//! First-enrollment gate only. Comin owns all subsequent Git reconciliation.
use std::fs;
use std::os::unix::fs::MetadataExt;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::Command;

use crate::bootstrap_privileged::Error;

fn ready(
    root: &Path,
    owner: u32,
    completed: impl FnOnce() -> Result<bool, Error>,
) -> Result<bool, Error> {
    let metadata = match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        result => result.map_err(|_| Error::VerificationUnconfirmed)?,
    };
    if !metadata.is_dir() || metadata.uid() != owner || metadata.mode() & 0o7777 != 0o700 {
        return Err(Error::VerificationUnconfirmed);
    }
    match fs::symlink_metadata(root.join("hold")) {
        Ok(_) => Ok(false),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => completed(),
        Err(_) => Err(Error::VerificationUnconfirmed),
    }
}

pub fn run(executable: &Path, config: &Path) -> Result<(), Error> {
    if rustix::process::geteuid().as_raw() != 0 {
        return Err(Error::VerificationUnconfirmed);
    }
    if !ready(
        Path::new("/var/lib/homelab"),
        0,
        crate::setup_report::has_completion,
    )? {
        return Ok(());
    }
    let executable =
        crate::bootstrap_privileged::trusted_store_path(executable, Path::new("/nix/store"), 0)?;
    let config =
        crate::bootstrap_privileged::trusted_store_path(config, Path::new("/nix/store"), 0)?;
    // Replace this process so launchd supervises Comin directly. There is no
    // background child or second polling/rebuild implementation to maintain.
    let _error = Command::new(executable)
        .args(["run", "--config"])
        .arg(config)
        .exec();
    Err(Error::VerificationUnconfirmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{PermissionsExt, symlink};

    #[test]
    fn first_enrollment_requires_both_released_hold_and_completion() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("state");
        let owner = rustix::process::geteuid().as_raw();
        assert!(!ready(&root, owner, || panic!("missing enrollment")).unwrap());
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        fs::write(root.join("hold"), "retained across reboot").unwrap();
        assert!(!ready(&root, owner, || panic!("held enrollment")).unwrap());
        fs::remove_file(root.join("hold")).unwrap();
        assert!(!ready(&root, owner, || Ok(false)).unwrap());
        assert!(ready(&root, owner, || Ok(true)).unwrap());
        symlink(temporary.path().join("missing"), root.join("hold")).unwrap();
        assert!(
            !ready(&root, owner, || panic!(
                "even an invalid hold blocks startup"
            ))
            .unwrap()
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o777)).unwrap();
        assert!(ready(&root, owner, || Ok(true)).is_err());
    }
}
