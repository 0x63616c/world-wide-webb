//! A single approved remote setup journey using the target's reviewed helper.

use std::collections::BTreeMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

use rustix::fs::{Mode, OFlags, open};
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::inspect::{self, Inspection};
use crate::inventory::{self, HostProfile};
use crate::process;

const ARTIFACT_FILES: [&str; 4] = [
    "homelab-host",
    "bootstrap.sh",
    "REVISION",
    "setup-plan.json",
];
const STAGED_FILES: [&str; 7] = [
    "homelab-host",
    "bootstrap.sh",
    "REVISION",
    "setup-plan.json",
    "SHA256SUMS",
    "host.age",
    "github-token",
];
const STAGE_PREFIX: &str = "/private/tmp/homelab-setup.";

pub struct Request {
    pub repository: String,
    pub profile: HostProfile,
    pub configuration_host: String,
    pub revision: String,
    pub artifact_directory: PathBuf,
    pub age_key: PathBuf,
    pub github_token: PathBuf,
    pub resume: bool,
}

#[derive(Clone, PartialEq, Eq)]
pub struct Tools {
    pub ssh: PathBuf,
    pub scp: PathBuf,
}

pub struct PreparedSetup {
    request: Request,
    snapshot: tempfile::TempDir,
    inspection: Inspection,
    services: Vec<String>,
    tools: Tools,
}

impl PreparedSetup {
    pub fn configuration_host(&self) -> &str {
        &self.request.configuration_host
    }

    pub fn lines(&self) -> Vec<String> {
        vec![
            format!("Target: {} ({}@{})", self.request.profile.name, self.request.profile.user, self.request.profile.address),
            format!("Configuration: {}", self.request.configuration_host),
            format!("Reviewed commit: {}", self.request.revision),
            format!("macOS {}, {}; UID {}; {:.1} GiB free", self.inspection.mac_os, self.inspection.architecture, self.inspection.uid, self.inspection.free_gib),
            format!("Enabled services: {}", if self.services.is_empty() { "none".into() } else { self.services.join(", ") }),
            "Transfer the verified helper and only this host's age key and repository read token.".into(),
            "Install Nix if absent, verify the reviewed configuration, install its host key, and activate it.".into(),
            "The target will request administrator authentication. Existing keys are never replaced.".into(),
            if self.request.resume { "Resume requested; the target still blocks uncertain installation or activation state.".into() } else { "First setup requested; existing setup state requires explicit review and resume.".into() },
            "This does not approve service migration, account deletion or erasing the mini.".into(),
        ]
    }
}

pub struct Report {
    inspection: Inspection,
    configuration_host: String,
    revision: String,
}

impl Report {
    pub fn lines(&self) -> Vec<String> {
        vec![
            format!("{} configuration activated at {}.", self.configuration_host, self.revision),
            format!("SSH reconnect verified as {} (UID {}).", self.inspection.user, self.inspection.uid),
            "Remote staging files were removed; your original local input files were preserved.".into(),
            "Only the selected SSH route was checked. Verify the new Tailscale route, reboot, services and migration separately.".into(),
        ]
    }
}

#[derive(Clone, Copy, Debug)]
enum Failure {
    Inputs,
    Artifact,
    NotReady,
    Credentials,
    Inspect,
    Stale,
    Stage,
    Transfer,
    RemoteArtifact,
    Bootstrap,
    UnknownOutcome,
    Cleanup,
    Reconnect,
}

#[derive(Debug)]
pub struct Error {
    failure: Failure,
    remote_stage: Option<String>,
}

