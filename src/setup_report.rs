//! Public, root-authenticated verification results for the SSH client.
//! Interactive sudo keeps its terminal; its result is read separately over SSH.
use std::fs::{self, File};
use std::io::Read;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, PermissionsExt};
use std::path::Path;

use crate::bootstrap_privileged::{Error, VerifiedSetup};
use rustix::fs::{Mode, OFlags, open};

const DIRECTORY: &str = "/var/db/homelab-setup";

pub(crate) fn valid_binding(binding: &str) -> bool {
    binding.len() == 64
        && binding
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate(report: &VerifiedSetup) -> Result<(), Error> {
    if report.schema != 1
        || !valid_binding(&report.request_id)
        || !valid_binding(&report.binding)
        || !crate::config::valid_revision(&report.main_revision)
        || !crate::bootstrap_privileged::valid_boot_session(&report.boot_session)
        || report.tailscale.addresses.is_empty()
        || report.tailscale.dns_name.is_empty()
        || (report.completed && !report.rebooted)
        || (report.completed && report.completed_at.is_none_or(|timestamp| timestamp <= 0))
        || report
            .reconciled_revision
            .as_ref()
            .is_some_and(|revision| !report.completed || !crate::config::valid_revision(revision))
        || !report.system.starts_with("/nix/store")
        || report.system.parent() != Some(Path::new("/nix/store"))
        || report
            .system
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Error::VerificationUnconfirmed);
    }
    Ok(())
}

fn directory(path: &Path, owner: u32) -> Result<(), Error> {
    let metadata = fs::symlink_metadata(path).map_err(|_| Error::VerificationUnconfirmed)?;
    if !metadata.is_dir() || metadata.uid() != owner || metadata.mode() & 0o7777 != 0o755 {
        return Err(Error::VerificationUnconfirmed);
    }
    Ok(())
}

pub fn publish(report: &VerifiedSetup) -> Result<(), Error> {
    publish_at(Path::new(DIRECTORY), 0, report)
}

pub(crate) fn save_completion(report: &VerifiedSetup) -> Result<(), Error> {
    if !report.completed || !report.rebooted {
        return Err(Error::VerificationUnconfirmed);
    }
    directory(Path::new(DIRECTORY), 0)?;
    publish_at(&Path::new(DIRECTORY).join("completed"), 0, report)
}

pub fn completion(binding: &str) -> Result<Option<VerifiedSetup>, Error> {
    completion_at(Path::new(DIRECTORY), 0, binding)
}

pub(crate) fn has_completion() -> Result<bool, Error> {
    let root = Path::new(DIRECTORY);
    match fs::symlink_metadata(root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        _ => directory(root, 0)?,
    }
    let completed = root.join("completed");
    match fs::symlink_metadata(&completed) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        _ => directory(&completed, 0)?,
    }
    for (index, entry) in fs::read_dir(completed)
        .map_err(|_| Error::VerificationUnconfirmed)?
        .enumerate()
    {
        if index >= 128 {
            return Err(Error::VerificationUnconfirmed);
        }
        let entry = entry.map_err(|_| Error::VerificationUnconfirmed)?;
        let name = entry.file_name();
        if let Some(binding) = name.to_str().and_then(|name| name.strip_suffix(".json"))
            && valid_binding(binding)
            && completion(binding)?.is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn completion_at(
    directory_path: &Path,
    owner: u32,
    binding: &str,
) -> Result<Option<VerifiedSetup>, Error> {
    if !valid_binding(binding) {
        return Err(Error::VerificationUnconfirmed);
    }
    match fs::symlink_metadata(directory_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => directory(directory_path, owner)?,
    }
    let root = directory_path.join("completed");
    match fs::symlink_metadata(&root) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        _ => directory(&root, owner)?,
    }
    match fs::symlink_metadata(root.join(format!("{binding}.json"))) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        _ => {
            let report = read_record_at(&root, owner, binding)?;
            if !report.completed || !report.rebooted {
                return Err(Error::VerificationUnconfirmed);
            }
            Ok(Some(report))
        }
    }
}

fn publish_at(root: &Path, owner: u32, report: &VerifiedSetup) -> Result<(), Error> {
    validate(report)?;
    if rustix::process::geteuid().as_raw() != owner {
        return Err(Error::VerificationUnconfirmed);
    }
    match fs::DirBuilder::new().mode(0o755).create(root) {
        Ok(()) => {
            // sudo may retain a private umask; clients must still be able to read
            // these public results. Never loosen a pre-existing directory.
            fs::set_permissions(root, fs::Permissions::from_mode(0o755))
                .and_then(|()| File::open(root)?.sync_all())
                .map_err(|_| Error::VerificationUnconfirmed)?;
            File::open(root.parent().ok_or(Error::VerificationUnconfirmed)?)
                .and_then(|file| file.sync_all())
                .map_err(|_| Error::VerificationUnconfirmed)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(Error::VerificationUnconfirmed),
    }
    directory(root, owner)?;
    let mut file =
        tempfile::NamedTempFile::new_in(root).map_err(|_| Error::VerificationUnconfirmed)?;
    serde_json::to_writer(&mut file, report).map_err(|_| Error::VerificationUnconfirmed)?;
    file.as_file()
        .set_permissions(fs::Permissions::from_mode(0o644))
        .and_then(|()| file.as_file().sync_all())
        .map_err(|_| Error::VerificationUnconfirmed)?;
    file.persist(root.join(format!("{}.json", report.binding)))
        .map_err(|_| Error::VerificationUnconfirmed)?;
    File::open(root)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::VerificationUnconfirmed)
}

