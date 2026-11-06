//! Target-side first setup. The operator UI and CLI supply the same reviewed request.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::bootstrap_state::{Journal, Phase, StateError};
use crate::process;

const SHORT: Duration = Duration::from_secs(30);
const FETCH: Duration = Duration::from_secs(600);
const INSTALL: Duration = Duration::from_secs(1800);
const BUILD: Duration = Duration::from_secs(7200);

pub struct Request {
    pub repository: String,
    pub expected_host: crate::config::Host,
    pub host: String,
    pub revision: String,
    pub age_key: PathBuf,
    pub deploy_key: PathBuf,
    pub approved_host: Option<String>,
    pub resume: bool,
}

pub struct Tools {
    pub git: PathBuf,
    pub xcode_select: PathBuf,
    pub uname: PathBuf,
    pub id: PathBuf,
    pub dseditgroup: PathBuf,
    pub sudo: PathBuf,
    pub curl: PathBuf,
    pub helper: PathBuf,
    pub nix: Option<PathBuf>,
    pub installed_nix: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct Report {
    pub host: String,
    pub revision: String,
    pub phase: Phase,
    pub message: &'static str,
}

#[derive(Clone, Copy, Debug, Error, PartialEq, Eq)]
pub enum Error {
    #[error("Select a supported host and an exact reviewed 40-character lowercase commit.")]
    InvalidRequest,
    #[error("Explicit approval for this target is required before bootstrap.")]
    ApprovalRequired,
    #[error(
        "Bootstrap requires Apple-silicon macOS and the existing intended non-root administrator."
    )]
    WrongTarget,
    #[error("Apple Command Line Tools or their Git executable are unavailable on the target.")]
    CommandLineToolsRequired,
    #[error(
        "Credential inputs must be private, nonempty regular files owned by this user, no larger than 64 KiB."
    )]
    InvalidCredentials,
    #[error("The private bootstrap workspace could not be prepared.")]
    Workspace,
    #[error(
        "The setup journal is unavailable, conflicting, or requires explicit resume or recovery."
    )]
    Journal,
    #[error(
        "Setup may have changed the host. Automatic replay is blocked until its actual state is reviewed."
    )]
    RecoveryRequired,
    #[error("The exact reviewed private configuration could not be fetched and verified.")]
    Repository,
    #[error("The reviewed revision lacks a regular lockfile or encrypted host secrets.")]
    Unprovisioned,
    #[error("Administrator authentication or a privileged preflight check failed.")]
    Elevation,
    #[error("A host age key already exists. Bootstrap will not replace it.")]
    ExistingKey,
    #[error("An existing Nix installation is not usable. Bootstrap will not replace it.")]
    ExistingNix,
    #[error(
        "The reviewed Nix installer specification or downloaded content could not be verified."
    )]
    InstallerVerification,
    #[error(
        "Nix installation did not complete successfully. Inspect actual host state before resuming."
    )]
    Installation,
    #[error("The reviewed host configuration could not be evaluated.")]
    Evaluation,
    #[error(
        "The reviewed host configuration is not activation-ready for this administrator and SSH keys."
    )]
    NotReady,
    #[error("The locked host system could not be built.")]
    Build,
    #[error(
        "The host build process could not be supervised to completion. Inspect target state before retrying."
    )]
    BuildSupervision,
    #[error("The completed host build did not provide a resolvable system output.")]
    BuildOutput,
    #[error("The supplied host identity did not pass isolated decryption verification.")]
    Decryption,
    #[error("Host key installation was not confirmed. Inspect the installed key before any retry.")]
    KeyInstallation,
    #[error("Activation was not confirmed. Inspect actual host state before any retry.")]
    Activation,
}

