//! Durable intent, never secrets. Times are absolute Unix seconds.
use crate::config::RepositoryConfig;
use serde::{Deserialize, Serialize};

pub const JOURNAL_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct JobIdentity {
    pub repository: String,
    pub run_id: u64,
    pub run_attempt: u32,
    pub job_id: u64,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Phase {
    Starting,
    Listening,
    Running,
    Cleaning,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    pub nonce: String,
    pub vm_name: String,
    pub runner_name: String,
    // Snapshot keeps cleanup valid after allowlist/image/tool configuration changes.
    pub repository: RepositoryConfig,
    pub image: String,
    pub cpu: u16,
    pub memory_mib: u32,
    pub candidate: JobIdentity,
    pub assigned: Option<JobIdentity>,
    pub phase: Phase,
    pub boot_deadline: u64,
    pub unassigned_deadline: Option<u64>,
    pub running_deadline: Option<u64>,
    pub running_seconds: u64,
    pub unassigned_seconds: u64,
    pub vm_created: bool,
    pub vm_booted: bool,
    /// Version 1 journals boot's inherited operation lease before spawning.
    /// Missing legacy fields cannot establish process quiescence on recovery.
    #[serde(default)]
    pub boot_lease_version: u8,
    #[serde(default)]
    pub guest_prepared: bool,
    pub jit_created: bool,
    pub runner_started: bool,
    pub runner_id: Option<u64>,
    pub pending: Option<Intent>,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub enum Operation {
    CloneVm,
    BootVm,
    PrepareGuest,
    CreateJit,
    StartRunner,
    StopVm,
    DeleteVm,
    DeleteRunner,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Intent {
    pub ticket: u64,
    pub operation: Operation,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Journal {
    pub version: u32,
    pub sequence: u64,
    pub last_repository: Option<String>,
    pub retry_after: u64,
    pub active: Option<Attempt>,
}
impl Default for Journal {
    fn default() -> Self {
        Self {
            version: JOURNAL_VERSION,
            sequence: 0,
            last_repository: None,
            retry_after: 0,
            active: None,
        }
    }
}
impl Journal {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.version != JOURNAL_VERSION {
            return Err("unsupported journal version");
        }
        if let Some(a) = &self.active {
            if a.nonce.len() != 32
                || !a
                    .nonce
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
                || a.vm_name != format!("homelab-job-{}", a.nonce)
                || a.runner_name != format!("homelab-job-{}", a.nonce)
            {
                return Err("invalid attempt ownership");
            }
            if a.candidate.repository != a.repository.key()
                || a.boot_lease_version > 1
                || a.assigned
                    .as_ref()
                    .is_some_and(|j| j.repository != a.repository.key())
                || a.pending
                    .as_ref()
                    .is_some_and(|p| p.ticket == 0 || p.ticket != self.sequence)
                || (a.jit_created && a.runner_id.is_none())
                || (a.vm_booted && !a.vm_created)
                || (a.guest_prepared && !a.vm_booted)
                || (a.jit_created && !a.vm_booted)
                || (a.runner_started && !a.jit_created)
                || (matches!(a.phase, Phase::Listening | Phase::Running) && !a.runner_started)
                || (a.phase == Phase::Running
                    && (a.assigned.is_none() || a.running_deadline.is_none()))
                || (a.phase == Phase::Listening && a.unassigned_deadline.is_none())
            {
                return Err("inconsistent attempt state");
            }
        }
        Ok(())
    }
}