impl Error {
    fn new(failure: Failure) -> Self {
        Self {
            failure,
            remote_stage: None,
        }
    }
    fn staged(failure: Failure, stage: &str) -> Self {
        Self {
            failure,
            remote_stage: Some(stage.into()),
        }
    }
    pub fn code(&self) -> &'static str {
        match self.failure {
            Failure::Inputs => "setup-invalid-inputs",
            Failure::Artifact => "setup-artifact-unverified",
            Failure::NotReady => "setup-configuration-not-ready",
            Failure::Credentials => "setup-invalid-credentials",
            Failure::Inspect => "setup-inspection-failed",
            Failure::Stale => "setup-target-changed",
            Failure::Stage => "setup-staging-failed",
            Failure::Transfer => "setup-transfer-failed",
            Failure::RemoteArtifact => "setup-remote-artifact-unverified",
            Failure::Bootstrap => "setup-bootstrap-failed",
            Failure::UnknownOutcome => "setup-outcome-unknown",
            Failure::Cleanup => "setup-cleanup-unconfirmed",
            Failure::Reconnect => "setup-reconnect-failed",
        }
    }
    pub fn next_action(&self) -> String {
        let action = match self.failure {
            Failure::NotReady => {
                "Review a host-specific readiness PR and obtain its matching successful CI artifact; no remote files were staged."
            }
            Failure::UnknownOutcome => {
                "Reconnect using the existing verified route and inspect target setup state before retrying. Do not assume bootstrap or a privileged process stopped."
            }
            Failure::Bootstrap => {
                "Inspect the target's private setup journal before retrying; uncertain mutation phases cannot automatically resume."
            }
            Failure::Reconnect => {
                "Configuration activation completed, but SSH reconnect failed. Inspect access locally; do not delete saved fingerprints or rerun bootstrap blindly."
            }
            Failure::Credentials => {
                "Use only this host's age key and scoped repository read token in current-user-owned files with mode 0400 or 0600."
            }
            Failure::Cleanup => {
                "Configuration activation completed. Confirm staging cleanup and SSH access before any further setup action; do not rerun bootstrap blindly."
            }
            _ => {
                "Check the selected host, exact reviewed artifact and input paths before preparing setup again. Never bypass SSH host-key verification."
            }
        };
        match &self.remote_stage {
            Some(stage) => format!(
                "{action} Private remote staging may remain at {stage}; remove its known setup files only after confirming no setup process is using them."
            ),
            None => action.into(),
        }
    }
}

impl std::fmt::Display for Error {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self.failure {
            Failure::Inputs => "The setup selection is invalid or does not use the intended existing administrator.",
            Failure::Artifact => "The local artifact, checksums, revision or setup plan could not be verified.",
            Failure::NotReady => "The reviewed configuration is not ready for this host's first setup.",
            Failure::Credentials => "The private credential files could not be safely prepared.",
            Failure::Inspect => "The target could not be inspected through verified SSH.",
            Failure::Stale => "The target identity changed after review; no credentials were transferred.",
            Failure::Stage => "A private remote staging directory could not be confirmed.",
            Failure::Transfer => "The setup files could not be transferred.",
            Failure::RemoteArtifact => "The staged artifact failed verification; bootstrap was not started.",
            Failure::Bootstrap => "The target reported incomplete bootstrap.",
            Failure::UnknownOutcome => "The setup connection ended without a confirmed outcome.",
            Failure::Cleanup => "Configuration activated, but remote staging cleanup could not be confirmed.",
            Failure::Reconnect => "Setup completed, but the selected SSH connection was not verified afterward.",
        })
    }
}
impl std::error::Error for Error {}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ArtifactPlan {
    schema: u8,
    repository: String,
    revision: String,
    hosts: BTreeMap<String, crate::config::Host>,
}

fn opened(path: &Path, failure: Failure) -> Result<File, Error> {
    let file = File::from(
        open(
            path,
            OFlags::RDONLY | OFlags::NOFOLLOW | OFlags::NONBLOCK | OFlags::CLOEXEC,
            Mode::empty(),
        )
        .map_err(|_| Error::new(failure))?,
    );
    if !file.metadata().map_err(|_| Error::new(failure))?.is_file() {
        return Err(Error::new(failure));
    }
    Ok(file)
}

fn read_small(path: &Path, limit: u64) -> Result<Vec<u8>, Error> {
    let mut bytes = Vec::new();
    opened(path, Failure::Artifact)?
        .take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::new(Failure::Artifact))?;
    if bytes.len() as u64 > limit {
        return Err(Error::new(Failure::Artifact));
    }
    Ok(bytes)
}