pub fn read(binding: &str, request_id: &str) -> Result<VerifiedSetup, Error> {
    read_at(Path::new(DIRECTORY), 0, binding, request_id)
}

fn read_at(
    root: &Path,
    owner: u32,
    binding: &str,
    request_id: &str,
) -> Result<VerifiedSetup, Error> {
    if !valid_binding(binding) || !valid_binding(request_id) {
        return Err(Error::VerificationUnconfirmed);
    }
    let report = read_record_at(root, owner, binding)?;
    if report.request_id != request_id {
        return Err(Error::VerificationUnconfirmed);
    }
    Ok(report)
}

fn read_record_at(root: &Path, owner: u32, binding: &str) -> Result<VerifiedSetup, Error> {
    if !valid_binding(binding) {
        return Err(Error::VerificationUnconfirmed);
    }
    directory(root, owner)?;
    let file = File::from(
        open(
            root.join(format!("{binding}.json")),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| Error::VerificationUnconfirmed)?,
    );
    let metadata = file
        .metadata()
        .map_err(|_| Error::VerificationUnconfirmed)?;
    if !metadata.is_file() || metadata.uid() != owner || metadata.mode() & 0o7777 != 0o644 {
        return Err(Error::VerificationUnconfirmed);
    }
    let mut bytes = Vec::new();
    file.take(16385)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::VerificationUnconfirmed)?;
    if bytes.len() > 16384 {
        return Err(Error::VerificationUnconfirmed);
    }
    let report: VerifiedSetup =
        serde_json::from_slice(&bytes).map_err(|_| Error::VerificationUnconfirmed)?;
    validate(&report)?;
    if report.binding != binding {
        return Err(Error::VerificationUnconfirmed);
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_install_has_no_completion_but_unsafe_report_state_is_rejected() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("reports");
        let owner = rustix::process::geteuid().as_raw();
        assert!(
            completion_at(&root, owner, &"a".repeat(64))
                .unwrap()
                .is_none()
        );
        assert!(!root.exists());
        fs::create_dir(&root).unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(completion_at(&root, owner, &"a".repeat(64)).is_err());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            completion_at(&root, owner, &"a".repeat(64))
                .unwrap()
                .is_none()
        );
        std::os::unix::fs::symlink(temporary.path().join("missing"), root.join("completed"))
            .unwrap();
        assert!(completion_at(&root, owner, &"a".repeat(64)).is_err());
    }

    #[test]
    fn report_publication_works_with_a_private_umask() {
        const CHILD: &str = "HOMELAB_TEST_REPORT_PRIVATE_UMASK";
        if std::env::var_os(CHILD).is_some() {
            rustix::process::umask(Mode::from_bits_truncate(0o077));
            public_report_is_atomic_bound_and_rejects_writable_or_linked_state();
            return;
        }
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "setup_report::tests::report_publication_works_with_a_private_umask",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            .status()
            .unwrap();
        assert!(status.success());
    }
    #[test]
    fn public_report_is_atomic_bound_and_rejects_writable_or_linked_state() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("reports");
        let owner = rustix::process::geteuid().as_raw();
        let report = VerifiedSetup {
            request_id: "c".repeat(64),
            schema: 1,
            main_revision: "a".repeat(40),
            system: "/nix/store/test-system".into(),
            binding: "b".repeat(64),
            rebooted: false,
            completed: false,
            completed_at: None,
            reconciled_revision: None,
            boot_session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into(),
            tailscale: crate::tailscale::VerifiedNode {
                dns_name: "test.example.ts.net".into(),
                addresses: vec!["100.80.1.2".parse().unwrap()],
            },
        };
        publish_at(&root, owner, &report).unwrap();
        assert_eq!(
            read_at(&root, owner, &report.binding, &report.request_id)
                .unwrap()
                .system,
            report.system
        );
        let path = root.join(format!("{}.json", report.binding));
        let contents = fs::read(&path).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        assert!(read_at(&root, owner, &report.binding, &report.request_id).is_err());
        fs::remove_file(&path).unwrap();
        let other = temporary.path().join("other");
        fs::write(&other, &contents).unwrap();
        std::os::unix::fs::symlink(&other, &path).unwrap();
        assert!(read_at(&root, owner, &report.binding, &report.request_id).is_err());
        publish_at(&root, owner, &report).unwrap();
        assert!(
            !fs::symlink_metadata(&path)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(fs::read(&other).unwrap(), contents);
        assert!(read_at(&root, owner, "../bad", &report.request_id).is_err());
        assert!(read_at(&root, owner, &report.binding, &"d".repeat(64)).is_err());
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(publish_at(&root, owner, &report).is_err());
        assert_eq!(fs::metadata(&root).unwrap().mode() & 0o7777, 0o700);
    }
}
