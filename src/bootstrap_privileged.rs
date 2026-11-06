//! Narrow elevated steps; the caller owns bootstrap approval and recovery state.

use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use rustix::fs::{FlockOperation, Mode, OFlags, flock, open};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::bootstrap_state::{Journal, Phase};
use crate::process;

const MAX_INSTALLER_BYTES: u64 = 100 * 1024 * 1024;
const SYSTEM_PATH: &str = "/usr/bin:/bin:/usr/sbin:/sbin";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Use a private, expected-owner installer file and its reviewed SHA256.")]
    InvalidInstaller,
    #[error("The private installer snapshot could not be prepared.")]
    PreparationFailed,
    #[error(
        "Nix installation could not be confirmed. Inspect the target before resuming bootstrap."
    )]
    InstallationUnconfirmed,
    #[error("Activation requires an immutable, root-owned built system in the Nix store.")]
    InvalidActivation,
    #[error(
        "System activation could not be confirmed. Inspect the target before resuming bootstrap."
    )]
    ActivationUnconfirmed,
    #[error(
        "Setup health verification did not pass. The update hold remains in place; retry verification after checking the target services."
    )]
    VerificationUnconfirmed,
    #[error(
        "Setup was verified and Git updates were released, but reconciliation is not yet confirmed. Resume to check the running updater; do not reinstall."
    )]
    ReconciliationUnconfirmed,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VerifiedSetup {
    pub request_id: String,
    pub schema: u8,
    pub main_revision: String,
    pub system: std::path::PathBuf,
    pub binding: String,
    pub rebooted: bool,
    pub completed: bool,
    pub completed_at: Option<i64>,
    pub reconciled_revision: Option<String>,
    pub boot_session: String,
    pub tailscale: crate::tailscale::VerifiedNode,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RebootRequest {
    Requested,
    AlreadyRequested,
    AlreadyRebooted,
}

fn record_reboot(directory: &Path, boot: &str) -> Result<RebootRequest, Error> {
    if !valid_boot_session(boot) {
        return Err(Error::VerificationUnconfirmed);
    }
    let metadata = fs::symlink_metadata(directory).map_err(|_| Error::VerificationUnconfirmed)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::VerificationUnconfirmed);
    }
    let path = directory.join("reboot-requested");
    match OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&path)
    {
        Ok(mut file) => {
            file.write_all(boot.to_ascii_lowercase().as_bytes())
                .and_then(|()| file.sync_all())
                .map_err(|_| Error::VerificationUnconfirmed)?;
            File::open(directory)
                .and_then(|file| file.sync_all())
                .map_err(|_| Error::VerificationUnconfirmed)?;
            Ok(RebootRequest::Requested)
        }
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let file = File::from(
                open(
                    &path,
                    OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
                    Mode::empty(),
                )
                .map_err(|_| Error::VerificationUnconfirmed)?,
            );
            let metadata = file
                .metadata()
                .map_err(|_| Error::VerificationUnconfirmed)?;
            if !metadata.is_file()
                || metadata.uid() != rustix::process::geteuid().as_raw()
                || metadata.mode() & 0o7777 != 0o600
            {
                return Err(Error::VerificationUnconfirmed);
            }
            let mut saved = String::new();
            file.take(37)
                .read_to_string(&mut saved)
                .map_err(|_| Error::VerificationUnconfirmed)?;
            if !valid_boot_session(&saved) {
                return Err(Error::VerificationUnconfirmed);
            }
            Ok(if saved.eq_ignore_ascii_case(boot) {
                RebootRequest::AlreadyRequested
            } else {
                RebootRequest::AlreadyRebooted
            })
        }
        Err(_) => Err(Error::VerificationUnconfirmed),
    }
}

pub fn request_reboot(
    system: &Path,
    binding: &str,
    repository: &str,
    host: &str,
    tag: &str,
    request_id: &str,
) -> Result<RebootRequest, Error> {
    let report = verify_setup(system, binding, repository, host, tag, request_id)?;
    crate::setup_report::publish(&report)?;
    if report.rebooted {
        return Ok(RebootRequest::AlreadyRebooted);
    }
    let result = record_reboot(
        &Path::new("/var/lib/homelab-bootstrap").join(binding),
        &report.boot_session,
    )?;
    if result == RebootRequest::Requested {
        let mut command = Command::new("/sbin/shutdown");
        command
            .args(["-r", "now"])
            .env_clear()
            .env("PATH", SYSTEM_PATH)
            .stdin(Stdio::null());
        // The durable marker intentionally survives a lost acknowledgement or a
        // failed shutdown request. Neither proves that repeating it is safe.
        if !process::run_silent(&mut command, Duration::from_secs(30))
            .is_ok_and(|status| status.success())
        {
            return Err(Error::VerificationUnconfirmed);
        }
    }
    Ok(result)
}