fn copy_input(
    source: &Path,
    destination: &Path,
    private: bool,
    limit: u64,
    mode: u32,
) -> Result<String, Error> {
    let failure = if private {
        Failure::Credentials
    } else {
        Failure::Artifact
    };
    if !source.is_absolute() {
        return Err(Error::new(failure));
    }
    let mut input = opened(source, failure)?;
    let metadata = input.metadata().map_err(|_| Error::new(failure))?;
    if metadata.len() == 0
        || metadata.len() > limit
        || (private
            && (metadata.uid() != rustix::process::getuid().as_raw()
                || !matches!(metadata.mode() & 0o7777, 0o400 | 0o600)))
    {
        return Err(Error::new(failure));
    }
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(mode)
        .open(destination)
        .map_err(|_| Error::new(failure))?;
    output
        .set_permissions(fs::Permissions::from_mode(mode))
        .map_err(|_| Error::new(failure))?;
    let mut digest = Sha256::new();
    let mut total = 0;
    let mut buffer = [0; 16 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|_| Error::new(failure))?;
        if count == 0 {
            break;
        }
        total += count as u64;
        if total > limit {
            return Err(Error::new(failure));
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| Error::new(failure))?;
        digest.update(&buffer[..count]);
    }
    if total == 0 {
        return Err(Error::new(failure));
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

/// Prepare a private snapshot and inspect the target without writing to it.
pub fn prepare(request: Request, tools: &Tools) -> Result<PreparedSetup, Error> {
    let admin = request.profile.user.as_str();
    if !crate::config::valid_repository(&request.repository)
        || !crate::config::valid_host(&request.configuration_host)
    {
        return Err(Error::new(Failure::Inputs));
    }
    if inventory::validate_profile(&request.profile).is_err()
        || request.revision.len() != 40
        || !request
            .revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        || !request.artifact_directory.is_absolute()
        || !tools.ssh.is_absolute()
        || !tools.scp.is_absolute()
    {
        return Err(Error::new(Failure::Inputs));
    }
    let snapshot = tempfile::tempdir().map_err(|_| Error::new(Failure::Artifact))?;
    fs::set_permissions(snapshot.path(), fs::Permissions::from_mode(0o700))
        .map_err(|_| Error::new(Failure::Artifact))?;
    let manifest = read_small(&request.artifact_directory.join("SHA256SUMS"), 4096)?;
    let text = std::str::from_utf8(&manifest).map_err(|_| Error::new(Failure::Artifact))?;
    let mut hashes = BTreeMap::new();
    for line in text.lines() {
        let fields: Vec<_> = line.split_whitespace().collect();
        if fields.len() != 2
            || !ARTIFACT_FILES.contains(&fields[1])
            || fields[0].len() != 64
            || !fields[0]
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || hashes.insert(fields[1], fields[0]).is_some()
        {
            return Err(Error::new(Failure::Artifact));
        }
    }
    if hashes.len() != ARTIFACT_FILES.len() {
        return Err(Error::new(Failure::Artifact));
    }
    for name in ARTIFACT_FILES {
        let executable = matches!(name, "homelab-host" | "bootstrap.sh");
        let limit = if name == "homelab-host" {
            100 * 1024 * 1024
        } else {
            65_536
        };
        let hash = copy_input(
            &request.artifact_directory.join(name),
            &snapshot.path().join(name),
            false,
            limit,
            if executable { 0o700 } else { 0o600 },
        )?;
        if hash != hashes[name] {
            return Err(Error::new(Failure::Artifact));
        }
    }
    fs::write(snapshot.path().join("SHA256SUMS"), manifest)
        .map_err(|_| Error::new(Failure::Artifact))?;
    fs::set_permissions(
        snapshot.path().join("SHA256SUMS"),
        fs::Permissions::from_mode(0o600),
    )
    .map_err(|_| Error::new(Failure::Artifact))?;
    let revision = read_small(&snapshot.path().join("REVISION"), 128)?;
    if revision != request.revision.as_bytes()
        && revision != format!("{}\n", request.revision).as_bytes()
    {
        return Err(Error::new(Failure::Artifact));
    }
    let plan: ArtifactPlan = serde_json::from_slice(&read_small(
        &snapshot.path().join("setup-plan.json"),
        65_536,
    )?)
    .map_err(|_| Error::new(Failure::Artifact))?;
    if plan.schema != 2
        || plan.repository != request.repository
        || plan.revision != request.revision
    {
        return Err(Error::new(Failure::Artifact));
    }
    let host = plan
        .hosts
        .get(&request.configuration_host)
        .ok_or_else(|| Error::new(Failure::Artifact))?;
    if !host.activation_ready
        || host.authorized_keys.is_empty()
        || host.authorized_keys.iter().any(|key| key.trim().is_empty())
        || host.admin_user != admin
        || host.admin_uid == 0
    {
        return Err(Error::new(Failure::NotReady));
    }
    if host.services.iter().any(|service| {
        service.is_empty()
            || service.len() > 253
            || !service
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    }) {
        return Err(Error::new(Failure::Artifact));
    }
    let inspection =
        inspect::inspect(&request.profile, &tools.ssh).map_err(|_| Error::new(Failure::Inspect))?;
    if !inspection.is_ready() || inspection.uid != u64::from(host.admin_uid) {
        return Err(Error::new(Failure::NotReady));
    }
    copy_input(
        &request.age_key,
        &snapshot.path().join("host.age"),
        true,
        65_536,
        0o600,
    )?;
    copy_input(
        &request.github_token,
        &snapshot.path().join("github-token"),
        true,
        4096,
        0o600,
    )?;
    let services = host.services.clone();
    Ok(PreparedSetup {
        request,
        snapshot,
        inspection,
        services,
        tools: tools.clone(),
    })
}

fn ssh(
    profile: &HostProfile,
    tools: &Tools,
    interactive: bool,
) -> Result<(Command, Option<tempfile::NamedTempFile>), Error> {
    let mut command = Command::new(&tools.ssh);
    let identity = crate::ssh_identity::configure(&mut command, profile.identity.as_ref())
        .map_err(|_| Error::new(Failure::Inputs))?;
    command
        .arg(if interactive { "-tt" } else { "-T" })
        .args(crate::ssh::OPTIONS)
        .arg("-l")
        .arg(&profile.user)
        .arg(&profile.address);
    Ok((command, identity))
}

fn script(
    profile: &HostProfile,
    tools: &Tools,
    source: &str,
    stage: Option<&str>,
) -> Result<std::process::Output, Error> {
    let mut input = tempfile::tempfile().map_err(|_| Error::new(Failure::Stage))?;
    input
        .write_all(source.as_bytes())
        .and_then(|()| input.rewind())
        .map_err(|_| Error::new(Failure::Stage))?;
    let (mut command, _identity) = ssh(profile, tools, false)?;
    command
        .arg(match stage {
            Some(stage) => format!("/bin/sh -s -- '{stage}'"),
            None => "/bin/sh -s".into(),
        })
        .stdin(Stdio::from(input));
    let timeout = if profile.identity.is_some() { 90 } else { 30 };
    process::capture(&mut command, Duration::from_secs(timeout))
        .map_err(|_| Error::new(Failure::Stage))
}

fn cleanup(profile: &HostProfile, tools: &Tools, stage: &str) -> bool {
    // Delete only our fixed names. Never recursively remove a path from remote output.
    script(
        profile,
        tools,
        include_str!("remote/cleanup.sh"),
        Some(stage),
    )
    .is_ok_and(|output| output.status.success())
}

fn failed_before_start(
    profile: &HostProfile,
    tools: &Tools,
    stage: &str,
    failure: Failure,
) -> Error {
    if cleanup(profile, tools, stage) {
        Error::new(failure)
    } else {
        Error::staged(failure, stage)
    }
}

/// Apply only after the caller has obtained explicit approval of the prepared review.
pub fn apply(prepared: PreparedSetup, tools: &Tools) -> Result<Report, Error> {
    if tools != &prepared.tools {
        return Err(Error::new(Failure::Inputs));
    }
    let request = &prepared.request;
    let current =
        inspect::inspect(&request.profile, &tools.ssh).map_err(|_| Error::new(Failure::Inspect))?;
    if !current.is_ready()
        || current.uid != prepared.inspection.uid
        || current.user != prepared.inspection.user
        || current.mac_os != prepared.inspection.mac_os
    {
        return Err(Error::new(Failure::Stale));
    }
    let output = script(
        &request.profile,
        tools,
        include_str!("remote/stage.sh"),
        None,
    )?;
    let stage = std::str::from_utf8(&output.stdout)
        .map_err(|_| Error::new(Failure::Stage))?
        .trim();
    let suffix = stage
        .strip_prefix(STAGE_PREFIX)
        .ok_or_else(|| Error::new(Failure::Stage))?;
    if !output.status.success()
        || suffix.len() != 8
        || !suffix.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        return Err(Error::new(Failure::Stage));
    }
    let mut transfer = Command::new(&tools.scp);
    let _transfer_identity =
        crate::ssh_identity::configure(&mut transfer, request.profile.identity.as_ref())
            .map_err(|_| failed_before_start(&request.profile, tools, stage, Failure::Transfer))?;
    transfer
        .args(["-s", "-p"])
        .args(crate::ssh::OPTIONS)
        .arg("--");
    for name in STAGED_FILES {
        transfer.arg(prepared.snapshot.path().join(name));
    }
    transfer
        .arg(format!(
            "{}@{}:{stage}/",
            request.profile.user, request.profile.address
        ))
        .stdin(Stdio::null());
    if !process::run_silent(&mut transfer, Duration::from_secs(600))
        .is_ok_and(|status| status.success())
    {
        return Err(failed_before_start(
            &request.profile,
            tools,
            stage,
            Failure::Transfer,
        ));
    }
    if !script(
        &request.profile,
        tools,
        include_str!("remote/verify.sh"),
        Some(stage),
    )
    .is_ok_and(|output| output.status.success())
    {
        return Err(failed_before_start(
            &request.profile,
            tools,
            stage,
            Failure::RemoteArtifact,
        ));
    }
    // These values have restricted alphabets or are the validated mktemp path.
    // Secret values are transferred as files and never enter a shell command.
    let remote = format!(
        "HOMELAB_BOOTSTRAP_APPROVED='{}' '{stage}/homelab-host' bootstrap '{}' '{}' '{stage}/host.age' '{stage}/github-token' --repository '{}' --manifest '{stage}/setup-plan.json'{}",
        request.configuration_host,
        request.configuration_host,
        request.revision,
        request.repository,
        if request.resume { " --resume" } else { "" }
    );
    let (mut bootstrap, _bootstrap_identity) = ssh(&request.profile, tools, true)
        .map_err(|_| failed_before_start(&request.profile, tools, stage, Failure::Bootstrap))?;
    bootstrap
        .arg(remote)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());
    // The terminal belongs to SSH while sudo authenticates on the target. An
    // interrupted connection is not evidence that its privileged work stopped.
    eprintln!("Private remote setup files: {stage}");
    eprintln!(
        "If this session is interrupted, inspect target setup state before retrying or removing those files."
    );
    let status = bootstrap
        .status()
        .map_err(|_| Error::staged(Failure::UnknownOutcome, stage))?;
    // Remote shells can report interruption as 128 + signal, rather than SSH's
    // transport-failure status 255. Neither confirms that privileged work stopped.
    if status.code().is_none_or(|code| code >= 128) {
        return Err(Error::staged(Failure::UnknownOutcome, stage));
    }
    let removed = cleanup(&request.profile, tools, stage);
    if !status.success() {
        return Err(if removed {
            Error::new(Failure::Bootstrap)
        } else {
            Error::staged(Failure::Bootstrap, stage)
        });
    }
    if !removed {
        return Err(Error::staged(Failure::Cleanup, stage));
    }
    let inspection = inspect::inspect(&request.profile, &tools.ssh)
        .map_err(|_| Error::new(Failure::Reconnect))?;
    if !inspection.is_ready() || inspection.uid != prepared.inspection.uid {
        return Err(Error::new(Failure::Reconnect));
    }
    Ok(Report {
        inspection,
        configuration_host: request.configuration_host.clone(),
        revision: request.revision.clone(),
    })
}
