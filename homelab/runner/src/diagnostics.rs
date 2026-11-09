//! One protected, bounded typed summary. Never accepts runner output or error text.
use crate::{
    guest::GuestStatus,
    state::{Attempt, JobIdentity, Operation},
};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
};

const LIMIT: u64 = 4096;
const FILE: &str = "last-attempt.json";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SafeError {
    EffectFailed,
    OutcomeUnknown,
    Timeout,
    ProcessIo,
    ProcessRejected,
    Ownership,
    InvalidResponse,
    Authentication,
    RateLimited,
    Transport,
    Rejected,
    RunnerVersion,
    GuestIdentity,
    GuestClaimed,
    LeaseUnknown,
    Preflight,
    Inventory,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EffectState {
    Started,
    Succeeded,
    Failed,
    Unknown,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Failure {
    pub operation: Operation,
    pub category: SafeError,
    pub at: u64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Summary {
    pub schema: u32,
    pub nonce: String,
    #[serde(default)]
    pub platform: crate::config::Platform,
    pub candidate: JobIdentity,
    pub assigned: Option<JobIdentity>,
    pub runner_id: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runner_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vm_name: Option<String>,
    pub updated_at: u64,
    pub last_operation: Operation,
    pub last_outcome: EffectState,
    pub first_failure: Option<Failure>,
    pub latest_failure: Option<Failure>,
    pub guest: Option<GuestStatus>,
}
impl Summary {
    pub fn new(attempt: &Attempt, operation: Operation, now: u64) -> Self {
        Self {
            schema: 1,
            nonce: attempt.nonce.clone(),
            platform: attempt.platform,
            candidate: attempt.candidate.clone(),
            assigned: attempt.assigned.clone(),
            runner_id: attempt.runner_id,
            runner_name: Some(attempt.runner_name.clone()),
            vm_name: Some(attempt.vm_name.clone()),
            updated_at: now,
            last_operation: operation,
            last_outcome: EffectState::Started,
            first_failure: None,
            latest_failure: None,
            guest: None,
        }
    }
    pub fn failure(&mut self, operation: Operation, category: SafeError, now: u64) {
        let failure = Failure {
            operation,
            category,
            at: now,
        };
        self.first_failure.get_or_insert_with(|| failure.clone());
        self.latest_failure = Some(failure);
        self.last_operation = operation;
        self.updated_at = now;
    }
    fn validate(&self) -> std::io::Result<()> {
        if self.schema != 1
            || !crate::guest::valid_attempt(&self.nonce)
            || !valid_job(&self.candidate)
            || self
                .assigned
                .as_ref()
                .is_some_and(|job| !valid_job(job) || job.repository != self.candidate.repository)
            || self.runner_id == Some(0)
            || self.vm_name.as_deref().is_some_and(|name| {
                crate::names::parse(name).map(|(_, nonce)| nonce) != Some(self.nonce.as_str())
            })
            || self.runner_name != self.vm_name
        {
            return Err(std::io::ErrorKind::InvalidData.into());
        }
        if let Some(status) = &self.guest {
            status
                .validate(Some(&self.nonce))
                .map_err(|_| std::io::ErrorKind::InvalidData)?;
        }
        Ok(())
    }
}
fn valid_job(job: &JobIdentity) -> bool {
    let valid = |part: &str| {
        !part.is_empty()
            && part.len() <= 100
            && part != "."
            && part != ".."
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || b"-_.".contains(&byte))
    };
    job.repository
        .split_once('/')
        .is_some_and(|(owner, name)| valid(owner) && valid(name))
        && job.run_id > 0
        && job.run_attempt > 0
        && job.job_id > 0
}
fn private(metadata: &fs::Metadata) -> bool {
    metadata.uid() == rustix::process::geteuid().as_raw() && metadata.mode() & 0o077 == 0
}
fn directory(path: &Path) -> std::io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_dir() || !private(&metadata) {
        return Err(std::io::ErrorKind::PermissionDenied.into());
    }
    Ok(())
}
pub fn load(directory_path: &Path, nonce: &str) -> std::io::Result<Option<Summary>> {
    if !crate::guest::valid_attempt(nonce) {
        return Err(std::io::ErrorKind::InvalidInput.into());
    }
    match load_file(directory_path, nonce, &format!("attempt-{nonce}.json"))? {
        Some(summary) => Ok(Some(summary)),
        None => load_file(directory_path, nonce, FILE),
    }
}
fn load_file(
    directory_path: &Path,
    nonce: &str,
    filename: &str,
) -> std::io::Result<Option<Summary>> {
    directory(directory_path)?;
    let file = match OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(directory_path.join(filename))
    {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.nlink() != 1 || !private(&metadata) || metadata.len() > LIMIT
    {
        return Err(std::io::ErrorKind::PermissionDenied.into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > LIMIT {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    let summary: Summary = serde_json::from_slice(&bytes)?;
    summary.validate()?;
    Ok((summary.nonce == nonce).then_some(summary))
}
pub fn save(directory_path: &Path, summary: &Summary) -> std::io::Result<()> {
    summary.validate()?;
    save_file(
        directory_path,
        summary,
        &format!("attempt-{}.json", summary.nonce),
    )?;
    save_file(directory_path, summary, FILE)
}
fn save_file(directory_path: &Path, summary: &Summary, filename: &str) -> std::io::Result<()> {
    directory(directory_path)?;
    summary.validate()?;
    let bytes = serde_json::to_vec(summary)?;
    if bytes.len() as u64 > LIMIT {
        return Err(std::io::ErrorKind::InvalidData.into());
    }
    let mut pending = tempfile::NamedTempFile::new_in(directory_path)?;
    pending
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))?;
    pending.write_all(&bytes)?;
    pending.as_file().sync_all()?;
    pending
        .persist(directory_path.join(filename))
        .map_err(|error| error.error)?;
    File::open(directory_path)?.sync_all()
}

/// Retain every owned attempt and the latest 32 completed summaries.
pub fn prune(directory_path: &Path, owned: &[&str]) -> std::io::Result<()> {
    directory(directory_path)?;
    let mut completed = Vec::new();
    for entry in fs::read_dir(directory_path)? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(nonce) = name
            .to_str()
            .and_then(|name| name.strip_prefix("attempt-"))
            .and_then(|name| name.strip_suffix(".json"))
        else {
            continue;
        };
        if !crate::guest::valid_attempt(nonce) || owned.contains(&nonce) {
            continue;
        }
        let metadata = fs::symlink_metadata(entry.path())?;
        if metadata.is_file() && private(&metadata) {
            completed.push((metadata.modified()?, entry.path()));
        }
    }
    completed.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    for (_, path) in completed.into_iter().skip(32) {
        fs::remove_file(path)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
        dir
    }
    fn summary() -> Summary {
        Summary {
            schema: 1,
            nonce: "a".repeat(32),
            platform: crate::config::Platform::MacosArm64,
            candidate: JobIdentity {
                repository: "owner/repo".into(),
                run_id: 1,
                run_attempt: 1,
                job_id: 2,
            },
            assigned: Some(JobIdentity {
                repository: "owner/repo".into(),
                run_id: 3,
                run_attempt: 2,
                job_id: 4,
            }),
            runner_id: Some(5),
            runner_name: Some(format!("homelab-macbook-job-{}", "a".repeat(32))),
            vm_name: Some(format!("homelab-macbook-job-{}", "a".repeat(32))),
            updated_at: 1,
            last_operation: Operation::StartRunner,
            last_outcome: EffectState::Started,
            first_failure: None,
            latest_failure: None,
            guest: None,
        }
    }
    #[test]
    fn concurrent_summaries_survive_each_other_and_retention_preserves_owned_attempts() {
        let dir = directory();
        let mut first_nonce = String::new();
        for i in 0..36 {
            let mut record = summary();
            record.nonce = format!("{i:032x}");
            record.vm_name = Some(format!("homelab-macbook-job-{}", record.nonce));
            record.runner_name = record.vm_name.clone();
            if i == 0 {
                first_nonce = record.nonce.clone();
            }
            save(dir.path(), &record).unwrap();
        }
        assert!(load(dir.path(), &first_nonce).unwrap().is_some());
        prune(dir.path(), &[&first_nonce]).unwrap();
        assert!(load(dir.path(), &first_nonce).unwrap().is_some());
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 34);
        assert!(load(dir.path(), "../other").is_err());
    }
    #[test]
    fn legacy_summaries_remain_readable_and_name_mismatches_are_rejected() {
        let dir = directory();
        let mut old = serde_json::to_value(summary()).unwrap();
        old.as_object_mut().unwrap().remove("runner_name");
        old.as_object_mut().unwrap().remove("vm_name");
        let legacy: Summary = serde_json::from_value(old).unwrap();
        save(dir.path(), &legacy).unwrap();
        assert!(
            load(dir.path(), &legacy.nonce)
                .unwrap()
                .unwrap()
                .vm_name
                .is_none()
        );

        let mut invalid = summary();
        invalid.runner_name = Some(format!("homelab-other-job-{}", "b".repeat(32)));
        assert!(save(dir.path(), &invalid).is_err());
    }

    #[test]
    fn private_bounded_summary_survives_restart_and_never_crosses_attempts() {
        let dir = directory();
        let nonce = "a".repeat(32);
        let mut summary = summary();
        summary.failure(Operation::StartRunner, SafeError::ProcessRejected, 2);
        summary.failure(Operation::DeleteRunner, SafeError::Rejected, 3);
        save(dir.path(), &summary).unwrap();
        assert_eq!(
            fs::metadata(dir.path().join(FILE)).unwrap().mode() & 0o777,
            0o600
        );
        let recovered = load(dir.path(), &nonce).unwrap().unwrap();
        assert_eq!(recovered.candidate, summary.candidate);
        assert_eq!(recovered.assigned, summary.assigned);
        assert_ne!(
            recovered.candidate.job_id,
            recovered.assigned.as_ref().unwrap().job_id
        );
        assert_eq!(recovered.runner_id, Some(5));
        assert_eq!(
            recovered.first_failure.unwrap().operation,
            Operation::StartRunner
        );
        assert_eq!(
            recovered.latest_failure.unwrap().operation,
            Operation::DeleteRunner
        );
        assert!(load(dir.path(), &"b".repeat(32)).unwrap().is_none());
        assert!(fs::metadata(dir.path().join(FILE)).unwrap().len() < LIMIT);
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn job_identity_validation_is_bounded_and_keeps_assignment_in_candidate_repository() {
        let dir = directory();
        let mut summary = summary();
        summary.candidate.repository = format!("{}/{}", "a".repeat(100), "b".repeat(100));
        summary.assigned.as_mut().unwrap().repository = summary.candidate.repository.clone();
        save(dir.path(), &summary).unwrap();
        assert!(fs::metadata(dir.path().join(FILE)).unwrap().len() < LIMIT);
        for repository in [
            "owner/other".to_owned(),
            "owner/repo/extra".into(),
            "owner/repo\n".into(),
            format!("{}/repo", "a".repeat(101)),
        ] {
            summary.assigned.as_mut().unwrap().repository = repository;
            assert!(save(dir.path(), &summary).is_err());
        }
        summary.assigned = None;
        summary.runner_id = Some(0);
        assert!(save(dir.path(), &summary).is_err());
        summary.runner_id = None;
        summary.candidate.job_id = 0;
        assert!(save(dir.path(), &summary).is_err());
    }
    #[test]
    fn fifo_is_rejected_without_waiting_for_a_writer() {
        let dir = directory();
        assert!(
            std::process::Command::new("/usr/bin/mkfifo")
                .arg(dir.path().join(FILE))
                .status()
                .unwrap()
                .success()
        );
        let path = dir.path().to_path_buf();
        let (send, receive) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            send.send(load(&path, &"a".repeat(32)).is_err()).unwrap();
        });
        assert!(
            receive
                .recv_timeout(std::time::Duration::from_secs(1))
                .expect("opening a FIFO must not block before metadata validation")
        );
    }
    #[test]
    fn invalid_or_unprotected_status_is_never_imported() {
        let dir = directory();
        let nonce = "a".repeat(32);
        let mut summary = summary();
        summary.guest = Some(GuestStatus {
            schema: 1,
            attempt_id: Some("b".repeat(32)),
            phase: crate::guest::GuestPhase::Exited,
            updated_at: 1,
            exit_code: Some(5),
            reason: Some(crate::guest::TerminalReason::ProcessExited),
        });
        assert!(save(dir.path(), &summary).is_err());
        assert!(!dir.path().join(FILE).exists());
        fs::write(dir.path().join(FILE), vec![b'x'; LIMIT as usize + 1]).unwrap();
        assert!(load(dir.path(), &nonce).is_err());
        fs::remove_file(dir.path().join(FILE)).unwrap();
        let target = dir.path().join("untouched");
        fs::write(&target, b"DO_NOT_READ_OR_REPLACE").unwrap();
        std::os::unix::fs::symlink(&target, dir.path().join(FILE)).unwrap();
        assert!(load(dir.path(), &nonce).is_err());
        summary.guest = None;
        save(dir.path(), &summary).unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"DO_NOT_READ_OR_REPLACE");
        fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(save(dir.path(), &summary).is_err());
    }
}