impl Error {
    pub fn code(self) -> &'static str {
        match self {
            Self::InvalidRequest => "invalid-bootstrap-request",
            Self::ApprovalRequired => "bootstrap-approval-required",
            Self::WrongTarget => "bootstrap-wrong-target",
            Self::CommandLineToolsRequired => "bootstrap-command-line-tools-required",
            Self::InvalidCredentials => "bootstrap-invalid-credentials",
            Self::Workspace => "bootstrap-workspace-unavailable",
            Self::Journal => "bootstrap-journal-unavailable",
            Self::RecoveryRequired => "bootstrap-recovery-required",
            Self::Repository => "bootstrap-revision-unavailable",
            Self::Unprovisioned => "bootstrap-unprovisioned-revision",
            Self::Elevation => "bootstrap-elevation-failed",
            Self::ExistingKey => "bootstrap-existing-key",
            Self::ExistingNix => "bootstrap-existing-nix-unusable",
            Self::InstallerVerification => "bootstrap-installer-unverified",
            Self::Installation => "bootstrap-nix-installation-unconfirmed",
            Self::Evaluation => "bootstrap-evaluation-failed",
            Self::NotReady => "bootstrap-not-ready",
            Self::Build => "bootstrap-build-failed",
            Self::BuildSupervision => "bootstrap-build-supervision-failed",
            Self::BuildOutput => "bootstrap-build-output-unavailable",
            Self::Decryption => "bootstrap-identity-unverified",
            Self::KeyInstallation => "bootstrap-key-installation-unconfirmed",
            Self::Activation => "bootstrap-activation-unconfirmed",
        }
    }

    pub fn next_action(self) -> &'static str {
        match self {
            Self::ApprovalRequired => {
                "Review the target, exact commit and migration gates, then explicitly approve this host."
            }
            Self::RecoveryRequired
            | Self::Journal
            | Self::Installation
            | Self::BuildSupervision
            | Self::KeyInstallation
            | Self::Activation => {
                "Inspect the private setup journal and actual target state. A privileged process may still be running; do not blindly repeat setup."
            }
            Self::ExistingKey => {
                "Verify the existing identity manually; use the recovery workflow instead of replacing it."
            }
            Self::CommandLineToolsRequired => {
                "On the target Mac, run xcode-select --install and finish Apple's installation dialog. If tools are already installed, repair their selection and verify /usr/bin/git --version, then retry."
            }
            Self::ExistingNix => {
                "Inspect and repair the existing Nix installation separately before resuming."
            }
            Self::NotReady => {
                "Review activationReady, the existing administrator identity and authorized SSH keys in the selected commit. Nix may already have been installed."
            }
            Self::InvalidCredentials | Self::Decryption => {
                "Supply only this host's private age identity and scoped repository read token using owner-only files."
            }
            Self::Elevation => {
                "Use an interactive target terminal to authenticate the existing administrator; do not store or pipe a password."
            }
            _ => {
                "Review the selected target, prerequisites and exact configuration revision before retrying with explicit resume if a journal exists."
            }
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Installer {
    url: String,
    sha256: String,
}

fn command(executable: &Path, home: &Path) -> Command {
    let mut command = Command::new(executable);
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LC_ALL", "C")
        .env("HOME", home)
        .stdin(Stdio::null());
    command
}

fn checked_text(command: &mut Command, timeout: Duration, error: Error) -> Result<String, Error> {
    let output = process::capture(command, timeout).map_err(|_| error)?;
    if !output.status.success() {
        return Err(error);
    }
    String::from_utf8(output.stdout)
        .map(|text| text.trim().to_owned())
        .map_err(|_| error)
}

fn checked_silent(command: &mut Command, timeout: Duration, error: Error) -> Result<(), Error> {
    if process::run_silent(command, timeout)
        .map_err(|_| error)?
        .success()
    {
        Ok(())
    } else {
        Err(error)
    }
}

fn regular_file(path: &Path) -> io::Result<File> {
    let file = File::from(open(
        path,
        OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
        Mode::empty(),
    )?);
    if !file.metadata()?.is_file() {
        return Err(io::Error::other("not a regular file"));
    }
    Ok(file)
}

fn copy_credential(source: &Path, destination: &Path) -> Result<(), Error> {
    if !source.is_absolute() {
        return Err(Error::InvalidCredentials);
    }
    let source = regular_file(source).map_err(|_| Error::InvalidCredentials)?;
    let metadata = source.metadata().map_err(|_| Error::InvalidCredentials)?;
    if metadata.uid() != rustix::process::getuid().as_raw()
        || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)
        || metadata.len() == 0
        || metadata.len() > 65_536
    {
        return Err(Error::InvalidCredentials);
    }
    let mut destination = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(destination)
        .map_err(|_| Error::Workspace)?;
    let size = io::copy(&mut source.take(65_537), &mut destination)
        .map_err(|_| Error::InvalidCredentials)?;
    if !(1..=65_536).contains(&size) {
        return Err(Error::InvalidCredentials);
    }
    Ok(())
}