fn read_hold(root: &Path, system: &Path, binding: &str) -> Result<HoldRecord, Error> {
    let metadata = fs::symlink_metadata(root).map_err(|_| Error::InvalidActivation)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::InvalidActivation);
    }
    let file = File::from(
        open(
            root.join("hold"),
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::empty(),
        )
        .map_err(|_| Error::InvalidActivation)?,
    );
    decode_hold(&file, system, binding)
}

fn decode_hold(file: &File, system: &Path, binding: &str) -> Result<HoldRecord, Error> {
    let metadata = file.metadata().map_err(|_| Error::InvalidActivation)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o600
    {
        return Err(Error::InvalidActivation);
    }
    let mut bytes = Vec::new();
    file.take(8193)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::InvalidActivation)?;
    if bytes.len() > 8192 {
        return Err(Error::InvalidActivation);
    }
    let record: HoldRecord =
        serde_json::from_slice(&bytes).map_err(|_| Error::InvalidActivation)?;
    if record.schema != 1
        || record.system != system
        || record.binding != binding
        || !valid_boot_session(&record.initial_boot_session)
    {
        return Err(Error::InvalidActivation);
    }
    Ok(record)
}

pub fn verify_setup(
    system: &Path,
    binding: &str,
    repository: &str,
    host: &str,
    tag: &str,
    request_id: &str,
) -> Result<VerifiedSetup, Error> {
    if !crate::setup_report::valid_binding(request_id) {
        return Err(Error::VerificationUnconfirmed);
    }
    let system = trusted_store_path(system, Path::new("/nix/store"), 0)?;
    activation_status(&system, binding)?;
    let hold = read_hold(Path::new("/var/lib/homelab"), &system, binding)?;
    let boot_session = boot_session()?;
    let health = trusted_store_path(
        &system.join("sw/bin/homelab-health"),
        Path::new("/nix/store"),
        0,
    )?;
    let tailscale =
        trusted_store_path(&system.join("sw/bin/tailscale"), Path::new("/nix/store"), 0)?;
    let mut command = Command::new(health);
    command
        .env_clear()
        .env("PATH", SYSTEM_PATH)
        .env("HOME", "/var/root")
        .env("LC_ALL", "C")
        .stdin(Stdio::null());
    if !process::run_silent(&mut command, Duration::from_secs(180))
        .is_ok_and(|status| status.success())
    {
        return Err(Error::VerificationUnconfirmed);
    }
    let mut updater = Command::new("/bin/launchctl");
    updater
        .args(["print", "system/com.github.nlewo.comin"])
        .env_clear()
        .stdin(Stdio::null());
    if !process::run_silent(&mut updater, Duration::from_secs(10))
        .is_ok_and(|status| status.success())
    {
        return Err(Error::VerificationUnconfirmed);
    }
    let node = crate::tailscale::verify_node(&tailscale, host, tag)
        .map_err(|_| Error::VerificationUnconfirmed)?;
    let main_revision = crate::git_ssh::verify_read_access(
        Path::new("/usr/bin/git"),
        Path::new("/var/lib/homelab-git/key.txt"),
        repository,
    )
    .map_err(|_| Error::VerificationUnconfirmed)?;
    activation_status(&system, binding)?;
    let after = read_hold(Path::new("/var/lib/homelab"), &system, binding)?;
    if after.initial_boot_session != hold.initial_boot_session {
        return Err(Error::VerificationUnconfirmed);
    }
    Ok(VerifiedSetup {
        request_id: request_id.into(),
        schema: 1,
        main_revision,
        rebooted: !hold
            .initial_boot_session
            .eq_ignore_ascii_case(&boot_session),
        completed: false,
        completed_at: None,
        reconciled_revision: None,
        boot_session,
        system,
        binding: binding.into(),
        tailscale: node,
    })
}

