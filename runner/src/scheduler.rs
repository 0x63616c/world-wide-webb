//! Pure decisions. Persist `Decision.next` durably before executing its optional effect.
//! Pending intents are reconciliation requests, never permission to replay an effect.
use crate::{config::Config, state::*};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub job: JobIdentity,
    pub created_at: u64,
    pub labels: Vec<String>,
    pub group: Option<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum VmObservation {
    Unknown,
    Absent,
    Stopped,
    Running,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunnerObservation {
    Unknown,
    Absent,
    Idle,
    Busy(JobIdentity),
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GuestObservation {
    Unknown,
    Ready,
    Listening,
    Running,
    Exited,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Outcome {
    Succeeded { runner_id: Option<u64> },
    // Resource may exist: cleanup still requires authoritative inventory.
    Failed,
    // A JIT registration recovered after restart has no reusable secret.
    RecoveredJit { runner_id: u64 },
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectResult {
    pub ticket: u64,
    pub outcome: Outcome,
}

#[derive(Clone, Debug)]
pub struct Observation {
    /// False for stale/partial discovery, API backoff, or unknown orphan inventory.
    pub admission_safe: bool,
    pub candidates: Vec<Candidate>,
    /// Freshly revalidated queued jobs, after full discovery and immediately before admission.
    pub revalidated: Vec<JobIdentity>,
    pub free_bytes: Option<u64>,
    /// Cryptographically random externally generated 32 lowercase hex characters.
    pub admission_nonce: Option<String>,
    /// These observations MUST refer to the exact journal-owned VM/runner.
    pub vm: VmObservation,
    pub runner: RunnerObservation,
    pub guest: GuestObservation,
    pub effect_result: Option<EffectResult>,
}
impl Default for Observation {
    fn default() -> Self {
        Self {
            admission_safe: false,
            candidates: vec![],
            revalidated: vec![],
            free_bytes: None,
            admission_nonce: None,
            vm: VmObservation::Unknown,
            runner: RunnerObservation::Unknown,
            guest: GuestObservation::Unknown,
            effect_result: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Effect {
    pub ticket: u64,
    pub operation: Operation,
    pub attempt: Attempt,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Decision {
    pub next: Journal,
    pub effect: Option<Effect>,
    pub reason: &'static str,
}

fn stay(next: Journal, reason: &'static str) -> Decision {
    Decision {
        next,
        effect: None,
        reason,
    }
}
fn intent(mut next: Journal, operation: Operation) -> Decision {
    let Some(ticket) = next.sequence.checked_add(1) else {
        return stay(next, "intent counter exhausted");
    };
    next.sequence = ticket;
    let attempt = next
        .active
        .as_mut()
        .expect("intent requires an owned attempt");
    attempt.pending = Some(Intent { ticket, operation });
    if operation == Operation::BootVm {
        attempt.boot_lease_version = 1;
    }
    let effect = Effect {
        ticket,
        operation,
        attempt: attempt.clone(),
    };
    Decision {
        next,
        effect: Some(effect),
        reason: "persist intent before effect",
    }
}
fn supported(candidate: &Candidate) -> bool {
    let labels: Vec<_> = candidate
        .labels
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();
    candidate.group.is_none()
        && labels.iter().any(|s| s == "homelab-tart")
        && labels
            .iter()
            .all(|s| ["self-hosted", "macos", "arm64", "homelab-tart"].contains(&s.as_str()))
}

pub fn decide(config: &Config, journal: &Journal, observed: &Observation, now: u64) -> Decision {
    let mut next = journal.clone();
    if journal.validate().is_err() {
        return stay(next, "invalid journal; admission blocked");
    }
    if let Some(attempt) = next.active.as_mut() {
        // Resolve exactly one durable intent. An absent or mismatched result is NOT a retry.
        if let Some(pending) = attempt.pending.clone() {
            let Some(result) = observed
                .effect_result
                .as_ref()
                .filter(|r| r.ticket == pending.ticket)
            else {
                return stay(next, "reconcile pending intent");
            };
            match result.outcome {
                Outcome::Unknown => return stay(next, "effect outcome unknown; slot retained"),
                Outcome::Failed => {
                    attempt.phase = Phase::Cleaning;
                }
                Outcome::RecoveredJit { runner_id }
                    if pending.operation == Operation::CreateJit =>
                {
                    attempt.runner_id = Some(runner_id);
                    attempt.jit_created = true;
                    attempt.phase = Phase::Cleaning;
                }
                Outcome::RecoveredJit { .. } => return stay(next, "invalid reconciliation result"),
                Outcome::Succeeded { runner_id } => match pending.operation {
                    Operation::CloneVm => attempt.vm_created = true,
                    Operation::BootVm => attempt.vm_booted = true,
                    Operation::PrepareGuest => attempt.guest_prepared = true,
                    Operation::CreateJit => {
                        let Some(id) = runner_id.filter(|id| *id > 0) else {
                            return stay(next, "JIT result missing runner identity");
                        };
                        attempt.runner_id = Some(id);
                        attempt.jit_created = true;
                    }
                    Operation::StartRunner => {
                        attempt.runner_started = true;
                        attempt.phase = Phase::Listening;
                    }
                    Operation::StopVm | Operation::DeleteVm | Operation::DeleteRunner => {}
                },
            }
            attempt.pending = None;
            return stay(next, "effect resolved; refresh inventory");
        }

        // Actual server assignment overrides the capacity hint, including its cancellation.
        if let RunnerObservation::Busy(job) = &observed.runner {
            if job.repository != attempt.repository.key() {
                return stay(
                    next,
                    "assigned job has wrong repository; reconciliation required",
                );
            }
            if let Some(existing) = &attempt.assigned {
                if existing != job {
                    return stay(
                        next,
                        "one-job runner identity changed; reconciliation required",
                    );
                }
            } else {
                attempt.assigned = Some(job.clone());
                attempt.running_deadline = Some(now.saturating_add(attempt.running_seconds));
            }
            if attempt.phase != Phase::Cleaning {
                attempt.phase = Phase::Running;
            }
        }
        let deadline = match attempt.phase {
            Phase::Starting => Some(attempt.boot_deadline),
            Phase::Listening => attempt.unassigned_deadline,
            Phase::Running => attempt.running_deadline,
            Phase::Cleaning => None,
        };
        let interrupted = attempt.vm_booted
            && matches!(observed.vm, VmObservation::Absent | VmObservation::Stopped);
        let disk_emergency = observed
            .free_bytes
            .is_some_and(|n| n < config.emergency_free_bytes);
        if deadline.is_some_and(|d| now >= d)
            || interrupted
            || disk_emergency
            || observed.guest == GuestObservation::Exited
        {
            attempt.phase = Phase::Cleaning;
        }
        match attempt.phase {
            Phase::Starting => {
                if !attempt.vm_created {
                    return intent(next, Operation::CloneVm);
                }
                if !attempt.vm_booted {
                    return intent(next, Operation::BootVm);
                }
                if observed.vm == VmObservation::Running && !attempt.guest_prepared {
                    return intent(next, Operation::PrepareGuest);
                }
                if observed.vm == VmObservation::Running
                    && observed.guest == GuestObservation::Ready
                {
                    if !attempt.jit_created {
                        return intent(next, Operation::CreateJit);
                    }
                    if !attempt.runner_started {
                        attempt.unassigned_deadline =
                            Some(now.saturating_add(attempt.unassigned_seconds));
                        return intent(next, Operation::StartRunner);
                    }
                }
                stay(next, "waiting for guest readiness")
            }
            Phase::Listening | Phase::Running => stay(next, "observing one-job runner"),
            Phase::Cleaning => match observed.vm {
                VmObservation::Unknown => stay(next, "VM inventory unknown; cleanup retains slot"),
                VmObservation::Running => intent(next, Operation::StopVm),
                VmObservation::Stopped => intent(next, Operation::DeleteVm),
                VmObservation::Absent => match observed.runner {
                    RunnerObservation::Unknown => {
                        stay(next, "runner inventory unknown; cleanup retains slot")
                    }
                    RunnerObservation::Idle | RunnerObservation::Busy(_) => {
                        if attempt.runner_id.is_some() {
                            intent(next, Operation::DeleteRunner)
                        } else {
                            stay(next, "runner ID must be reconciled by exact name")
                        }
                    }
                    RunnerObservation::Absent => {
                        next.active = None;
                        next.retry_after = now.saturating_add(config.deadlines.retry_seconds);
                        stay(next, "owned resources absent; slot released")
                    }
                },
            },
        }
    } else {
        if config.validate().is_err() {
            return stay(next, "invalid configuration; admission blocked");
        }
        if !config.admission_enabled {
            return stay(next, "admission disabled");
        }
        if now < next.retry_after {
            return stay(next, "admission backoff");
        }
        if !observed.admission_safe {
            return stay(next, "discovery or inventory incomplete");
        }
        if !observed
            .free_bytes
            .is_some_and(|n| n >= config.admission_free_bytes)
        {
            return stay(next, "insufficient or unknown storage");
        }
        let Some(nonce) = observed.admission_nonce.as_ref().filter(|n| {
            n.len() == 32
                && n.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        }) else {
            return stay(next, "unique attempt nonce required");
        };
        let repos: Vec<_> = config
            .repositories
            .iter()
            .filter(|r| r.trust_approved)
            .collect();
        let start = next
            .last_repository
            .as_ref()
            .and_then(|last| repos.iter().position(|r| &r.key() == last))
            .map_or(0, |i| i + 1);
        for offset in 0..repos.len() {
            let repo = repos[(start + offset) % repos.len()];
            let candidate = observed
                .candidates
                .iter()
                .filter(|c| {
                    c.job.repository == repo.key()
                        && supported(c)
                        && observed.revalidated.contains(&c.job)
                })
                .min_by_key(|c| (c.created_at, c.job.job_id));
            if let Some(candidate) = candidate {
                next.last_repository = Some(repo.key());
                next.active = Some(Attempt {
                    nonce: nonce.clone(),
                    vm_name: format!("homelab-job-{nonce}"),
                    runner_name: format!("homelab-job-{nonce}"),
                    repository: repo.clone(),
                    image: config.image.clone(),
                    cpu: config.cpu,
                    memory_mib: config.memory_mib,
                    candidate: candidate.job.clone(),
                    assigned: None,
                    phase: Phase::Starting,
                    boot_deadline: now.saturating_add(config.deadlines.boot_seconds),
                    unassigned_deadline: None,
                    running_deadline: None,
                    running_seconds: config.deadlines.running_seconds,
                    unassigned_seconds: config.deadlines.unassigned_seconds,
                    vm_created: false,
                    vm_booted: false,
                    boot_lease_version: 0,
                    guest_prepared: false,
                    jit_created: false,
                    runner_started: false,
                    runner_id: None,
                    pending: None,
                });
                return intent(next, Operation::CloneVm);
            }
        }
        stay(next, "no eligible demand")
    }
}