fn git_command(tools: &Tools, home: &Path, key: &Path) -> Command {
    let mut git = command(&tools.git, home);
    crate::git_ssh::configure(&mut git, key, &home.join("github_known_hosts"));
    git
}

fn existing_key(tools: &Tools, home: &Path) -> Result<bool, Error> {
    let mut check = command(&tools.sudo, home);
    check
        .arg("-n")
        .arg(&tools.helper)
        .arg("bootstrap-key-status");
    let status = process::run_silent(&mut check, SHORT).map_err(|_| Error::Elevation)?;
    // A dedicated absence status cannot be confused with sudo's own failure.
    match status.code() {
        Some(0) => Ok(true),
        Some(3) => Ok(false),
        _ => Err(Error::Elevation),
    }
}

fn authenticate(tools: &Tools, home: &Path) -> Result<(), Error> {
    let status = command(&tools.sudo, home)
        .arg("-v")
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .status()
        .map_err(|_| Error::Elevation)?;
    if status.success() {
        Ok(())
    } else {
        Err(Error::Elevation)
    }
}

fn verify_installer(path: &Path) -> Result<Installer, Error> {
    let mut bytes = Vec::new();
    regular_file(path)
        .map_err(|_| Error::InstallerVerification)?
        .take(4097)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::InstallerVerification)?;
    if bytes.len() > 4096 {
        return Err(Error::InstallerVerification);
    }
    let installer: Installer =
        serde_json::from_slice(&bytes).map_err(|_| Error::InstallerVerification)?;
    let version = installer
        .url
        .strip_prefix("https://github.com/DeterminateSystems/nix-installer/releases/download/v")
        .and_then(|url| url.strip_suffix("/nix-installer-aarch64-darwin"))
        .ok_or(Error::InstallerVerification)?;
    if version.split('.').count() != 3
        || !version
            .split('.')
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
        || installer.sha256.len() != 64
        || !installer
            .sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(Error::InstallerVerification);
    }
    Ok(installer)
}