pub fn complete_setup(
    system: &Path,
    binding: &str,
    repository: &str,
    host: &str,
    tag: &str,
    request_id: &str,
) -> Result<VerifiedSetup, Error> {
    let mut report = complete_with(
        Path::new("/var/lib/homelab"),
        system,
        binding,
        request_id,
        || crate::setup_report::completion(binding),
        || verify_setup(system, binding, repository, host, tag, request_id),
        crate::setup_report::save_completion,
    )?;
    report.reconciled_revision = Some(crate::comin::wait_for_reconciliation(
        repository,
        host,
        report
            .completed_at
            .ok_or(Error::ReconciliationUnconfirmed)?,
    )?);
    crate::setup_report::publish(&report)?;
    Ok(report)
}

fn complete_with(
    root: &Path,
    system: &Path,
    binding: &str,
    request_id: &str,
    read_completion: impl FnOnce() -> Result<Option<VerifiedSetup>, Error>,
    verify: impl FnOnce() -> Result<VerifiedSetup, Error>,
    save_completion: impl FnOnce(&VerifiedSetup) -> Result<(), Error>,
) -> Result<VerifiedSetup, Error> {
    if !crate::setup_report::valid_binding(binding)
        || !crate::setup_report::valid_binding(request_id)
        || system.parent() != Some(Path::new("/nix/store"))
        || system
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
    {
        return Err(Error::VerificationUnconfirmed);
    }
    let _lock = updater_lock(root)?;
    let mut report = match read_completion()? {
        Some(report) => report,
        None => {
            let mut report = verify()?;
            if !report.rebooted || report.binding != binding || report.system != system {
                return Err(Error::VerificationUnconfirmed);
            }
            report.completed = true;
            report.completed_at = Some(time::OffsetDateTime::now_utc().unix_timestamp());
            // Persist proof before releasing the hold. A lost acknowledgement can
            // then finish this transaction even after the updater advances main.
            save_completion(&report)?;
            report
        }
    };
    if !report.completed || !report.rebooted || report.binding != binding || report.system != system
    {
        return Err(Error::VerificationUnconfirmed);
    }
    let hold = root.join("hold");
    match fs::symlink_metadata(&hold) {
        Ok(_) => {
            read_hold(root, system, binding)?;
            fs::remove_file(&hold).map_err(|_| Error::VerificationUnconfirmed)?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err(Error::VerificationUnconfirmed),
    }
    File::open(root)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::VerificationUnconfirmed)?;
    report.request_id = request_id.into();
    Ok(report)
}

/// Execute a verified private snapshot, so replacing the download cannot change it.
pub fn install_nix(installer: &Path, expected_sha256: &str, owner_uid: u32) -> Result<(), Error> {
    if !installer.is_absolute()
        || expected_sha256.len() != 64
        || !expected_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Error::InvalidInstaller);
    }
    let mut source = File::from(
        open(
            installer,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::InvalidInstaller)?,
    );
    let metadata = source.metadata().map_err(|_| Error::InvalidInstaller)?;
    if !metadata.is_file()
        || metadata.uid() != owner_uid
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600 | 0o700)
        || metadata.len() == 0
        || metadata.len() > MAX_INSTALLER_BYTES
    {
        return Err(Error::InvalidInstaller);
    }
    let directory = tempfile::tempdir().map_err(|_| Error::PreparationFailed)?;
    fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::PreparationFailed)?;
    let snapshot = directory.path().join("nix-installer");
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&snapshot)
        .map_err(|_| Error::PreparationFailed)?;
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let count = source
            .read(&mut buffer)
            .map_err(|_| Error::InvalidInstaller)?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > MAX_INSTALLER_BYTES {
            return Err(Error::InvalidInstaller);
        }
        digest.update(&buffer[..count]);
        destination
            .write_all(&buffer[..count])
            .map_err(|_| Error::PreparationFailed)?;
    }
    let actual_sha256: String = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if total == 0 || actual_sha256 != expected_sha256 {
        return Err(Error::InvalidInstaller);
    }
    destination
        .set_permissions(fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::PreparationFailed)?;
    // Close the writable descriptor before executing the verified snapshot.
    drop(destination);
    let mut command = Command::new(&snapshot);
    command
        .args(["install", "--no-confirm"])
        .env_clear()
        .env("PATH", SYSTEM_PATH)
        .env("HOME", "/var/root")
        .env("LC_ALL", "C")
        .current_dir(directory.path())
        .stdin(Stdio::null());
    let status = process::run_silent(&mut command, Duration::from_secs(20 * 60))
        .map_err(|_| Error::InstallationUnconfirmed)?;
    if !status.success() {
        return Err(Error::InstallationUnconfirmed);
    }
    Ok(())
}

