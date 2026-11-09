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
    pub attempts: std::collections::BTreeMap<String, Box<Observation>>,
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
            attempts: Default::default(),
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
    candidate.group.is_none() && crate::config::Platform::resolve(&candidate.labels).is_some()
}

fn decide_one(config: &Config, journal: &Journal, observed: &Observation, now: u64) -> Decision {
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
                let platform =
                    crate::config::Platform::resolve(&candidate.labels).expect("supported profile");
                let (image, cpu, memory_mib, disk_growth_bytes) = match platform {
                    crate::config::Platform::MacosArm64 => (
                        config.image.clone(),
                        config.cpu,
                        config.memory_mib,
                        config
                            .admission_free_bytes
                            .saturating_sub(config.emergency_free_bytes),
                    ),
                    crate::config::Platform::LinuxArm64
                    | crate::config::Platform::LinuxOperationsArm64 => {
                        let Some(linux) = &config.linux else {
                            continue;
                        };
                        (
                            linux.image.clone(),
                            linux.cpu,
                            linux.memory_mib,
                            linux.disk_growth_bytes,
                        )
                    }
                };
                next.last_repository = Some(repo.key());
                next.active = Some(Attempt {
                    nonce: nonce.clone(),
                    vm_name: crate::names::attempt_name(&config.host_name, nonce),
                    runner_name: crate::names::attempt_name(&config.host_name, nonce),
                    repository: repo.clone(),
                    platform,
                    disk_growth_bytes,
                    linux_profile: platform.is_linux().then(|| config.linux.clone()).flatten(),
                    image,
                    cpu,
                    memory_mib,
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

/// Advance independent lifecycles fairly, then admit at most one new attempt.
/// One durable writer allocates globally unique operation tickets.
pub fn decide(config: &Config, journal: &Journal, observed: &Observation, now: u64) -> Decision {
    if journal.validate().is_err() {
        return stay(journal.clone(), "invalid journal; admission blocked");
    }
    let mut attempts: Vec<_> = journal.attempts().cloned().collect();
    let start = journal
        .last_attempt
        .as_ref()
        .and_then(|last| attempts.iter().position(|a| &a.nonce == last))
        .map_or(0, |i| i + 1);
    for offset in 0..attempts.len() {
        let i = (start + offset) % attempts.len();
        let attempt = &attempts[i];
        // Fleet observations never borrow another attempt's VM/runner evidence.
        let unknown = Observation::default();
        let observation = if let Some(result) = &observed.effect_result {
            if attempt
                .pending
                .as_ref()
                .is_none_or(|p| p.ticket != result.ticket)
            {
                continue;
            }
            observed
        } else {
            observed
                .attempts
                .get(&attempt.nonce)
                .map(|o| o.as_ref())
                .unwrap_or(
                    if journal.additional.is_empty() && observed.attempts.is_empty() {
                        observed
                    } else {
                        &unknown
                    },
                )
        };
        let projected = journal.project(Some(attempt.clone()));
        let mut decision = decide_one(config, &projected, observation, now);
        if decision.next == projected && decision.effect.is_none() {
            continue;
        }
        let next_attempt = decision.next.active.take();
        let nonce = attempts[i].nonce.clone();
        match next_attempt {
            Some(next) => attempts[i] = next,
            None => {
                attempts.remove(i);
            }
        }
        let mut next = journal.clone();
        next.sequence = decision.next.sequence;
        // Cleanup backoff must not stall healthy peers or unrelated free slots.
        if attempts.is_empty() {
            next.retry_after = decision.next.retry_after;
        }
        next.last_attempt = Some(nonce);
        next.active = attempts.first().cloned();
        next.additional = attempts.into_iter().skip(1).collect();
        return Decision { next, ..decision };
    }
    // Resolution steps only record their result; they never create an unexecuted effect.
    if observed.effect_result.is_some() {
        return stay(journal.clone(), "effect result retained for reconciliation");
    }
    if attempts.len() >= config.max_concurrent_jobs {
        return stay(journal.clone(), "capacity occupied");
    }
    if observed
        .admission_nonce
        .as_ref()
        .is_some_and(|nonce| attempts.iter().any(|a| &a.nonce == nonce))
    {
        return stay(journal.clone(), "attempt nonce already owned");
    }
    let projected = journal.project(None);
    let mut demand = observed.clone();
    filter_reserved(&mut demand.candidates, journal);
    // One shared host budget. Unknown outcomes continue owning their reservations.
    use crate::config::Platform;
    let mac_count = attempts
        .iter()
        .filter(|a| a.platform == Platform::MacosArm64)
        .count();
    let used_cpu: u64 = attempts.iter().map(|a| u64::from(a.cpu)).sum();
    let used_memory: u64 = attempts.iter().map(|a| u64::from(a.memory_mib)).sum();
    // Conservatively retain the full growth bound until trusted physical-growth
    // accounting is available. Free space already excludes consumed disk blocks.
    let legacy_growth = config
        .admission_free_bytes
        .saturating_sub(config.emergency_free_bytes);
    let used_growth = attempts.iter().fold(0u64, |sum, a| {
        sum.saturating_add(if a.disk_growth_bytes == 0 {
            legacy_growth
        } else {
            a.disk_growth_bytes
        })
    });
    // Resolve eligibility before testing today's free resources. Otherwise a
    // temporarily blocked macOS job disappears from the reservation calculation
    // and replacement Linux guests can keep it waiting indefinitely.
    let mut seen = std::collections::BTreeSet::new();
    demand.candidates.retain(|c| {
        observed.revalidated.contains(&c.job)
            && c.group.is_none()
            && seen.insert((
                c.job.repository.clone(),
                c.job.run_id,
                c.job.run_attempt,
                c.job.job_id,
            ))
            && config
                .repositories
                .iter()
                .any(|r| r.trust_approved && r.key() == c.job.repository)
            && match Platform::resolve(&c.labels) {
                Some(Platform::MacosArm64) => mac_count < config.max_macos_guests,
                Some(Platform::LinuxArm64 | Platform::LinuxOperationsArm64) => config
                    .linux
                    .as_ref()
                    .is_some_and(|linux| linux.routing_audit_approved),
                None => false,
            }
    });
    // Already-owned candidate/assignment identities were removed above. Other
    // unassigned compatible listeners can cover one further queued job each.
    let mut covered = Vec::new();
    for attempt in &attempts {
        if attempt.platform != Platform::MacosArm64
            || attempt.assigned.is_some()
            || !matches!(attempt.phase, Phase::Starting | Phase::Listening)
            || observed
                .candidates
                .iter()
                .any(|c| c.job == attempt.candidate)
        {
            continue;
        }
        if let Some(c) = demand.candidates.iter().find(|c| {
            c.job.repository == attempt.repository.key()
                && Platform::resolve(&c.labels) == Some(Platform::MacosArm64)
                && !covered.contains(&c.job)
        }) {
            covered.push(c.job.clone());
        }
    }
    demand.candidates.retain(|c| !covered.contains(&c.job));
    let waiting_macs = demand
        .candidates
        .iter()
        .filter(|c| Platform::resolve(&c.labels) == Some(Platform::MacosArm64))
        .count()
        .min(config.max_macos_guests.saturating_sub(mac_count));
    demand.candidates.retain(|c| {
        let Some(platform) = Platform::resolve(&c.labels) else {
            return false;
        };
        let (cpu, memory, growth) = match platform {
            Platform::MacosArm64 if mac_count < config.max_macos_guests => {
                (config.cpu, config.memory_mib, legacy_growth)
            }
            Platform::LinuxArm64 | Platform::LinuxOperationsArm64 => match &config.linux {
                Some(linux) if linux.routing_audit_approved => {
                    (linux.cpu, linux.memory_mib, linux.disk_growth_bytes)
                }
                _ => return false,
            },
            _ => return false,
        };
        let reserve_macs = if platform.is_linux() { waiting_macs } else { 0 };
        attempts
            .len()
            .saturating_add(1)
            .saturating_add(reserve_macs)
            <= config.max_concurrent_jobs
            && used_cpu
                .saturating_add(u64::from(cpu))
                .saturating_add((reserve_macs as u64).saturating_mul(u64::from(config.cpu)))
                <= u64::from(config.cpu_budget)
            && used_memory
                .saturating_add(u64::from(memory))
                .saturating_add((reserve_macs as u64).saturating_mul(u64::from(config.memory_mib)))
                <= u64::from(config.memory_budget_mib)
            && observed.free_bytes.is_some_and(|free| {
                free >= config
                    .emergency_free_bytes
                    .saturating_add(used_growth)
                    .saturating_add(growth)
                    .saturating_add((reserve_macs as u64).saturating_mul(legacy_growth))
            })
    });
    // Prioritize uncovered macOS demand without preempting borrowed Linux slots.
    // Future reservations prevent resource fragmentation; macOS is not charged twice.
    if demand
        .candidates
        .iter()
        .any(|c| Platform::resolve(&c.labels) == Some(Platform::MacosArm64))
    {
        demand
            .candidates
            .retain(|c| Platform::resolve(&c.labels) == Some(Platform::MacosArm64));
    }
    let mut decision = decide_one(config, &projected, &demand, now);
    if let Some(attempt) = decision.next.active.take() {
        attempts.push(attempt);
        let mut next = decision.next;
        next.active = attempts.first().cloned();
        next.additional = attempts.into_iter().skip(1).collect();
        next.last_attempt = journal.last_attempt.clone();
        Decision {
            next,
            effect: decision.effect,
            reason: decision.reason,
        }
    } else {
        stay(journal.clone(), decision.reason)
    }
}

pub fn filter_reserved(candidates: &mut Vec<Candidate>, journal: &Journal) {
    candidates.retain(|candidate| {
        !journal.attempts().any(|attempt| {
            attempt.assigned.as_ref().unwrap_or(&attempt.candidate) == &candidate.job
        })
    });
}