fn usable_nix(tools: &Tools, home: &Path) -> Result<Option<PathBuf>, Error> {
    let nix = if let Some(path) = &tools.nix {
        Some(path.clone())
    } else {
        match fs::symlink_metadata(&tools.installed_nix) {
            Ok(_) => Some(tools.installed_nix.clone()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(_) => return Err(Error::ExistingNix),
        }
    };
    if let Some(path) = &nix {
        checked_silent(
            command(path, home).arg("--version"),
            SHORT,
            Error::ExistingNix,
        )?;
    }
    Ok(nix)
}

fn install_nix(
    tools: &Tools,
    home: &Path,
    repo: &Path,
    work: &Path,
    journal: &mut Journal,
    uid: u32,
) -> Result<PathBuf, Error> {
    let installer = verify_installer(&repo.join("bootstrap/installer.json"))?;
    let downloaded = work.join("nix-installer");
    let mut download = command(&tools.curl, home);
    download
        .args([
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--connect-timeout",
            "15",
            "--max-time",
            "600",
            "--max-filesize",
            "104857600",
            "--output",
        ])
        .arg(&downloaded)
        .arg(&installer.url);
    checked_silent(&mut download, FETCH, Error::InstallerVerification)?;
    let mut content = regular_file(&downloaded).map_err(|_| Error::InstallerVerification)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0; 8192];
    loop {
        let count = content
            .read(&mut buffer)
            .map_err(|_| Error::InstallerVerification)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    let digest: String = hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    if digest != installer.sha256 {
        return Err(Error::InstallerVerification);
    }
    fs::set_permissions(&downloaded, fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::InstallerVerification)?;
    // A download can outlast sudo's credential cache. Reauthenticate before
    // recording a mutation, so an expired cache cannot create uncertain state.
    authenticate(tools, home)?;
    journal
        .record(Phase::InstallingNix, None)
        .map_err(|_| Error::Journal)?;
    let mut install = command(&tools.sudo, home);
    install
        .arg("-n")
        .arg(&tools.helper)
        .arg("bootstrap-install-nix")
        .arg("--installer")
        .arg(&downloaded)
        .arg("--sha256")
        .arg(&installer.sha256)
        .arg("--source-uid")
        .arg(uid.to_string());
    checked_silent(&mut install, INSTALL, Error::Installation)?;
    checked_silent(
        command(&tools.installed_nix, home).arg("--version"),
        SHORT,
        Error::Installation,
    )?;
    Ok(tools.installed_nix.clone())
}

/// Apply an explicitly approved first-setup request on the selected target.
pub fn run(request: &Request, tools: &Tools, state_directory: &Path) -> Result<Report, Error> {
    if !crate::config::valid_host(&request.host)
        || !crate::config::valid_repository(&request.repository)
        || !crate::config::valid_revision(&request.revision)
    {
        return Err(Error::InvalidRequest);
    }
    let approved = &request.expected_host;
    let manifest = crate::config::Manifest {
        schema: 1,
        hosts: [(request.host.clone(), approved.clone())].into(),
        tailscale: None,
    };
    manifest.validate().map_err(|_| Error::InvalidRequest)?;
    let admin = approved.admin_user.as_str();
    if !approved.activation_ready || approved.authorized_keys.is_empty() {
        return Err(Error::NotReady);
    }
    if request.approved_host.as_deref() != Some(request.host.as_str()) {
        return Err(Error::ApprovalRequired);
    }
    if [
        &tools.git,
        &tools.xcode_select,
        &tools.uname,
        &tools.id,
        &tools.dseditgroup,
        &tools.sudo,
        &tools.curl,
        &tools.helper,
        &tools.installed_nix,
    ]
    .into_iter()
    .any(|path| !path.is_absolute())
        || tools.nix.as_ref().is_some_and(|path| !path.is_absolute())
    {
        return Err(Error::InvalidRequest);
    }
    // Identity checks do not require reading secrets or creating persistent state.
    let neutral_home = Path::new("/var/empty");
    if checked_text(
        command(&tools.uname, neutral_home).arg("-s"),
        SHORT,
        Error::WrongTarget,
    )? != "Darwin"
        || checked_text(
            command(&tools.uname, neutral_home).arg("-m"),
            SHORT,
            Error::WrongTarget,
        )? != "arm64"
        || checked_text(
            command(&tools.id, neutral_home).arg("-un"),
            SHORT,
            Error::WrongTarget,
        )? != admin
    {
        return Err(Error::WrongTarget);
    }
    let uid: u32 = checked_text(
        command(&tools.id, neutral_home).arg("-u"),
        SHORT,
        Error::WrongTarget,
    )?
    .parse()
    .map_err(|_| Error::WrongTarget)?;
    if uid == 0 || uid != approved.admin_uid {
        return Err(Error::WrongTarget);
    }
    let membership = checked_text(
        command(&tools.dseditgroup, neutral_home).args(["-o", "checkmember", "-m", admin, "admin"]),
        SHORT,
        Error::WrongTarget,
    )?;
    if !membership.starts_with("yes ") {
        return Err(Error::WrongTarget);
    }

    // Apple's Git shim can open an installation dialog on a fresh Mac. Check
    // developer-tool selection first so SSH setup fails clearly without a GUI.
    checked_silent(
        command(&tools.xcode_select, neutral_home).arg("--print-path"),
        SHORT,
        Error::CommandLineToolsRequired,
    )?;
    checked_silent(
        command(&tools.git, neutral_home).arg("--version"),
        SHORT,
        Error::CommandLineToolsRequired,
    )?;

    let journal = if request.resume {
        Journal::open_for_reconciliation(
            state_directory,
            &request.repository,
            &request.host,
            &request.revision,
        )
    } else {
        Journal::open(
            state_directory,
            &request.repository,
            &request.host,
            &request.revision,
            false,
        )
    };
    let mut journal = journal.map_err(|error| match error {
        StateError::NeedsInspection => Error::RecoveryRequired,
        _ => Error::Journal,
    })?;
    let binding =
        crate::config::setup_binding(&request.repository, &request.host, &request.revision)
            .ok_or(Error::Journal)?;
    match journal.phase() {
        Phase::InstallingNix => return Err(Error::RecoveryRequired),
        Phase::Activating | Phase::Activated => {
            let system = journal
                .built_system()
                .ok_or(Error::RecoveryRequired)?
                .to_owned();
            authenticate(tools, neutral_home)?;
            checked_silent(
                command(&tools.sudo, neutral_home)
                    .arg("-n")
                    .arg(&tools.helper)
                    .arg("bootstrap-activation-status")
                    .arg("--system")
                    .arg(&system)
                    .arg("--binding")
                    .arg(&binding),
                SHORT,
                Error::RecoveryRequired,
            )?;
            journal
                .record(Phase::Activated, Some(&system))
                .map_err(|_| Error::Journal)?;
            return Ok(Report {
                host: request.host.clone(),
                revision: request.revision.clone(),
                phase: Phase::Activated,
                message: "The approved activation was verified without repeating installation. Post-install verification still remains.",
            });
        }
        _ => {}
    }
    let resuming_keys = journal.phase() == Phase::InstallingKey;
    if resuming_keys && journal.built_system().is_none() {
        return Err(Error::RecoveryRequired);
    }
    let work = tempfile::tempdir().map_err(|_| Error::Workspace)?;
    fs::set_permissions(work.path(), fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::Workspace)?;
    let home = work.path().join("home");
    fs::create_dir(&home).map_err(|_| Error::Workspace)?;
    fs::set_permissions(&home, fs::Permissions::from_mode(0o700)).map_err(|_| Error::Workspace)?;
    fs::write(home.join("github_known_hosts"), crate::git_ssh::KNOWN_HOSTS)
        .map_err(|_| Error::Workspace)?;
    let age_key = work.path().join("host.age");
    let key = work.path().join("deploy-key");
    copy_credential(&request.age_key, &age_key)?;
    copy_credential(&request.deploy_key, &key)?;
    let deploy_public = crate::deploy_identity::public_key(
        &key,
        rustix::process::geteuid().as_raw(),
        Path::new("/usr/bin/ssh-keygen"),
    )
    .map_err(|_| Error::InvalidCredentials)?;
    let repo = work.path().join("repo");
    checked_silent(
        git_command(tools, &home, &key)
            .args(["clone", "--no-checkout", "--template="])
            .arg(format!("git@github.com:{}.git", request.repository))
            .arg(&repo),
        FETCH,
        Error::Repository,
    )?;
    checked_silent(
        git_command(tools, &home, &key)
            .arg("-C")
            .arg(&repo)
            .args(["checkout", "--detach"])
            .arg(&request.revision),
        FETCH,
        Error::Repository,
    )?;
    let actual_revision = checked_text(
        git_command(tools, &home, &key)
            .arg("-C")
            .arg(&repo)
            .args(["rev-parse", "HEAD"]),
        SHORT,
        Error::Repository,
    )?;
    if actual_revision != request.revision {
        return Err(Error::Repository);
    }
    let mut manifest_bytes = Vec::new();
    regular_file(&repo.join("homelab.json"))
        .map_err(|_| Error::Unprovisioned)?
        .take(65_537)
        .read_to_end(&mut manifest_bytes)
        .map_err(|_| Error::Unprovisioned)?;
    if manifest_bytes.len() > 65_536 {
        return Err(Error::Unprovisioned);
    }
    let fetched: crate::config::Manifest =
        serde_json::from_slice(&manifest_bytes).map_err(|_| Error::Unprovisioned)?;
    fetched.validate().map_err(|_| Error::Unprovisioned)?;
    if fetched.hosts.get(&request.host) != Some(approved) {
        return Err(Error::NotReady);
    }
    let ciphertext = repo
        .join("secrets")
        .join(format!("{}.sops.yaml", request.host));
    for file in [repo.join("flake.lock"), ciphertext.clone()] {
        if !regular_file(&file)
            .and_then(|file| file.metadata())
            .is_ok_and(|metadata| metadata.len() > 0)
        {
            return Err(Error::Unprovisioned);
        }
    }

    // Authentication happens explicitly in the terminal; mutation commands use
    // -n so they cannot unexpectedly wait for a password in the background.
    authenticate(tools, &home)?;
    if existing_key(tools, &home)? && !resuming_keys {
        return Err(Error::ExistingKey);
    }
    let nix = match usable_nix(tools, &home)? {
        Some(nix) => nix,
        None if resuming_keys => return Err(Error::RecoveryRequired),
        None => install_nix(tools, &home, &repo, work.path(), &mut journal, uid)?,
    };
    let target = format!("{}#darwinConfigurations.{}", repo.display(), request.host);
    let mut evaluate = command(&nix, &home);
    evaluate
        .args(["eval", "--json"])
        .arg(format!(
            "{}#lib.setupPlan.hosts.{}",
            repo.display(),
            request.host
        ))
        .arg("--no-update-lock-file");
    let readiness: crate::config::Host =
        serde_json::from_str(&checked_text(&mut evaluate, FETCH, Error::Evaluation)?)
            .map_err(|_| Error::Evaluation)?;
    // The reviewed manifest is the approval boundary, even if a Nix module
    // overrides one of its defaults during evaluation.
    if &readiness != approved {
        return Err(Error::NotReady);
    }
    if !resuming_keys {
        journal
            .record(Phase::Building, None)
            .map_err(|_| Error::Journal)?;
    }
    let system_link = work.path().join("system");
    let build_status = process::run_silent(
        command(&nix, &home)
            .arg("build")
            .arg(format!("{target}.system"))
            .args(["--no-update-lock-file", "--out-link"])
            .arg(&system_link),
        BUILD,
    )
    .map_err(|_| Error::BuildSupervision)?;
    if !build_status.success() {
        return Err(Error::Build);
    }
    let system = fs::canonicalize(&system_link).map_err(|_| Error::BuildOutput)?;
    if resuming_keys && journal.built_system() != Some(system.as_path()) {
        return Err(Error::RecoveryRequired);
    }
    let helper = system.join("sw/bin/homelab-host");
    // Older private configurations may pin an older helper. Detect that before
    // installing either identity, when returning to the review is still safe.
    for operation in [
        "install-deploy-key",
        "bootstrap-activation-status",
        "complete-setup",
        "run-updater",
    ] {
        checked_silent(
            command(&helper, &home).args([operation, "--help"]),
            SHORT,
            Error::BuildOutput,
        )?;
    }
    if !resuming_keys {
        journal
            .record(Phase::VerifyingSecrets, Some(&system))
            .map_err(|_| Error::Journal)?;
    }
    checked_silent(
        command(&helper, &home)
            .arg("verify-host-secrets")
            .arg("--key")
            .arg(&age_key)
            .arg("--ciphertext")
            .arg(&ciphertext)
            .arg("--sops")
            .arg(system.join("sw/bin/sops")),
        FETCH,
        Error::Decryption,
    )?;

    // Building can take longer than sudo's cache lifetime. A failed prompt
    // leaves this resumable at VerifyingSecrets, before any key installation.
    authenticate(tools, &home)?;

    // Persist uncertainty before each privileged mutation. Timeout does not
    // prove an unprivileged supervisor stopped a root-owned descendant.
    journal
        .record(Phase::InstallingKey, Some(&system))
        .map_err(|_| Error::Journal)?;
    checked_silent(
        command(&tools.sudo, &home)
            .arg("-n")
            .arg(&helper)
            .arg("install-host-key")
            .arg("--reuse-matching")
            .arg("--source")
            .arg(&age_key)
            .arg("--source-uid")
            .arg(uid.to_string()),
        SHORT,
        Error::KeyInstallation,
    )?;
    checked_silent(
        command(&tools.sudo, &home)
            .arg("-n")
            .arg(&helper)
            .arg("install-deploy-key")
            .arg("--reuse-matching")
            .arg("--source")
            .arg(&key)
            .arg("--public-key")
            .arg(&deploy_public),
        SHORT,
        Error::KeyInstallation,
    )?;
    journal
        .record(Phase::Activating, Some(&system))
        .map_err(|_| Error::Journal)?;
    checked_silent(
        command(&tools.sudo, &home)
            .arg("-n")
            .arg(&helper)
            .arg("bootstrap-activate")
            .arg("--system")
            .arg(&system)
            .arg("--binding")
            .arg(&binding),
        Duration::from_secs(2400),
        Error::Activation,
    )?;
    journal
        .record(Phase::Activated, Some(&system))
        .map_err(|_| Error::Journal)?;
    Ok(Report {
        host: request.host.clone(),
        revision: request.revision.clone(),
        phase: Phase::Activated,
        message: "Configuration activation completed. Private access, reboot, services and migration still require verification.",
    })
}