/// Switch the already reviewed build without evaluating its operator-owned checkout as root.
pub fn activate(system: &Path) -> Result<(), Error> {
    activate_built(
        system,
        Path::new("/nix/var/nix/profiles/default/bin/nix-env"),
        Path::new("/nix/var/nix/profiles/system"),
        Path::new("/nix/store"),
        0,
    )
}

fn activation_journal(system: &Path, binding: &str, root: &Path) -> Result<Journal, Error> {
    if binding.len() != 64 || !binding.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::InvalidActivation);
    }
    match fs::symlink_metadata(root) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::DirBuilder::new()
                .mode(0o700)
                .create(root)
                .map_err(|_| Error::ActivationUnconfirmed)?;
            File::open(root.parent().ok_or(Error::InvalidActivation)?)
                .and_then(|file| file.sync_all())
                .map_err(|_| Error::ActivationUnconfirmed)?;
        }
        Err(_) => return Err(Error::ActivationUnconfirmed),
    }
    let metadata = fs::symlink_metadata(root).map_err(|_| Error::ActivationUnconfirmed)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::ActivationUnconfirmed);
    }
    Journal::open_for_reconciliation(
        &root.join(binding),
        binding,
        "activation",
        system.to_str().ok_or(Error::InvalidActivation)?,
    )
    .map_err(|_| Error::ActivationUnconfirmed)
}

fn current_system_matches(system: &Path, profile: &Path) -> bool {
    profile
        .canonicalize()
        .is_ok_and(|current| current == system)
}

pub fn activation_status(system: &Path, binding: &str) -> Result<(), Error> {
    let system = trusted_store_path(system, Path::new("/nix/store"), 0)?;
    let root = Path::new("/var/lib/homelab-bootstrap");
    // A status probe must never manufacture a receipt for an absent attempt.
    if !root.join(binding).join("progress.json").exists() {
        return Err(Error::ActivationUnconfirmed);
    }
    let journal = activation_journal(&system, binding, root)?;
    if journal.phase() != Phase::Activated
        || journal.built_system() != Some(system.as_path())
        || !current_system_matches(&system, Path::new("/nix/var/nix/profiles/system"))
        || !current_system_matches(&system, Path::new("/run/current-system"))
    {
        return Err(Error::ActivationUnconfirmed);
    }
    Ok(())
}

pub fn activate_recorded(system: &Path, binding: &str) -> Result<(), Error> {
    let system = trusted_store_path(system, Path::new("/nix/store"), 0)?;
    let _hold = enrollment_hold(
        Path::new("/var/lib/homelab"),
        &system,
        binding,
        &boot_session()?,
    )?;
    recorded_activation(
        &system,
        binding,
        Path::new("/var/lib/homelab-bootstrap"),
        || activate(&system),
        || {
            current_system_matches(&system, Path::new("/nix/var/nix/profiles/system"))
                && current_system_matches(&system, Path::new("/run/current-system"))
        },
    )
}

struct EnrollmentHold {
    lock: File,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct HoldRecord {
    schema: u8,
    binding: String,
    system: std::path::PathBuf,
    initial_boot_session: String,
}

pub(crate) fn valid_boot_session(value: &str) -> bool {
    value.len() == 36
        && value.bytes().enumerate().all(|(index, byte)| {
            if [8, 13, 18, 23].contains(&index) {
                byte == b'-'
            } else {
                byte.is_ascii_hexdigit()
            }
        })
}

fn boot_session() -> Result<String, Error> {
    let mut command = Command::new("/usr/sbin/sysctl");
    command
        .args(["-n", "kern.bootsessionuuid"])
        .env_clear()
        .stdin(Stdio::null());
    let output = process::capture(&mut command, Duration::from_secs(10))
        .map_err(|_| Error::ActivationUnconfirmed)?;
    let value = std::str::from_utf8(&output.stdout)
        .map_err(|_| Error::ActivationUnconfirmed)?
        .trim();
    if !output.status.success() || !valid_boot_session(value) {
        return Err(Error::ActivationUnconfirmed);
    }
    Ok(value.to_ascii_lowercase())
}

impl Drop for EnrollmentHold {
    fn drop(&mut self) {
        // The persistent hold remains until verified completion, even on failure.
        let _ = flock(&self.lock, FlockOperation::Unlock);
    }
}

fn enrollment_hold(
    root: &Path,
    system: &Path,
    binding: &str,
    boot: &str,
) -> Result<EnrollmentHold, Error> {
    if !valid_boot_session(boot) {
        return Err(Error::InvalidActivation);
    }
    if binding.len() != 64 || !binding.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(Error::InvalidActivation);
    }
    let guard = updater_lock(root)?;
    let bytes = serde_json::to_vec(&HoldRecord {
        schema: 1,
        binding: binding.into(),
        system: system.into(),
        initial_boot_session: boot.to_ascii_lowercase(),
    })
    .map_err(|_| Error::InvalidActivation)?;
    let path = root.join("hold");
    match open(
        &path,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
        Mode::empty(),
    ) {
        Ok(descriptor) => {
            let file = File::from(descriptor);
            decode_hold(&file, system, binding)?;
            file.sync_all().map_err(|_| Error::ActivationUnconfirmed)?;
        }
        Err(rustix::io::Errno::NOENT) => {
            let mut file =
                tempfile::NamedTempFile::new_in(root).map_err(|_| Error::ActivationUnconfirmed)?;
            file.write_all(&bytes)
                .and_then(|()| file.as_file().sync_all())
                .map_err(|_| Error::ActivationUnconfirmed)?;
            file.persist_noclobber(&path)
                .map_err(|_| Error::ActivationUnconfirmed)?;
        }
        Err(_) => return Err(Error::InvalidActivation),
    }
    File::open(root)
        .and_then(|file| file.sync_all())
        .map_err(|_| Error::ActivationUnconfirmed)?;
    Ok(guard)
}

fn updater_lock(root: &Path) -> Result<EnrollmentHold, Error> {
    match fs::DirBuilder::new().mode(0o700).create(root) {
        Ok(()) => File::open(root.parent().ok_or(Error::InvalidActivation)?)
            .and_then(|file| file.sync_all())
            .map_err(|_| Error::ActivationUnconfirmed)?,
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(_) => return Err(Error::ActivationUnconfirmed),
    }
    let metadata = fs::symlink_metadata(root).map_err(|_| Error::InvalidActivation)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(Error::InvalidActivation);
    }
    let lock = File::from(
        open(
            root.join("update.lock"),
            OFlags::CREATE | OFlags::RDWR | OFlags::NOFOLLOW | OFlags::CLOEXEC | OFlags::NONBLOCK,
            Mode::RUSR | Mode::WUSR,
        )
        .map_err(|_| Error::InvalidActivation)?,
    );
    let metadata = lock.metadata().map_err(|_| Error::InvalidActivation)?;
    if !metadata.is_file()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o022 != 0
    {
        return Err(Error::InvalidActivation);
    }
    flock(&lock, FlockOperation::NonBlockingLockExclusive)
        .map_err(|_| Error::ActivationUnconfirmed)?;
    Ok(EnrollmentHold { lock })
}

fn recorded_activation(
    system: &Path,
    binding: &str,
    root: &Path,
    activate: impl FnOnce() -> Result<(), Error>,
    matches: impl Fn() -> bool,
) -> Result<(), Error> {
    let mut journal = activation_journal(system, binding, root)?;
    match journal.phase() {
        Phase::Activated if journal.built_system() == Some(system) && matches() => return Ok(()),
        Phase::Preparing => {}
        _ => return Err(Error::ActivationUnconfirmed),
    }
    journal
        .record(Phase::Activating, Some(system))
        .map_err(|_| Error::ActivationUnconfirmed)?;
    activate()?;
    if !matches() {
        return Err(Error::ActivationUnconfirmed);
    }
    journal
        .record(Phase::Activated, Some(system))
        .map_err(|_| Error::ActivationUnconfirmed)
}

pub(crate) fn trusted_store_path(
    path: &Path,
    store: &Path,
    owner: u32,
) -> Result<std::path::PathBuf, Error> {
    if !path.is_absolute() {
        return Err(Error::InvalidActivation);
    }
    let canonical = path.canonicalize().map_err(|_| Error::InvalidActivation)?;
    if canonical == store || !canonical.starts_with(store) {
        return Err(Error::InvalidActivation);
    }
    // The store itself may be group-writable; individual store objects must not be.
    for component in canonical
        .ancestors()
        .take_while(|component| *component != store)
    {
        let metadata = fs::symlink_metadata(component).map_err(|_| Error::InvalidActivation)?;
        if metadata.uid() != owner || metadata.mode() & 0o222 != 0 {
            return Err(Error::InvalidActivation);
        }
    }
    Ok(canonical)
}

fn activate_built(
    system: &Path,
    nix_env: &Path,
    profile: &Path,
    store: &Path,
    owner: u32,
) -> Result<(), Error> {
    let system = trusted_store_path(system, store, owner)?;
    if system.parent() != Some(store) || !system.is_dir() {
        return Err(Error::InvalidActivation);
    }
    let rebuild = system.join("sw/bin/darwin-rebuild");
    for executable in [&rebuild, nix_env] {
        let resolved = trusted_store_path(executable, store, owner)?;
        let metadata = fs::metadata(resolved).map_err(|_| Error::InvalidActivation)?;
        if !metadata.is_file() || metadata.mode() & 0o111 == 0 {
            return Err(Error::InvalidActivation);
        }
    }
    let deadline = Instant::now() + Duration::from_secs(30 * 60);
    let mut set_profile = Command::new(nix_env);
    set_profile.arg("-p").arg(profile).arg("--set").arg(&system);
    let mut activate = Command::new(rebuild);
    activate.args(["activate", "--no-flake"]);
    // Match nix-darwin's switch order. After the profile changes, any failure requires
    // inspection; automatic rollback could hide partially applied configuration.
    for command in [&mut set_profile, &mut activate] {
        command
            .env_clear()
            .env("PATH", SYSTEM_PATH)
            .env("HOME", "/var/root")
            .env("LC_ALL", "C")
            .env("NIX_REMOTE", "daemon")
            .current_dir("/")
            .stdin(Stdio::null());
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .ok_or(Error::ActivationUnconfirmed)?;
        let status =
            process::run_silent(command, remaining).map_err(|_| Error::ActivationUnconfirmed)?;
        if !status.success() {
            return Err(Error::ActivationUnconfirmed);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verified_report() -> VerifiedSetup {
        VerifiedSetup {
            schema: 1,
            request_id: "c".repeat(64),
            binding: "a".repeat(64),
            main_revision: "b".repeat(40),
            system: "/nix/store/test-system".into(),
            boot_session: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".into(),
            rebooted: true,
            completed: false,
            completed_at: None,
            reconciled_revision: None,
            tailscale: crate::tailscale::VerifiedNode {
                dns_name: "test.example.ts.net".into(),
                addresses: vec!["100.80.1.2".parse().unwrap()],
            },
        }
    }

    #[test]
    fn completion_keeps_hold_until_proof_is_durable_and_recovers_lost_ack() {
        use std::cell::RefCell;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("updates");
        let report = verified_report();
        drop(
            enrollment_hold(&root, &report.system, &report.binding, &report.boot_session).unwrap(),
        );
        let saved = RefCell::new(None);
        let first = complete_with(
            &root,
            &report.system,
            &report.binding,
            &report.request_id,
            || Ok(None),
            || {
                assert!(updater_lock(&root).is_err());
                Ok(report.clone())
            },
            |receipt| {
                assert!(updater_lock(&root).is_err());
                assert!(root.join("hold").exists());
                *saved.borrow_mut() = Some(receipt.clone());
                Err(Error::VerificationUnconfirmed)
            },
        );
        assert!(first.is_err());
        assert!(root.join("hold").exists());
        for _ in 0..2 {
            let recovered = complete_with(
                &root,
                &report.system,
                &report.binding,
                &"d".repeat(64),
                || Ok(saved.borrow().clone()),
                || panic!("durable completion does not rerun setup after updates resume"),
                |_| panic!("durable completion is not replaced"),
            )
            .unwrap();
            assert!(recovered.completed && recovered.rebooted);
            assert_eq!(recovered.request_id, "d".repeat(64));
            assert!(!root.join("hold").exists());
        }
    }

    #[test]
    fn completion_rejects_missing_proof_wrong_hold_and_unrebooted_host() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("updates");
        let report = verified_report();
        drop(
            enrollment_hold(&root, &report.system, &report.binding, &report.boot_session).unwrap(),
        );
        let mut before_reboot = report.clone();
        before_reboot.rebooted = false;
        assert!(
            complete_with(
                &root,
                &report.system,
                &report.binding,
                &report.request_id,
                || Ok(None),
                || Ok(before_reboot),
                |_| panic!("unrebooted host cannot complete"),
            )
            .is_err()
        );
        assert!(root.join("hold").exists());
        fs::write(root.join("hold"), b"maintenance").unwrap();
        let mut receipt = report.clone();
        receipt.completed = true;
        assert!(
            complete_with(
                &root,
                &report.system,
                &report.binding,
                &report.request_id,
                || Ok(Some(receipt)),
                || panic!("receipt exists"),
                |_| panic!("receipt exists"),
            )
            .is_err()
        );
        assert_eq!(fs::read(root.join("hold")).unwrap(), b"maintenance");
        fs::remove_file(root.join("hold")).unwrap();
        assert!(
            complete_with(
                &root,
                &report.system,
                &report.binding,
                &report.request_id,
                || Ok(None),
                || Err(Error::VerificationUnconfirmed),
                |_| panic!("no verified proof"),
            )
            .is_err()
        );
    }
    const BOOT: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    #[test]
    fn reboot_request_is_not_repeated_after_lost_acknowledgement() {
        let temporary = tempfile::tempdir().unwrap();
        fs::set_permissions(temporary.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert_eq!(
            record_reboot(temporary.path(), BOOT).unwrap(),
            RebootRequest::Requested
        );
        assert_eq!(
            record_reboot(temporary.path(), BOOT).unwrap(),
            RebootRequest::AlreadyRequested
        );
        assert_eq!(
            record_reboot(temporary.path(), "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap(),
            RebootRequest::AlreadyRebooted
        );
        let path = temporary.path().join("reboot-requested");
        assert_eq!(fs::read_to_string(&path).unwrap(), BOOT);
        fs::write(&path, b"interrupted").unwrap();
        assert!(record_reboot(temporary.path(), BOOT).is_err());
        assert_eq!(fs::read_to_string(&path).unwrap(), "interrupted");
    }

    #[test]
    fn enrollment_hold_excludes_updater_and_survives_activation_scope() {
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("updater");
        let system = Path::new("/nix/store/reviewed-system");
        let binding = "a".repeat(64);
        let guard = enrollment_hold(&root, system, &binding, BOOT).unwrap();
        let updater = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join("update.lock"))
            .unwrap();
        assert!(flock(&updater, FlockOperation::NonBlockingLockExclusive).is_err());
        let original = fs::read(root.join("hold")).unwrap();
        drop(guard);
        flock(&updater, FlockOperation::NonBlockingLockExclusive).unwrap();
        assert!(enrollment_hold(&root, system, &binding, BOOT).is_err());
        flock(&updater, FlockOperation::Unlock).unwrap();
        assert_eq!(fs::read(root.join("hold")).unwrap(), original);
        let saved = read_hold(&root, system, &binding).unwrap();
        assert_eq!(saved.initial_boot_session, BOOT);
        assert!(read_hold(&root, system, &"f".repeat(64)).is_err());
        drop(
            enrollment_hold(
                &root,
                system,
                &binding,
                "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee",
            )
            .unwrap(),
        );
        assert!(enrollment_hold(&root, system, &"b".repeat(64), BOOT).is_err());
        assert!(
            enrollment_hold(&root, Path::new("/nix/store/other-system"), &binding, BOOT).is_err()
        );
        assert_eq!(fs::read(root.join("hold")).unwrap(), original);
    }

    #[test]
    fn enrollment_cannot_replace_an_existing_maintenance_hold() {
        use std::os::unix::fs::symlink;
        let temporary = tempfile::tempdir().unwrap();
        let root = temporary.path().join("updater");
        fs::DirBuilder::new().mode(0o700).create(&root).unwrap();
        let path = root.join("hold");
        fs::write(&path, b"maintenance").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(
            enrollment_hold(&root, Path::new("/nix/store/system"), &"a".repeat(64), BOOT).is_err()
        );
        assert_eq!(fs::read(&path).unwrap(), b"maintenance");
        fs::remove_file(&path).unwrap();
        symlink(temporary.path().join("missing"), &path).unwrap();
        assert!(matches!(
            enrollment_hold(&root, Path::new("/nix/store/system"), &"a".repeat(64), BOOT),
            Err(Error::InvalidActivation)
        ));
    }
    use std::path::PathBuf;

    #[test]
    fn activation_receipt_confirms_success_but_never_replays_an_unknown_result() {
        use std::cell::Cell;
        for successful in [false, true] {
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path().join("receipts");
            let system = directory.path().join("system");
            let binding = "a".repeat(64);
            let calls = Cell::new(0);
            let action = || {
                calls.set(calls.get() + 1);
                if successful {
                    Ok(())
                } else {
                    Err(Error::ActivationUnconfirmed)
                }
            };
            let first = recorded_activation(&system, &binding, &root, action, || successful);
            assert_eq!(first.is_ok(), successful);
            let second = recorded_activation(&system, &binding, &root, action, || successful);
            assert_eq!(second.is_ok(), successful);
            assert_eq!(calls.get(), 1);
            assert_eq!(
                recorded_activation(&system, &binding, &root, action, || false),
                Err(Error::ActivationUnconfirmed)
            );
            assert_eq!(calls.get(), 1);
            assert_eq!(
                recorded_activation(
                    &directory.path().join("other"),
                    &binding,
                    &root,
                    action,
                    || true
                ),
                Err(Error::ActivationUnconfirmed)
            );
            assert_eq!(calls.get(), 1);
        }
    }

    #[test]
    fn unsafe_receipt_parent_cannot_authorize_activation() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("receipts");
        symlink(directory.path(), &root).unwrap();
        assert_eq!(
            recorded_activation(
                &directory.path().join("system"),
                &"a".repeat(64),
                &root,
                || panic!("unsafe journal must never activate"),
                || true
            ),
            Err(Error::ActivationUnconfirmed)
        );
    }

    struct ActivationFixture {
        directory: tempfile::TempDir,
        system: PathBuf,
        nix_env: PathBuf,
        marker: PathBuf,
    }

    impl ActivationFixture {
        fn new() -> Self {
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path().canonicalize().unwrap();
            let store = root.join("store");
            let system = store.join("system");
            let bin = system.join("sw/bin");
            fs::create_dir_all(&bin).unwrap();
            let marker = root.join("events");
            let nix_env = store.join("nix-env");
            let output = Command::new("rustc")
                .args(["--edition=2024", "-o"])
                .arg(&nix_env)
                .arg(
                    Path::new(env!("CARGO_MANIFEST_DIR"))
                        .join("tests/fixtures/bootstrap_privileged.rs"),
                )
                .env("HOMELAB_FIXTURE_MARKER", &marker)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
            fs::copy(&nix_env, bin.join("darwin-rebuild")).unwrap();
            for path in [
                &nix_env,
                &bin.join("darwin-rebuild"),
                &bin,
                &system.join("sw"),
                &system,
            ] {
                fs::set_permissions(path, fs::Permissions::from_mode(0o555)).unwrap();
            }
            Self {
                directory,
                system,
                nix_env,
                marker,
            }
        }

        fn run(&self) -> Result<(), Error> {
            activate_built(
                &self.system,
                &self.nix_env,
                Path::new("/nix/var/nix/profiles/system"),
                &self.directory.path().join("store").canonicalize().unwrap(),
                rustix::process::geteuid().as_raw(),
            )
        }
    }

    impl Drop for ActivationFixture {
        fn drop(&mut self) {
            // Restore only fixture directory permissions so TempDir can remove its files.
            for path in [
                &self.system,
                &self.system.join("sw"),
                &self.system.join("sw/bin"),
            ] {
                let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o700));
            }
        }
    }

    #[test]
    fn prebuilt_switch_sets_profile_then_activates_without_checkout() {
        let fixture = ActivationFixture::new();
        fixture.run().unwrap();
        assert_eq!(
            fs::read_to_string(&fixture.marker).unwrap(),
            "nix-env\ndarwin-rebuild\n"
        );
    }

    #[test]
    fn profile_or_activation_failure_requires_inspection() {
        let fixture = ActivationFixture::new();
        for (failure, events) in [
            ("nix-env", "nix-env\n"),
            ("darwin-rebuild", "nix-env\ndarwin-rebuild\n"),
        ] {
            let flag = fixture.marker.with_extension(failure);
            fs::write(&flag, "").unwrap();
            assert_eq!(fixture.run(), Err(Error::ActivationUnconfirmed));
            assert_eq!(fs::read_to_string(&fixture.marker).unwrap(), events);
            fs::remove_file(flag).unwrap();
            fs::remove_file(&fixture.marker).unwrap();
        }
    }

    #[test]
    fn mutable_or_foreign_owned_store_objects_never_execute() {
        let fixture = ActivationFixture::new();
        let store = fixture
            .directory
            .path()
            .join("store")
            .canonicalize()
            .unwrap();
        assert_eq!(
            trusted_store_path(
                &fixture.system,
                &store,
                rustix::process::geteuid().as_raw().wrapping_add(1)
            ),
            Err(Error::InvalidActivation)
        );
        for path in [
            &fixture.system,
            &fixture.nix_env,
            &fixture.system.join("sw/bin/darwin-rebuild"),
        ] {
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(fixture.run(), Err(Error::InvalidActivation));
            fs::set_permissions(path, fs::Permissions::from_mode(0o555)).unwrap();
        }
        assert!(!fixture.marker.exists());
    }
}
