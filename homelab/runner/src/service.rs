//! Runtime composition. External effects are issued only through the durable engine.
use crate::{
    config::{Config, RepositoryConfig},
    diagnostics::{self, EffectState, SafeError, Summary},
    engine::{Engine, EngineBackend},
    gate::Gate,
    github::{AppCredentials, ErrorCategory, GithubApi, GithubJob, JitConfig, Repository, Runner},
    guest::GuestPhase,
    scheduler::{
        Candidate, Effect, EffectResult, GuestObservation, Observation, Outcome, RunnerObservation,
        VmObservation,
    },
    state::{Attempt, JobIdentity, Journal, Operation, Phase},
    store::Store,
    tart::{LocalVm, OwnedVmName, RunningVm, Tart, TartConfig, VmState},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::File,
    io::Read,
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeConfig {
    pub policy: Config,
    pub app_id: String,
    pub app_key_file: PathBuf,
    pub state_directory: PathBuf,
    pub control_directory: PathBuf,
    pub tart: TartConfig,
    #[serde(default)]
    pub keychain: Option<crate::keychain::KeychainConfig>,
}
#[derive(Debug, thiserror::Error)]
pub enum ServiceError {
    #[error("runtime configuration is invalid or unreadable")]
    Configuration,
    #[error("max_concurrent_jobs must be between 1 and 4")]
    Concurrency,
    #[error("runtime configuration JSON invalid: {category} at line {line}, column {column}")]
    ConfigurationSyntax {
        category: &'static str,
        line: usize,
        column: usize,
    },
    #[error("controller state cannot be opened or committed")]
    State,
    #[error("reviewed Tart executable or helper preflight failed")]
    Preflight,
    #[error("dedicated service keychain preparation failed")]
    Keychain,
    #[error("controller signal initialization failed")]
    Signal,
}
impl RuntimeConfig {
    pub fn load(path: &Path) -> Result<Self, ServiceError> {
        let file = File::open(path).map_err(|_| ServiceError::Configuration)?;
        if !file
            .metadata()
            .map_err(|_| ServiceError::Configuration)?
            .is_file()
        {
            return Err(ServiceError::Configuration);
        }
        let mut bytes = Vec::new();
        file.take(1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| ServiceError::Configuration)?;
        if bytes.len() > 1024 * 1024 {
            return Err(ServiceError::Configuration);
        }
        let config: Self =
            serde_json::from_slice(&bytes).map_err(|error| ServiceError::ConfigurationSyntax {
                category: match error.classify() {
                    serde_json::error::Category::Io => "io",
                    serde_json::error::Category::Syntax => "syntax",
                    serde_json::error::Category::Data => "schema",
                    serde_json::error::Category::Eof => "unexpected end",
                },
                line: error.line(),
                column: error.column(),
            })?;
        config.validate()?;
        Ok(config)
    }
    pub fn validate(&self) -> Result<(), ServiceError> {
        if !(1..=crate::config::MAX_CONCURRENT_JOBS).contains(&self.policy.max_concurrent_jobs) {
            return Err(ServiceError::Concurrency);
        }
        self.policy
            .validate()
            .map_err(|_| ServiceError::Configuration)?;
        if [
            &self.app_key_file,
            &self.state_directory,
            &self.control_directory,
            &self.tart.binary,
            &self.tart.home,
            &self.tart.tart_home,
            &self.tart.helper_directory,
            &self.tart.guest_helper,
            &self.tart.runner_archive,
        ]
        .iter()
        .any(|path| !path.is_absolute())
            || (self.policy.admission_enabled && self.app_id.is_empty())
        {
            return Err(ServiceError::Configuration);
        }
        Tart::new(self.tart.clone()).map_err(|_| ServiceError::Configuration)?;
        Ok(())
    }
    fn same_runtime(&self, other: &Self) -> bool {
        self.policy.host_name == other.policy.host_name
            && self.app_id == other.app_id
            && self.app_key_file == other.app_key_file
            && self.state_directory == other.state_directory
            && self.control_directory == other.control_directory
            && serde_json::to_value(&self.tart).ok() == serde_json::to_value(&other.tart).ok()
            && serde_json::to_value(&self.keychain).ok()
                == serde_json::to_value(&other.keychain).ok()
    }
}
pub fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn repository(repo: &RepositoryConfig) -> Repository {
    Repository {
        owner: repo.owner.clone(),
        name: repo.name.clone(),
        repository_id: repo.repository_id,
        installation_id: repo.installation_id,
    }
}
fn identity(repo: &RepositoryConfig, job: &GithubJob) -> Option<JobIdentity> {
    Some(JobIdentity {
        repository: repo.key(),
        run_id: job.run_id,
        run_attempt: u32::try_from(job.run_attempt).ok().filter(|v| *v > 0)?,
        job_id: job.id,
    })
}
fn candidate(repo: &RepositoryConfig, job: &GithubJob) -> Option<Candidate> {
    if job.status != "queued" || !job.supported_profile() {
        return None;
    }
    let created = chrono::DateTime::parse_from_rfc3339(&job.created_at)
        .ok()?
        .timestamp();
    Some(Candidate {
        job: identity(repo, job)?,
        created_at: u64::try_from(created).ok()?,
        labels: job.labels.clone(),
        group: None,
    })
}

/// Keep both platform queues visible to the shared scheduler. Revalidating only
/// the oldest job can hide waiting macOS demand behind older Linux jobs.
fn revalidation_candidates(
    config: &Config,
    candidates: &[Candidate],
    repo: &str,
    journal: &Journal,
) -> Vec<Candidate> {
    use crate::config::Platform;
    let mut demand = candidates.to_vec();
    crate::scheduler::filter_reserved(&mut demand, journal);
    let mut selected = Vec::new();
    for (platform, limit) in [
        (Platform::MacosArm64, config.max_macos_guests),
        (
            Platform::LinuxArm64,
            usize::from(
                config
                    .linux
                    .as_ref()
                    .is_some_and(|p| p.routing_audit_approved),
            ),
        ),
        (
            Platform::LinuxOperationsArm64,
            usize::from(
                config
                    .linux
                    .as_ref()
                    .is_some_and(|p| p.routing_audit_approved),
            ),
        ),
    ] {
        let mut queue: Vec<_> = demand
            .iter()
            .filter(|c| c.job.repository == repo && Platform::resolve(&c.labels) == Some(platform))
            .collect();
        queue.sort_by_key(|c| (c.created_at, c.job.job_id));
        let mut seen = std::collections::BTreeSet::new();
        selected.extend(
            queue
                .into_iter()
                .filter(|c| seen.insert((c.job.run_id, c.job.run_attempt, c.job.job_id)))
                .take(limit)
                .cloned(),
        );
    }
    selected
}
fn acknowledge_fleet_hold(
    gate: &Gate,
    journal: &Journal,
    observed: &mut Observation,
    inventory_safe: bool,
    busy_inventory: bool,
) {
    match gate.read_hold() {
        Ok(Some(request)) => {
            // Root may publish a hold after discovery's earlier gate read.
            // Apply it to this decision before promising that the fleet is idle.
            observed.admission_safe = false;
            if let Err(error) = gate.acknowledge(
                &request,
                journal.is_idle() && inventory_safe && !busy_inventory,
            ) {
                tracing::warn!(category=%error, "activation hold acknowledgement failed");
            }
        }
        Err(_) => observed.admission_safe = false,
        Ok(None) => {}
    }
}

#[derive(Default)]
struct RepositorySnapshot {
    jobs: Vec<GithubJob>,
    runners: Vec<Runner>,
    admission_safe: bool,
}
fn runner_observation(
    attempt: &crate::state::Attempt,
    snapshot: &RepositorySnapshot,
) -> RunnerObservation {
    let matches = snapshot
        .runners
        .iter()
        .filter(|runner| runner.name == attempt.runner_name)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [] => RunnerObservation::Absent,
        [runner] if attempt.runner_id.is_none_or(|id| id == runner.id) => {
            if runner.busy {
                let assigned = snapshot
                    .jobs
                    .iter()
                    .filter(|job| {
                        job.runner_id == Some(runner.id)
                            && job.runner_name.as_deref() == Some(&attempt.runner_name)
                            && job.status == "in_progress"
                    })
                    .filter_map(|job| identity(&attempt.repository, job))
                    .collect::<Vec<_>>();
                if assigned.len() == 1 {
                    RunnerObservation::Busy(assigned[0].clone())
                } else {
                    RunnerObservation::Unknown
                }
            } else {
                RunnerObservation::Idle
            }
        }
        _ => RunnerObservation::Unknown,
    }
}
fn github_diagnostic(category: ErrorCategory) -> SafeError {
    match category {
        ErrorCategory::Authentication => SafeError::Authentication,
        ErrorCategory::RateLimited => SafeError::RateLimited,
        ErrorCategory::Transport => SafeError::Transport,
        ErrorCategory::Rejected | ErrorCategory::NotFound => SafeError::Rejected,
        ErrorCategory::Uncertain => SafeError::OutcomeUnknown,
        _ => SafeError::InvalidResponse,
    }
}
fn tart_diagnostic(error: &crate::tart::TartError) -> SafeError {
    use crate::tart::TartError;
    match error {
        TartError::Io { .. } => SafeError::ProcessIo,
        TartError::Timeout(_) => SafeError::Timeout,
        TartError::Failed { .. } => SafeError::ProcessRejected,
        TartError::Ownership => SafeError::Ownership,
        TartError::RunnerVersion => SafeError::RunnerVersion,
        TartError::GuestIdentity => SafeError::GuestIdentity,
        TartError::GuestAlreadyClaimed => SafeError::GuestClaimed,
        TartError::CloneLeaseBusy
        | TartError::CloneLeaseInvalid
        | TartError::TerminationUnconfirmed(_) => SafeError::LeaseUnknown,
        TartError::Helper(_) | TartError::Version => SafeError::Preflight,
        TartError::Inventory => SafeError::Inventory,
        _ => SafeError::InvalidResponse,
    }
}
// Transient resources are isolated by the durable attempt nonce. Secrets never enter the journal.
#[derive(Default)]
struct AttemptResources {
    jit: Option<(String, JitConfig)>,
    running_vm: Option<(String, RunningVm)>,
    startup_quiescent: Option<String>,
    effect_not_before: u64,
    diagnostic: Option<Summary>,
    task: Option<BackgroundEffect>,
    completed: Option<EffectResult>,
}
struct BackgroundEffect {
    ticket: u64,
    operation: Operation,
    handle: tokio::task::JoinHandle<Result<(), crate::tart::TartError>>,
}

pub struct LiveBackend {
    github: GithubApi,
    tart: Tart,
    runtime: RuntimeConfig,
    gate: Gate,
    snapshots: BTreeMap<String, RepositorySnapshot>,
    snapshot_complete: bool,
    next_github_poll: u64,
    last_repositories: Vec<RepositoryConfig>,
    last_hold: Option<String>,
    jit: Option<(String, JitConfig)>,
    running_vm: Option<(String, RunningVm)>,
    /// Process-local proof only. A restart must never inherit this assertion.
    startup_quiescent: Option<String>,
    effect_not_before: u64,
    diagnostic: Option<Summary>,
    fleet_mode: bool,
    selected_attempt: Option<String>,
    resources: BTreeMap<String, AttemptResources>,
    task: Option<BackgroundEffect>,
    completed: Option<EffectResult>,
    fleet_owned: Vec<Attempt>,
    fleet_inventory_permitted: bool,
    last_inventory_safe: bool,
    inventory_loaded: bool,
    inventory_cache: Option<Vec<LocalVm>>,
    host_pressure: crate::resources::HostPressure,
}
impl LiveBackend {
    pub fn new(runtime: RuntimeConfig) -> Result<Self, ServiceError> {
        let github = GithubApi::new(AppCredentials {
            app_id: runtime.app_id.clone(),
            private_key_path: runtime.app_key_file.clone(),
        })
        .map_err(|_| ServiceError::Configuration)?;
        let tart = Tart::new(runtime.tart.clone()).map_err(|_| ServiceError::Configuration)?;
        let gate = Gate::new(&runtime.control_directory, &runtime.state_directory);
        Ok(Self {
            github,
            tart,
            runtime,
            gate,
            snapshots: BTreeMap::new(),
            snapshot_complete: false,
            next_github_poll: 0,
            last_repositories: Vec::new(),
            last_hold: None,
            jit: None,
            running_vm: None,
            startup_quiescent: None,
            effect_not_before: 0,
            diagnostic: None,
            fleet_mode: true,
            selected_attempt: None,
            resources: BTreeMap::new(),
            task: None,
            completed: None,
            fleet_owned: Vec::new(),
            fleet_inventory_permitted: true,
            last_inventory_safe: false,
            inventory_loaded: false,
            inventory_cache: None,
            host_pressure: crate::resources::HostPressure::default(),
        })
    }
    fn diagnostic_for(&mut self, attempt: &Attempt, operation: Operation) -> &mut Summary {
        if self
            .diagnostic
            .as_ref()
            .is_none_or(|summary| summary.nonce != attempt.nonce)
        {
            self.diagnostic = diagnostics::load(&self.runtime.state_directory, &attempt.nonce)
                .ok()
                .flatten()
                .or_else(|| Some(Summary::new(attempt, operation, unix_now())));
        }
        let summary = self.diagnostic.as_mut().expect("summary initialized");
        // The durable attempt is authoritative when assignment/registration
        // becomes known after this summary was first created or recovered.
        summary.platform = attempt.platform;
        summary.candidate = attempt.candidate.clone();
        summary.assigned = attempt.assigned.clone();
        summary.runner_id = attempt.runner_id;
        summary.vm_name = Some(attempt.vm_name.clone());
        summary.runner_name = Some(attempt.runner_name.clone());
        summary
    }
    fn save_diagnostic(&self) {
        if let Some(summary) = &self.diagnostic
            && diagnostics::save(&self.runtime.state_directory, summary).is_err()
        {
            tracing::warn!(operation="persist_safe_diagnostic",category="io_or_permissions",attempt=%summary.nonce,"typed diagnostic unavailable; journal remains cleanup authority");
        }
    }
    fn record_failure(&mut self, attempt: &Attempt, operation: Operation, category: SafeError) {
        self.diagnostic_for(attempt, operation)
            .failure(operation, category, unix_now());
        self.diagnostic_for(attempt, operation).last_outcome = EffectState::Failed;
        self.save_diagnostic();
    }
    pub async fn preflight(&self) -> Result<(), ServiceError> {
        if let Some(config) = &self.runtime.keychain {
            let proof = crate::keychain::prepare(config)
                .await
                .inspect_err(|error|tracing::error!(operation="prepare_keychain",category=%error,"service preflight failed"))
                .map_err(|_| ServiceError::Keychain)?;
            if !proof.login_selected {
                tracing::error!(
                    operation = "select_login_keychain",
                    category = "selection_unverified",
                    "service preflight failed"
                );
                return Err(ServiceError::Keychain);
            }
        }
        self.tart
            .verify_helper()
            .inspect_err(|error|tracing::error!(operation="verify_privileged_helper",category=%error,"service preflight failed"))
            .map_err(|_| ServiceError::Preflight)?;
        self.tart
            .verify_version()
            .await
            .inspect_err(|error|tracing::error!(operation="verify_tart_version",category=%error,"service preflight failed"))
            .map_err(|_| ServiceError::Preflight)
    }
    async fn refresh(&mut self, config: &Config, journal: &Journal, now: u64) {
        let mut repositories = config.repositories.clone();
        let owned = if self.fleet_mode {
            self.fleet_owned.clone()
        } else {
            journal.attempts().cloned().collect()
        };
        for attempt in &owned {
            // Cleanup continues against the saved repository identity even if a
            // new configuration reuses the same owner/name with different IDs.
            repositories.retain(|repo| repo.key() != attempt.repository.key());
            repositories.push(attempt.repository.clone());
        }
        if repositories != self.last_repositories {
            self.next_github_poll = 0;
            self.last_repositories = repositories.clone();
        }
        if now < self.next_github_poll {
            return;
        }
        self.snapshot_complete = false;
        self.snapshots.clear();
        let mut complete = true;
        for repo in repositories {
            let repo_api = repository(&repo);
            let runners = match self.github.list_runners(&repo_api).await {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(operation=error.operation,category=?error.category,repository=%repo.key(),"GitHub inventory unavailable");
                    complete = false;
                    continue;
                }
            };
            // Runner inventory is independently useful for cleanup and drain even
            // when the public-repository trust setting or demand read is unavailable.
            let settings_safe = match self.github.settings_preflight(&repo_api).await {
                Ok(_) => true,
                Err(error) => {
                    tracing::warn!(operation=error.operation,category=?error.category,repository=%repo.key(),"repository admission preflight failed; runner cleanup remains enabled");
                    false
                }
            };
            let mut admission_safe = settings_safe;
            let jobs = if settings_safe && (config.admission_enabled || !owned.is_empty()) {
                match self.github.discover_jobs(&repo_api).await {
                    Ok(value) => value,
                    Err(error) => {
                        tracing::warn!(operation=error.operation,category=?error.category,repository=%repo.key(),"GitHub demand unavailable");
                        admission_safe = false;
                        Vec::new()
                    }
                }
            } else {
                Vec::new()
            };
            self.snapshots.insert(
                repo.key(),
                RepositorySnapshot {
                    jobs,
                    runners,
                    admission_safe,
                },
            );
        }
        self.snapshot_complete = complete;
        self.next_github_poll = now
            .saturating_add(self.github.poll_interval_seconds().max(30))
            .max(self.github.retry_not_before());
    }
    fn pending_clone_finished(&self, journal: &Journal) -> bool {
        journal
            .active
            .as_ref()
            .filter(|attempt| {
                attempt
                    .pending
                    .as_ref()
                    .is_some_and(|pending| pending.operation == Operation::CloneVm)
            })
            .and_then(|attempt| OwnedVmName::parse(&attempt.vm_name).ok())
            .is_some_and(|name| match self.tart.clone_operation_finished(&name) {
                Ok(finished)=>finished,
                Err(error)=>{tracing::warn!(operation="check_clone_lease",category=%error,vm=%name.as_str(),"clone operation completion unknown; slot retained");false},
            })
    }
    async fn startup_cleanup_quiescent(&mut self, attempt: &Attempt) -> bool {
        if attempt.phase != Phase::Cleaning || attempt.guest_prepared {
            return true;
        }
        if self.startup_quiescent.as_deref() == Some(&attempt.nonce) {
            return true;
        }
        if let Some((nonce, owner)) = &mut self.running_vm {
            if nonce != &attempt.nonce {
                return false;
            }
            if let Err(error) = owner.terminate_and_reap().await {
                tracing::warn!(operation="reap_startup_owner",category=%error,attempt=%attempt.nonce,"startup ownership uncertain; cleanup blocked");
                return false;
            }
            self.startup_quiescent = Some(attempt.nonce.clone());
            self.running_vm = None;
            return true;
        }
        // A failed clone that never reached boot can still clean its partial
        // disk. A recovered unready boot has no safe PID identity to signal:
        // Tart's Stopped/Absent inventory cannot exclude a pre-PID-lock owner.
        let boot_may_have_started = attempt.vm_created
            || attempt.vm_booted
            || attempt.pending.as_ref().is_some_and(|pending| {
                matches!(
                    pending.operation,
                    Operation::BootVm | Operation::PrepareGuest
                )
            });
        if boot_may_have_started {
            if attempt.boot_lease_version == 1 {
                return match OwnedVmName::parse(&attempt.vm_name)
                    .and_then(|name| self.tart.operation_finished(&name))
                {
                    Ok(finished) => finished,
                    Err(error) => {
                        tracing::warn!(operation="reconcile_boot_lease",category=%error,attempt=%attempt.nonce,"boot operation uncertain; cleanup blocked");
                        false
                    }
                };
            }
            tracing::warn!(operation="reconcile_startup_owner",attempt=%attempt.nonce,"no retained owner or quiescence proof; preserve VM and reconcile manually");
            return false;
        }
        true
    }
    fn pending_outcome(
        &mut self,
        journal: &Journal,
        observed: &Observation,
        now: u64,
        clone_finished: bool,
    ) -> Option<EffectResult> {
        let attempt = journal.active.as_ref()?;
        let pending = attempt.pending.as_ref()?;
        if let Some(result) = &self.completed
            && result.ticket == pending.ticket
        {
            return Some(result.clone());
        }
        if self
            .task
            .as_ref()
            .is_some_and(|task| task.ticket == pending.ticket)
        {
            return Some(EffectResult {
                ticket: pending.ticket,
                outcome: Outcome::Unknown,
            });
        }
        let succeeded = || Outcome::Succeeded { runner_id: None };
        let outcome = match pending.operation {
            Operation::CloneVm => {
                if clone_finished {
                    // The inherited lease proves the operation has ended, not
                    // that resources are absent. Enter Cleaning; only its fresh
                    // inventory may establish absence and release the slot.
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
            Operation::PrepareGuest => {
                if observed.guest == GuestObservation::Ready {
                    succeeded()
                } else {
                    Outcome::Failed
                }
            }
            Operation::BootVm => {
                if observed.vm == VmObservation::Running {
                    succeeded()
                } else if self
                    .running_vm
                    .as_mut()
                    .is_some_and(|(_, handle)| handle.exited().unwrap_or(true))
                    || now >= attempt.boot_deadline
                {
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
            Operation::CreateJit => {
                let snapshot = self.snapshots.get(&attempt.repository.key());
                let matches = snapshot
                    .into_iter()
                    .flat_map(|s| &s.runners)
                    .filter(|runner| runner.name == attempt.runner_name)
                    .collect::<Vec<_>>();
                if matches.len() == 1 {
                    Outcome::RecoveredJit {
                        runner_id: matches[0].id,
                    }
                } else {
                    Outcome::Unknown
                }
            }
            // There is deliberately no secret replay, including when delivery outcome was lost.
            Operation::StartRunner => Outcome::Failed,
            Operation::StopVm => {
                if matches!(observed.vm, VmObservation::Stopped | VmObservation::Absent) {
                    succeeded()
                } else if now >= self.effect_not_before {
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
            Operation::DeleteVm => {
                if observed.vm == VmObservation::Absent {
                    succeeded()
                } else if now >= self.effect_not_before {
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
            Operation::DeleteRunner => {
                if observed.runner == RunnerObservation::Absent {
                    succeeded()
                } else if now >= self.effect_not_before {
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
        };
        if outcome == Outcome::Failed
            && self
                .diagnostic_for(attempt, pending.operation)
                .latest_failure
                .as_ref()
                .is_none_or(|failure| failure.operation != pending.operation)
        {
            let category = if matches!(
                pending.operation,
                Operation::BootVm | Operation::PrepareGuest
            ) && now >= attempt.boot_deadline
            {
                SafeError::Timeout
            } else {
                SafeError::EffectFailed
            };
            self.record_failure(attempt, pending.operation, category);
        }
        Some(EffectResult {
            ticket: pending.ticket,
            outcome,
        })
    }
}
impl LiveBackend {
    async fn observe_one(&mut self, config: &Config, journal: &Journal, now: u64) -> Observation {
        let base = match Tart::new(self.runtime.tart.clone()) {
            Ok(base) => base,
            Err(_) => return Observation::default(),
        };
        self.tart = match journal
            .active
            .as_ref()
            .map(|a| base.for_attempt(a))
            .transpose()
        {
            Ok(Some(tart)) => tart,
            Ok(None) => base,
            Err(_) => return Observation::default(),
        };
        if let Some(attempt) = &journal.active
            && self.diagnostic.as_ref().is_none_or(|summary| {
                summary.nonce != attempt.nonce
                    || summary.candidate != attempt.candidate
                    || summary.assigned != attempt.assigned
                    || summary.runner_id != attempt.runner_id
            })
        {
            let operation = attempt
                .pending
                .as_ref()
                .map_or(Operation::StartRunner, |intent| intent.operation);
            self.diagnostic_for(attempt, operation);
            // Preserve newly known assignment even if resources are already
            // absent and cleanup can release the slot without another effect.
            self.save_diagnostic();
        }
        let hold = self.gate.read_hold();
        let hold_token = hold
            .as_ref()
            .ok()
            .and_then(|request| request.as_ref())
            .map(|request| request.token.clone());
        if hold_token != self.last_hold {
            self.next_github_poll = 0;
            self.last_hold = hold_token;
        }
        if journal
            .active
            .as_ref()
            .is_none_or(|attempt| attempt.phase == crate::state::Phase::Cleaning)
        {
            self.jit = None;
        }
        if journal.active.is_none() {
            self.running_vm = None;
            self.startup_quiescent = None;
        }
        self.refresh(config, journal, now).await;
        let mut observed = Observation {
            free_bytes: rustix::fs::statvfs(&self.runtime.tart.tart_home)
                .ok()
                .map(|s| s.f_bavail.saturating_mul(s.f_frsize)),
            admission_nonce: Some(uuid::Uuid::new_v4().simple().to_string()),
            ..Observation::default()
        };
        // Tart 2.41.1 list/get query ASIF capacity through diskutil, which can
        // take the disk lock while VF is acquiring its exclusive startup lock.
        // Never inventory Starting attempts, including recovered ones. A freed
        // clone lease moves to Cleaning before any absence can be established.
        let clone_finished = self.pending_clone_finished(journal);
        let starting = journal
            .active
            .as_ref()
            .is_some_and(|attempt| attempt.phase == crate::state::Phase::Starting);
        let cleanup_quiescent = match &journal.active {
            Some(attempt) => self.startup_cleanup_quiescent(attempt).await,
            None => true,
        };
        let inventory = if starting || !cleanup_quiescent || !self.fleet_inventory_permitted {
            None
        } else if self.fleet_mode && self.inventory_loaded {
            self.inventory_cache.clone().map(Ok)
        } else {
            Some(self.tart.inventory().await.inspect_err(|error|tracing::warn!(operation="list_vms",category=%error,"VM inventory unavailable; admission blocked")))
        };
        if self.fleet_mode && !self.inventory_loaded {
            self.inventory_cache = inventory
                .as_ref()
                .and_then(|result| result.as_ref().ok())
                .cloned();
            self.inventory_loaded = true;
        }
        let vm_orphan = inventory.as_ref().is_some_and(|inventory| {
            inventory.as_ref().is_ok_and(|rows| {
                rows.iter().any(|vm| {
                    (vm.running
                        || crate::names::parse(&vm.name).is_some()
                        || crate::names::belongs_to_host(&vm.name, &self.runtime.policy.host_name))
                        && !self
                            .fleet_owned
                            .iter()
                            .chain(journal.attempts())
                            .any(|attempt| attempt.vm_name == vm.name)
                })
            })
        });
        let runner_orphan = self.snapshots.iter().any(|(repo, snapshot)| {
            snapshot.runners.iter().any(|runner| {
                crate::names::belongs_to_host(&runner.name, &self.runtime.policy.host_name)
                    && !self
                        .fleet_owned
                        .iter()
                        .chain(journal.attempts())
                        .any(|attempt| {
                            attempt.repository.key() == *repo && attempt.runner_name == runner.name
                        })
            })
        });
        let inventory_safe = inventory.as_ref().is_some_and(Result::is_ok)
            && self.snapshot_complete
            && !vm_orphan
            && !runner_orphan;
        self.last_inventory_safe = inventory_safe;
        let root_control =
            std::fs::symlink_metadata(&self.runtime.control_directory).is_ok_and(|metadata| {
                metadata.is_dir() && metadata.uid() == 0 && metadata.mode() & 0o7777 == 0o755
            });
        observed.admission_safe = inventory_safe
            && self
                .snapshots
                .values()
                .all(|snapshot| snapshot.admission_safe)
            && root_control
            && matches!(hold, Ok(None))
            && now >= self.github.retry_not_before();
        for repo in &config.repositories {
            if let Some(snapshot) = self.snapshots.get(&repo.key()) {
                observed
                    .candidates
                    .extend(snapshot.jobs.iter().filter_map(|job| candidate(repo, job)));
            }
        }
        let reservation_journal = Journal {
            active: self.fleet_owned.first().cloned(),
            additional: self.fleet_owned.iter().skip(1).cloned().collect(),
            ..Journal::default()
        };
        // Preserve raw queued identities for the scheduler's listener coverage.
        // Only fresh-admission selection excludes already-owned identities.
        // Revalidate bounded demand from each platform before fair admission and
        // macOS reservations; a single oldest job cannot represent both queues.
        if journal.active.is_none() && observed.admission_safe && config.admission_enabled {
            for repo in &config.repositories {
                for oldest in revalidation_candidates(
                    config,
                    &observed.candidates,
                    &repo.key(),
                    &reservation_journal,
                ) {
                    match self
                        .github
                        .get_job(&repository(repo), oldest.job.job_id)
                        .await
                    {
                        Ok(job)
                            if job.status == "queued"
                                && job.supported_profile()
                                && identity(repo, &job).as_ref() == Some(&oldest.job) =>
                        {
                            observed.revalidated.push(oldest.job)
                        }
                        Ok(_) => {
                            self.next_github_poll = 0;
                            observed.admission_safe = false;
                        }
                        Err(error) if error.category == ErrorCategory::NotFound => {
                            self.next_github_poll = 0;
                            observed.admission_safe = false;
                        }
                        Err(_) => observed.admission_safe = false,
                    }
                }
            }
        }
        if let Some(attempt) = &journal.active {
            observed.vm = match &inventory {
                Some(Ok(rows)) => match rows.iter().find(|vm| vm.name == attempt.vm_name) {
                    None => VmObservation::Absent,
                    Some(vm) if vm.state == VmState::Running => VmObservation::Running,
                    Some(_) => VmObservation::Stopped,
                },
                _ => VmObservation::Unknown,
            };
            if (starting || observed.vm == VmObservation::Unknown)
                && (attempt.vm_booted
                    || attempt.pending.as_ref().is_some_and(|pending| {
                        matches!(
                            pending.operation,
                            Operation::BootVm | Operation::PrepareGuest
                        )
                    }))
                && let Ok(name) = OwnedVmName::parse(&attempt.vm_name)
            {
                let remaining = if starting {
                    attempt.boot_deadline.saturating_sub(now)
                } else {
                    2
                };
                if remaining > 0
                    && matches!(
                        tokio::time::timeout(
                            Duration::from_secs(remaining.min(if self.fleet_mode {
                                2
                            } else {
                                30
                            })),
                            self.tart.guest_agent_ready(&name)
                        )
                        .await,
                        Ok(Ok(true))
                    )
                {
                    // Only a successful fixed guest-agent RPC establishes this
                    // positive state. Process presence and probe failures do not.
                    observed.vm = VmObservation::Running;
                }
            }
            if let Some(snapshot) = self.snapshots.get(&attempt.repository.key()) {
                observed.runner = runner_observation(attempt, snapshot);
            }
            if observed.vm == VmObservation::Running
                && (!starting
                    || attempt.guest_prepared
                    || attempt
                        .pending
                        .as_ref()
                        .is_some_and(|pending| pending.operation == Operation::PrepareGuest))
                && let Ok(name) = OwnedVmName::parse(&attempt.vm_name)
            {
                observed.guest = match self.tart.guest_status(&name).await {
                    Ok(status) => {
                        let summary = self.diagnostic_for(attempt, Operation::StartRunner);
                        let changed = summary.guest.as_ref() != Some(&status);
                        if changed
                            && (status.phase == GuestPhase::Failed
                                || (status.phase == GuestPhase::Exited
                                    && status.exit_code != Some(0)))
                        {
                            summary.failure(
                                Operation::StartRunner,
                                match status.reason {
                                    Some(crate::guest::TerminalReason::SpawnFailed) => {
                                        SafeError::ProcessIo
                                    }
                                    Some(crate::guest::TerminalReason::ObservationFailed) => {
                                        SafeError::OutcomeUnknown
                                    }
                                    _ => SafeError::ProcessRejected,
                                },
                                status.updated_at,
                            );
                        }
                        summary.guest = Some(status.clone());
                        if changed {
                            self.save_diagnostic();
                        }
                        match status.phase {
                            GuestPhase::Ready if attempt.runner_started => GuestObservation::Exited,
                            GuestPhase::Ready => GuestObservation::Ready,
                            GuestPhase::Accepted | GuestPhase::Executing => {
                                GuestObservation::Unknown
                            }
                            GuestPhase::Exited | GuestPhase::Failed => GuestObservation::Exited,
                        }
                    }
                    Err(error) => {
                        tracing::warn!(operation="guest_status",category=%error,attempt=%attempt.nonce,"guest observation unavailable");
                        GuestObservation::Unknown
                    }
                };
            }
            if attempt.phase == crate::state::Phase::Cleaning
                && observed.vm == VmObservation::Absent
                && observed.runner == RunnerObservation::Absent
            {
                match OwnedVmName::parse(&attempt.vm_name) {
                    Ok(name) => {
                        if let Err(error) = self.tart.cleanup_clone_operation(&name).await {
                            tracing::warn!(operation="cleanup_clone_lease",category=%error,attempt=%attempt.nonce,"clone operation cleanup unconfirmed; slot retained");
                            observed.vm = VmObservation::Unknown;
                        }
                    }
                    Err(_) => observed.vm = VmObservation::Unknown,
                }
            }
            observed.effect_result = self.pending_outcome(journal, &observed, now, clone_finished);
        }
        if !self.fleet_mode
            && let Ok(Some(request)) = hold
            && let Err(error) = self
                .gate
                .acknowledge(&request, journal.active.is_none() && inventory_safe)
        {
            tracing::warn!(category=%error,"activation hold acknowledgement failed");
        }
        observed
    }
    async fn execute_one(&mut self, effect: &Effect) -> Outcome {
        self.tart = match Tart::new(self.runtime.tart.clone())
            .and_then(|t| t.for_attempt(&effect.attempt))
        {
            Ok(tart) => tart,
            Err(_) => return Outcome::Failed,
        };
        let summary = self.diagnostic_for(&effect.attempt, effect.operation);
        summary.last_operation = effect.operation;
        summary.last_outcome = EffectState::Started;
        summary.updated_at = unix_now();
        // Capture the last validated guest status before stop/delete destroys it.
        // A diagnostic I/O failure must not prevent emergency-space cleanup.
        self.save_diagnostic();
        let outcome = self.execute_effect(effect).await;
        if matches!(outcome, Outcome::Failed | Outcome::Unknown)
            && self.task.is_none()
            && self.diagnostic.as_ref().is_none_or(|summary| {
                summary
                    .latest_failure
                    .as_ref()
                    .is_none_or(|failure| failure.operation != effect.operation)
            })
            && !(effect.operation == Operation::BootVm && self.running_vm.is_some())
        {
            self.record_failure(
                &effect.attempt,
                effect.operation,
                if outcome == Outcome::Failed {
                    SafeError::EffectFailed
                } else {
                    SafeError::OutcomeUnknown
                },
            );
        }
        if let Some(summary) = &mut self.diagnostic {
            summary.last_outcome = match outcome {
                _ if self.task.is_some() => EffectState::Started,
                Outcome::Succeeded { .. } | Outcome::RecoveredJit { .. } => EffectState::Succeeded,
                Outcome::Failed => EffectState::Failed,
                Outcome::Unknown => EffectState::Unknown,
            };
            summary.updated_at = unix_now();
        }
        self.save_diagnostic();
        outcome
    }
}
impl LiveBackend {
    async fn execute_effect(&mut self, effect: &Effect) -> Outcome {
        let attempt = &effect.attempt;
        tracing::info!(operation=?effect.operation,attempt=%attempt.nonce,repository=%attempt.repository.key(),ticket=effect.ticket,"executing durable intent");
        if unix_now() < self.effect_not_before {
            return Outcome::Unknown;
        }
        let Ok(name) = OwnedVmName::parse(&attempt.vm_name) else {
            return Outcome::Failed;
        };
        if matches!(effect.operation, Operation::StopVm | Operation::DeleteVm)
            && ((!self.fleet_inventory_permitted && self.fleet_mode)
                || !self.startup_cleanup_quiescent(attempt).await)
        {
            return Outcome::Unknown;
        }
        if self.fleet_mode {
            let tart = self.tart.clone();
            let attempt = attempt.clone();
            let operation = effect.operation;
            let jit = if operation == Operation::StartRunner {
                self.jit.take()
            } else {
                None
            };
            if operation != Operation::BootVm
                && operation != Operation::CreateJit
                && operation != Operation::DeleteRunner
            {
                if self.task.is_some() {
                    return Outcome::Unknown;
                }
                let handle = tokio::spawn(async move {
                    match operation {
                        Operation::CloneVm => {
                            tart.clone_vm(&attempt.image, &name, attempt.cpu, attempt.memory_mib)
                                .await
                        }
                        Operation::PrepareGuest => {
                            tart.prepare_guest(
                                &name,
                                Duration::from_secs(
                                    attempt.boot_deadline.saturating_sub(unix_now()),
                                ),
                            )
                            .await
                        }
                        Operation::StartRunner => match jit {
                            Some((nonce, jit)) if nonce == attempt.nonce => {
                                tart.bootstrap(&name, jit.as_bytes()).await
                            }
                            _ => Err(crate::tart::TartError::Configuration),
                        },
                        Operation::StopVm => tart.stop(&name).await,
                        Operation::DeleteVm => tart.delete(&name).await,
                        _ => unreachable!(),
                    }
                });
                self.task = Some(BackgroundEffect {
                    ticket: effect.ticket,
                    operation,
                    handle,
                });
                return Outcome::Unknown;
            }
        }
        let result = match effect.operation {
            Operation::CloneVm => {
                let result = self
                    .tart
                    .clone_vm(&attempt.image, &name, attempt.cpu, attempt.memory_mib)
                    .await;
                if result.is_ok() {
                    self.startup_quiescent = Some(attempt.nonce.clone());
                }
                result
            }
            Operation::BootVm => {
                if attempt.boot_lease_version != 1 {
                    return Outcome::Failed;
                }
                self.startup_quiescent = None;
                match self.tart.boot(&name) {
                    Ok(handle) => {
                        self.running_vm = Some((attempt.nonce.clone(), handle));
                        return Outcome::Unknown;
                    }
                    Err(error) => {
                        self.startup_quiescent = Some(attempt.nonce.clone());
                        Err(error)
                    }
                }
            }
            Operation::PrepareGuest => {
                let remaining = attempt.boot_deadline.saturating_sub(unix_now());
                if remaining == 0 {
                    return Outcome::Failed;
                }
                self.tart
                    .prepare_guest(&name, Duration::from_secs(remaining))
                    .await
            }
            Operation::CreateJit => {
                if !attempt.repository.trust_approved {
                    return Outcome::Failed;
                }
                let repo = repository(&attempt.repository);
                match self.github.get_job(&repo, attempt.candidate.job_id).await {
                    Ok(job)
                        if job.status == "queued"
                            && crate::config::Platform::resolve(&job.labels)
                                == Some(attempt.platform)
                            && job.supported_profile()
                            && identity(&attempt.repository, &job).as_ref()
                                == Some(&attempt.candidate) => {}
                    Ok(_) => return Outcome::Failed,
                    Err(error) if error.category == ErrorCategory::NotFound => {
                        return Outcome::Failed;
                    }
                    Err(_) => return Outcome::Failed,
                }
                if let Err(error) = self.github.settings_preflight(&repo).await {
                    tracing::warn!(operation=error.operation,category=?error.category,attempt=%attempt.nonce,"repository admission preflight failed before JIT; no registration created");
                    return Outcome::Failed;
                }
                match self
                    .github
                    .create_jit_for_profile(
                        &repo,
                        &attempt.runner_name,
                        attempt.repository.runner_group_id,
                        attempt.platform,
                    )
                    .await
                {
                    Ok(registration) => {
                        let id = registration.runner.id;
                        self.jit = Some((attempt.nonce.clone(), registration.config));
                        self.next_github_poll = 0;
                        return Outcome::Succeeded {
                            runner_id: Some(id),
                        };
                    }
                    Err(error) => {
                        self.record_failure(
                            attempt,
                            effect.operation,
                            github_diagnostic(error.category),
                        );
                        tracing::warn!(operation=error.operation,category=?error.category,attempt=%attempt.nonce,"GitHub effect failed");
                        self.next_github_poll = 0;
                        return if matches!(
                            error.category,
                            ErrorCategory::Uncertain | ErrorCategory::Transport
                        ) {
                            Outcome::Unknown
                        } else {
                            Outcome::Failed
                        };
                    }
                }
            }
            Operation::StartRunner => {
                let Some((nonce, jit)) = self.jit.take() else {
                    return Outcome::Failed;
                };
                if nonce != attempt.nonce {
                    return Outcome::Failed;
                }
                self.tart.bootstrap(&name, jit.as_bytes()).await
            }
            Operation::StopVm => self.tart.stop(&name).await,
            Operation::DeleteVm => self.tart.delete(&name).await,
            Operation::DeleteRunner => {
                let Some(id) = attempt.runner_id else {
                    return Outcome::Unknown;
                };
                // Re-establish exact ownership immediately before deletion; never trust an ID alone.
                match self
                    .github
                    .find_runner_by_name(&repository(&attempt.repository), &attempt.runner_name)
                    .await
                {
                    Ok(Some(runner)) if runner.id == id => {}
                    Ok(None) => return Outcome::Succeeded { runner_id: None },
                    _ => return Outcome::Unknown,
                }
                self.next_github_poll = 0;
                return match self
                    .github
                    .delete_runner(&repository(&attempt.repository), id)
                    .await
                {
                    Ok(()) => Outcome::Succeeded { runner_id: None },
                    Err(error) => {
                        tracing::warn!(operation=error.operation,category=?error.category,attempt=%attempt.nonce,"runner cleanup failed");
                        self.record_failure(
                            attempt,
                            effect.operation,
                            github_diagnostic(error.category),
                        );
                        self.effect_not_before =
                            unix_now() + self.runtime.policy.deadlines.retry_seconds;
                        Outcome::Unknown
                    }
                };
            }
        };
        match result {
            Ok(()) => Outcome::Succeeded { runner_id: None },
            Err(error) => {
                self.record_failure(attempt, effect.operation, tart_diagnostic(&error));
                tracing::warn!(operation=?effect.operation,category=%error,attempt=%attempt.nonce,"Tart effect failed");
                self.effect_not_before = unix_now() + self.runtime.policy.deadlines.retry_seconds;
                match effect.operation {
                    Operation::CloneVm if error.short_command_terminated() => Outcome::Failed,
                    Operation::CloneVm => Outcome::Unknown,
                    Operation::StartRunner => Outcome::Failed,
                    _ => Outcome::Unknown,
                }
            }
        }
    }
}

impl LiveBackend {
    fn select_attempt(&mut self, nonce: Option<&str>) {
        if self.selected_attempt.as_deref() == nonce {
            return;
        }
        let previous = AttemptResources {
            jit: self.jit.take(),
            running_vm: self.running_vm.take(),
            startup_quiescent: self.startup_quiescent.take(),
            effect_not_before: self.effect_not_before,
            diagnostic: self.diagnostic.take(),
            task: self.task.take(),
            completed: self.completed.take(),
        };
        if let Some(old) = self.selected_attempt.take() {
            self.resources.insert(old, previous);
        }
        let next = nonce
            .and_then(|key| self.resources.remove(key))
            .unwrap_or_default();
        self.jit = next.jit;
        self.running_vm = next.running_vm;
        self.startup_quiescent = next.startup_quiescent;
        self.effect_not_before = next.effect_not_before;
        self.diagnostic = next.diagnostic;
        self.task = next.task;
        self.completed = next.completed;
        self.selected_attempt = nonce.map(str::to_owned);
    }
    async fn poll_effect(&mut self, attempt: &Attempt) {
        if self.completed.as_ref().is_some_and(|result| {
            attempt
                .pending
                .as_ref()
                .is_none_or(|p| p.ticket != result.ticket)
        }) {
            self.completed = None;
        }
        if !self
            .task
            .as_ref()
            .is_some_and(|task| task.handle.is_finished())
        {
            return;
        }
        let task = self.task.take().expect("finished task exists");
        let outcome = match task.handle.await {
            Ok(Ok(())) => {
                if task.operation == Operation::CloneVm {
                    self.startup_quiescent = Some(attempt.nonce.clone());
                }
                Outcome::Succeeded { runner_id: None }
            }
            Ok(Err(error)) => {
                self.record_failure(attempt, task.operation, tart_diagnostic(&error));
                self.effect_not_before = unix_now() + self.runtime.policy.deadlines.retry_seconds;
                if task.operation == Operation::StartRunner
                    || (task.operation == Operation::CloneVm && error.short_command_terminated())
                {
                    Outcome::Failed
                } else {
                    Outcome::Unknown
                }
            }
            Err(_) => Outcome::Unknown,
        };
        self.diagnostic_for(attempt, task.operation).last_outcome = match outcome {
            Outcome::Succeeded { .. } => EffectState::Succeeded,
            Outcome::Failed => EffectState::Failed,
            _ => EffectState::Unknown,
        };
        self.save_diagnostic();
        // Unknown outcomes must fall back to authoritative reconciliation on the next poll.
        self.completed = (outcome != Outcome::Unknown).then_some(EffectResult {
            ticket: task.ticket,
            outcome,
        });
    }
}
impl EngineBackend for LiveBackend {
    async fn observe(&mut self, config: &Config, journal: &Journal, now: u64) -> Observation {
        if !self.fleet_mode {
            return self.observe_one(config, journal, now).await;
        }
        let pressure_safe = self.host_pressure.admission_safe(now).await;
        self.inventory_loaded = false;
        self.inventory_cache = None;
        self.fleet_owned = journal.attempts().cloned().collect();
        self.resources.retain(|nonce, _| {
            self.fleet_owned
                .iter()
                .any(|attempt| &attempt.nonce == nonce)
        });
        let mut permitted = true;
        for attempt in self.fleet_owned.clone() {
            self.select_attempt(Some(&attempt.nonce));
            self.poll_effect(&attempt).await;
            if attempt.phase == Phase::Starting || !self.startup_cleanup_quiescent(&attempt).await {
                permitted = false;
            }
        }
        self.select_attempt(None);
        self.fleet_inventory_permitted = permitted;
        let busy_inventory = self.resources.values().any(|resources| {
            resources.task.as_ref().is_some_and(|task| {
                matches!(task.operation, Operation::StopVm | Operation::DeleteVm)
            })
        });
        let mut admission = config.clone();
        admission.admission_enabled &=
            journal.attempts().count() < config.max_concurrent_jobs && !busy_inventory;
        let mut observed = self
            .observe_one(&admission, &journal.project(None), now)
            .await;
        let inventory_safe = self.last_inventory_safe;
        observed.admission_safe &= admission.admission_enabled && pressure_safe;
        if !pressure_safe {
            tracing::warn!(
                operation = "host_resource_gate",
                "memory pressure or unavailable host telemetry blocks admission"
            );
        }
        for attempt in self.fleet_owned.clone() {
            self.select_attempt(Some(&attempt.nonce));
            let mut policy = config.clone();
            policy.admission_enabled = false;
            let observation = self
                .observe_one(&policy, &journal.project(Some(attempt.clone())), now)
                .await;
            observed
                .attempts
                .insert(attempt.nonce, Box::new(observation));
        }
        self.select_attempt(None);
        let owned = self
            .fleet_owned
            .iter()
            .map(|attempt| attempt.nonce.as_str())
            .collect::<Vec<_>>();
        if diagnostics::prune(&self.runtime.state_directory, &owned).is_err() {
            tracing::warn!(
                operation = "prune_diagnostics",
                "diagnostic retention unavailable"
            );
        }
        acknowledge_fleet_hold(
            &self.gate,
            journal,
            &mut observed,
            inventory_safe,
            busy_inventory,
        );
        observed
    }
    async fn execute(&mut self, effect: &Effect) -> Outcome {
        if self.fleet_mode {
            self.select_attempt(Some(&effect.attempt.nonce));
        }
        self.execute_one(effect).await
    }
}

pub async fn run(config_path: &Path) -> Result<(), ServiceError> {
    let runtime = RuntimeConfig::load(config_path)?;
    let store = Store::open(&runtime.state_directory).map_err(|_| ServiceError::State)?;
    let mut backend = LiveBackend::new(runtime.clone())?;
    backend.preflight().await?;
    backend.fleet_mode = true;
    let mut engine = Engine::open(store, backend).map_err(|_| ServiceError::State)?;
    let mut policy = runtime.policy.clone();
    let mut terminate = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        .map_err(|_| ServiceError::Signal)?;
    loop {
        match RuntimeConfig::load(config_path) {
            Ok(current) if runtime.same_runtime(&current) => policy = current.policy,
            _ => {
                policy.admission_enabled = false;
                tracing::warn!(
                    "configuration changed or invalid; admission suspended until reviewed restart"
                );
            }
        }
        let report = engine
            .step(&policy, unix_now())
            .await
            .map_err(|_| ServiceError::State)?;
        tracing::info!(
            reason = report.reason,
            active = engine.journal().attempts().count(),
            sequence = engine.journal().sequence,
            runner = engine
                .journal()
                .active
                .as_ref()
                .map(|attempt| attempt.runner_name.as_str()),
            vm = engine
                .journal()
                .active
                .as_ref()
                .map(|attempt| attempt.vm_name.as_str()),
            job_url = engine
                .journal()
                .active
                .as_ref()
                .and_then(|attempt| attempt.assigned.as_ref().map(JobIdentity::url)),
            "controller decision"
        );
        let pause = if report.changed || report.executed {
            Duration::from_millis(250)
        } else if !engine.journal().is_idle() {
            Duration::from_secs(2)
        } else {
            Duration::from_secs(30)
        };
        tokio::select! {
            _=tokio::time::sleep(pause)=>{},
            _=terminate.recv()=>{tracing::info!(active=!engine.journal().is_idle(),"controller terminating; durable ownership retained for reconciliation");return Ok(());},
            _=tokio::signal::ctrl_c()=>{tracing::info!(active=!engine.journal().is_idle(),"controller stopping; durable ownership retained for reconciliation");return Ok(());}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::Deadlines,
        state::{Attempt, Intent, Phase},
    };
    // Adapter fixtures exercise one attempt directly; production always enables fleet composition.
    fn single_backend(config: RuntimeConfig) -> Result<LiveBackend, ServiceError> {
        let mut backend = LiveBackend::new(config)?;
        backend.fleet_mode = false;
        Ok(backend)
    }
    fn runtime() -> RuntimeConfig {
        RuntimeConfig {
            policy: Config {
                host_name: "homelab-macbook".into(),
                admission_enabled: true,
                max_concurrent_jobs: 1,
                max_macos_guests: 2,
                cpu_budget: 12,
                memory_budget_mib: 24576,
                linux: None,
                repositories: vec![RepositoryConfig {
                    owner: "test".into(),
                    name: "repo".into(),
                    repository_id: 1,
                    installation_id: 2,
                    runner_group_id: 3,
                    trust_approved: true,
                }],
                image: format!("ghcr.io/test/base@sha256:{}", "a".repeat(64)),
                cpu: 4,
                memory_mib: 8192,
                admission_free_bytes: 100,
                emergency_free_bytes: 10,
                deadlines: Deadlines::default(),
            },
            app_id: "test-app".into(),
            app_key_file: "/never-read-fixture-key".into(),
            state_directory: "/never-used-fixture-state".into(),
            control_directory: "/never-used-fixture-control".into(),
            tart: TartConfig {
                binary: "/never-run-tart".into(),
                home: "/never-used-home".into(),
                tart_home: "/never-used-tart-home".into(),
                helper_directory: "/never-used-helper-dir".into(),
                guest_helper: "/never-used-guest-helper".into(),
                runner_archive: "/never-used-runner-archive.tar.gz".into(),
                runner_version: "2.338.2".into(),
            },
            keychain: None,
        }
    }
    #[test]
    fn revalidation_keeps_waiting_macs_visible_to_admission() {
        use crate::config::{LinuxProfile, Platform};
        let mut config = runtime().policy;
        config.max_concurrent_jobs = 4;
        config.linux = Some(LinuxProfile {
            image: format!("ghcr.io/test/linux@sha256:{}", "b".repeat(64)),
            cpu: 2,
            memory_mib: 4096,
            disk_growth_bytes: 30,
            routing_audit_approved: true,
            runner_archive: "/fixture-linux-runner.tar.gz".into(),
            runner_version: "2.338.2".into(),
        });
        let job = |id, platform: Platform| Candidate {
            job: JobIdentity {
                repository: "test/repo".into(),
                run_id: 1,
                run_attempt: 1,
                job_id: id,
            },
            created_at: id,
            labels: platform.labels().iter().map(|s| (*s).to_owned()).collect(),
            group: None,
        };
        let mut candidates = vec![
            job(1, Platform::LinuxArm64),
            job(2, Platform::LinuxArm64),
            job(3, Platform::MacosArm64),
            job(3, Platform::MacosArm64),
            job(4, Platform::MacosArm64),
            job(5, Platform::MacosArm64),
            job(6, Platform::LinuxOperationsArm64),
        ];
        let fresh = revalidation_candidates(&config, &candidates, "test/repo", &Journal::default());
        assert_eq!(
            fresh.iter().map(|c| c.job.job_id).collect::<Vec<_>>(),
            vec![3, 4, 1, 6]
        );
        let mut observed = Observation {
            admission_safe: true,
            admission_nonce: Some("a".repeat(32)),
            free_bytes: Some(10000),
            revalidated: fresh.into_iter().map(|c| c.job).collect(),
            candidates: candidates.clone(),
            ..Observation::default()
        };
        let decision = crate::scheduler::decide(&config, &Journal::default(), &observed, 10);
        assert_eq!(decision.next.active.unwrap().platform, Platform::MacosArm64);

        // One unassigned listener covers its own queued candidate, not the
        // second queued macOS job as well. Preserve raw identities for coverage.
        let mut listener = peer_attempt();
        listener.phase = Phase::Listening;
        listener.assigned = None;
        listener.unassigned_deadline = Some(300);
        listener.candidate = candidates[2].job.clone();
        let journal = Journal {
            active: Some(listener.clone()),
            ..Journal::default()
        };
        let listener_candidates = candidates[..5].to_vec();
        observed.candidates = listener_candidates.clone();
        observed.revalidated =
            revalidation_candidates(&config, &listener_candidates, "test/repo", &journal)
                .into_iter()
                .map(|c| c.job)
                .collect();
        observed.attempts.insert(
            listener.nonce.clone(),
            Box::new(Observation {
                vm: VmObservation::Running,
                runner: RunnerObservation::Idle,
                guest: GuestObservation::Listening,
                ..Observation::default()
            }),
        );
        let decision = crate::scheduler::decide(&config, &journal, &observed, 10);
        assert_eq!(decision.next.additional.len(), 1, "{}", decision.reason);
        assert_eq!(decision.next.additional[0].platform, Platform::MacosArm64);
        assert_eq!(decision.next.additional[0].candidate.job_id, 4);
        observed.attempts.clear();

        // A Linux queue must not hide macOS work when Linux admission is off.
        config.linux = None;
        observed.revalidated =
            revalidation_candidates(&config, &candidates, "test/repo", &Journal::default())
                .into_iter()
                .map(|c| c.job)
                .collect();
        assert_eq!(observed.revalidated.len(), 2);
        let decision = crate::scheduler::decide(&config, &Journal::default(), &observed, 10);
        assert_eq!(decision.next.active.unwrap().candidate.job_id, 3);

        candidates.retain(|c| Platform::resolve(&c.labels) == Some(Platform::LinuxArm64));
        assert!(
            revalidation_candidates(&config, &candidates, "test/repo", &Journal::default())
                .is_empty()
        );
    }
    #[test]
    fn hold_arriving_after_discovery_blocks_admission_before_idle_ack() {
        let directory = tempfile::tempdir().unwrap();
        let gate = Gate::new(
            directory.path().join("control"),
            directory.path().join("status"),
        );
        let config = runtime().policy;
        let job = pending(Operation::CloneVm).active.unwrap().candidate;
        let mut observed = Observation {
            admission_safe: true,
            admission_nonce: Some("a".repeat(32)),
            free_bytes: Some(10000),
            candidates: vec![Candidate {
                job: job.clone(),
                created_at: 1,
                labels: crate::config::Platform::MacosArm64
                    .labels()
                    .iter()
                    .map(|s| (*s).to_owned())
                    .collect(),
                group: None,
            }],
            revalidated: vec![job],
            ..Observation::default()
        };
        assert!(
            crate::scheduler::decide(&config, &Journal::default(), &observed, 10)
                .effect
                .is_some()
        );
        // Discovery observed no hold. Root publishes one before the final fleet
        // acknowledgement; a positive idle ack must prevent this admission.
        let request = gate.request_hold().unwrap();
        acknowledge_fleet_hold(&gate, &Journal::default(), &mut observed, true, false);
        assert!(gate.read_ack(&request).unwrap().unwrap().idle);
        assert!(
            crate::scheduler::decide(&config, &Journal::default(), &observed, 10)
                .effect
                .is_none()
        );

        // A late malformed hold must also fail closed instead of retaining the
        // earlier healthy discovery result.
        gate.release(&request).unwrap();
        std::fs::write(directory.path().join("control/hold.json"), b"not JSON").unwrap();
        observed.admission_safe = true;
        acknowledge_fleet_hold(&gate, &Journal::default(), &mut observed, true, false);
        assert!(!observed.admission_safe);
    }

    fn pending(operation: Operation) -> Journal {
        let config = runtime();
        let nonce = "a".repeat(32);
        Journal {
            sequence: 1,
            additional: Vec::new(),
            last_attempt: None,
            active: Some(Attempt {
                nonce: nonce.clone(),
                vm_name: format!("homelab-job-{nonce}"),
                runner_name: format!("homelab-job-{nonce}"),
                repository: config.policy.repositories[0].clone(),
                platform: crate::config::Platform::MacosArm64,
                disk_growth_bytes: 0,
                linux_profile: None,
                image: config.policy.image,
                cpu: 4,
                memory_mib: 8192,
                candidate: JobIdentity {
                    repository: "test/repo".into(),
                    run_id: 1,
                    run_attempt: 1,
                    job_id: 2,
                },
                assigned: None,
                phase: Phase::Starting,
                boot_deadline: 600,
                unassigned_deadline: None,
                running_deadline: None,
                running_seconds: 7200,
                unassigned_seconds: 300,
                vm_created: true,
                vm_booted: true,
                boot_lease_version: 0,
                guest_prepared: false,
                jit_created: false,
                runner_started: false,
                runner_id: None,
                pending: Some(Intent {
                    ticket: 1,
                    operation,
                }),
            }),
            ..Journal::default()
        }
    }

    fn peer_attempt() -> Attempt {
        let mut peer = pending(Operation::CloneVm).active.unwrap();
        peer.nonce = "b".repeat(32);
        peer.vm_name = format!("homelab-macbook-job-{}", peer.nonce);
        peer.runner_name = peer.vm_name.clone();
        peer.phase = Phase::Running;
        peer.pending = None;
        peer.guest_prepared = true;
        peer.jit_created = true;
        peer.runner_started = true;
        peer.runner_id = Some(9);
        peer.candidate.job_id = 3;
        peer.assigned = Some(peer.candidate.clone());
        peer.running_deadline = Some(10000);
        peer
    }
    fn fleet_fixture(directory: &Path) -> (LiveBackend, RuntimeConfig, Journal) {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        let binary = directory.join("fixture");
        std::fs::write(&binary, b"#!/bin/sh\ncase \"$1\" in\nlist) echo inventory >> \"$HOME/events\"; printf '[]\\n';;\nexec) printf '501\\n';;\nesac\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut config = runtime();
        config.policy.max_concurrent_jobs = 2;
        config.state_directory = directory.to_owned();
        config.control_directory = directory.join("control");
        config.tart.home = directory.to_owned();
        config.tart.tart_home = directory.to_owned();
        config.tart.binary = binary;
        let mut backend = single_backend(config.clone()).unwrap();
        backend.fleet_mode = true;
        backend.next_github_poll = u64::MAX;
        backend.last_repositories = config.policy.repositories.clone();
        backend.snapshot_complete = true;
        backend.snapshots.insert(
            config.policy.repositories[0].key(),
            RepositorySnapshot {
                jobs: vec![],
                runners: vec![],
                admission_safe: true,
            },
        );
        let mut journal = pending(Operation::CloneVm);
        journal.active.as_mut().unwrap().vm_created = false;
        journal.active.as_mut().unwrap().vm_booted = false;
        journal.additional.push(peer_attempt());
        (backend, config, journal)
    }
    #[tokio::test]
    async fn fleet_monitors_peer_while_clone_is_pending_without_inventorying_startup_disks() {
        let directory = tempfile::tempdir().unwrap();
        let (mut backend, config, journal) = fleet_fixture(directory.path());
        let nonce = journal.active.as_ref().unwrap().nonce.clone();
        backend.select_attempt(Some(&nonce));
        let release = std::sync::Arc::new(tokio::sync::Notify::new());
        let wait = release.clone();
        backend.task = Some(BackgroundEffect {
            ticket: 1,
            operation: Operation::CloneVm,
            handle: tokio::spawn(async move {
                wait.notified().await;
                Ok(())
            }),
        });
        backend.select_attempt(None);
        let observed = tokio::time::timeout(
            Duration::from_secs(2),
            backend.observe(&config.policy, &journal, 10),
        )
        .await
        .unwrap();
        assert!(!observed.admission_safe);
        assert_eq!(
            observed.attempts[&nonce]
                .effect_result
                .as_ref()
                .unwrap()
                .outcome,
            Outcome::Unknown
        );
        assert_eq!(
            observed.attempts[&journal.additional[0].nonce].vm,
            VmObservation::Running
        );
        assert!(
            !directory.path().join("events").exists(),
            "global inventory must not race startup"
        );
        release.notify_one();
        backend.select_attempt(Some(&nonce));
        tokio::time::timeout(Duration::from_secs(2), async {
            while !backend.task.as_ref().unwrap().handle.is_finished() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        backend.poll_effect(journal.active.as_ref().unwrap()).await;
        assert_eq!(
            backend.completed.as_ref().unwrap().outcome,
            Outcome::Succeeded { runner_id: None }
        );
        backend.select_attempt(Some(&journal.additional[0].nonce));
        assert!(
            backend.completed.is_none(),
            "completion belongs only to its attempt"
        );
        backend.select_attempt(Some(&nonce));
        assert_eq!(backend.completed.as_ref().unwrap().ticket, 1);
    }
    #[tokio::test]
    async fn fleet_cleanup_and_orphan_checks_recognize_every_owned_vm() {
        let directory = tempfile::tempdir().unwrap();
        let (mut backend, config, mut journal) = fleet_fixture(directory.path());
        journal.active = Some(peer_attempt());
        journal.additional.clear();
        let mut peer = peer_attempt();
        peer.nonce = "c".repeat(32);
        peer.vm_name = format!("homelab-macbook-job-{}", peer.nonce);
        peer.runner_name = peer.vm_name.clone();
        peer.runner_id = Some(10);
        peer.candidate.job_id = 4;
        peer.assigned = Some(peer.candidate.clone());
        journal.additional.push(peer);
        let rows = journal.attempts().map(|a| serde_json::json!({"Source":"local","Name":a.vm_name,"State":"running","Running":true})).collect::<Vec<_>>();
        // All inventory callers use one authoritative host snapshot per controller observation.
        let script = format!(
            "#!/bin/sh\ncase \"$1\" in\nlist) echo inventory >> \"$HOME/events\"; printf '%s' '{}';;\nexec) printf '501\\n';;\nesac\n",
            serde_json::to_string(&rows).unwrap()
        );
        std::fs::write(&config.tart.binary, script).unwrap();
        let observed = backend.observe(&config.policy, &journal, 10).await;
        assert!(
            backend.last_inventory_safe,
            "owned peers must not be treated as orphans"
        );
        assert_eq!(observed.attempts.len(), 2);
        assert_eq!(
            std::fs::read_to_string(directory.path().join("events"))
                .unwrap()
                .lines()
                .count(),
            1
        );
        assert_eq!(backend.resources.len(), 2);
    }
    #[test]
    fn ambiguous_jit_is_reconciled_by_exact_unique_name_and_never_reminted() {
        let mut backend = single_backend(runtime()).unwrap();
        let journal = pending(Operation::CreateJit);
        let observed = Observation {
            vm: VmObservation::Running,
            ..Observation::default()
        };
        assert_eq!(
            backend
                .pending_outcome(&journal, &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Unknown
        );
        let runner = Runner {
            id: 9,
            name: journal.active.as_ref().unwrap().runner_name.clone(),
            status: "offline".into(),
            busy: false,
        };
        backend.snapshots.insert(
            "test/repo".into(),
            RepositorySnapshot {
                jobs: vec![],
                runners: vec![runner.clone()],
                admission_safe: false,
            },
        );
        assert_eq!(
            backend
                .pending_outcome(&journal, &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::RecoveredJit { runner_id: 9 }
        );
        backend
            .snapshots
            .get_mut("test/repo")
            .unwrap()
            .runners
            .push(runner);
        assert_eq!(
            backend
                .pending_outcome(&journal, &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Unknown
        );
        assert!(backend.jit.is_none());
    }
    #[test]
    fn boot_requires_positive_running_evidence_and_lost_start_input_is_never_replayed() {
        let mut backend = single_backend(runtime()).unwrap();
        let mut observed = Observation {
            vm: VmObservation::Stopped,
            ..Observation::default()
        };
        assert_eq!(
            backend
                .pending_outcome(&pending(Operation::BootVm), &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Unknown
        );
        observed.vm = VmObservation::Running;
        assert_eq!(
            backend
                .pending_outcome(&pending(Operation::BootVm), &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Succeeded { runner_id: None }
        );
        assert_eq!(
            backend
                .pending_outcome(&pending(Operation::StartRunner), &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Failed
        );
        observed.vm = VmObservation::Absent;
        assert_eq!(
            backend
                .pending_outcome(&pending(Operation::CloneVm), &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Unknown
        );
    }
    #[test]
    fn configuration_reload_changes_policy_without_replacing_active_runtime_paths() {
        let config = runtime();
        let mut changed = config.clone();
        changed.policy.admission_enabled = false;
        changed.policy.repositories.clear();
        assert!(config.same_runtime(&changed));
        changed.policy.host_name = "renamed-mac".into();
        assert!(!config.same_runtime(&changed));
        changed.policy.host_name = config.policy.host_name.clone();
        changed.tart.binary = "/different-generation/tart".into();
        assert!(!config.same_runtime(&changed));
        let mut invalid = config;
        invalid.app_key_file = "relative.pem".into();
        assert!(invalid.validate().is_err());
    }
    #[test]
    fn runtime_rejects_excess_macos_concurrency_before_opening_state_or_credentials() {
        let file = tempfile::NamedTempFile::new().unwrap();
        for limit in [0, 5, 128, usize::MAX] {
            let mut config = runtime();
            config.policy.max_concurrent_jobs = limit;
            std::fs::write(file.path(), serde_json::to_vec(&config).unwrap()).unwrap();
            let error = RuntimeConfig::load(file.path()).unwrap_err();
            assert!(matches!(error, ServiceError::Concurrency));
            assert!(error.to_string().contains("between 1 and 4"));
        }
        for limit in [1, 2, 3, 4] {
            let mut config = runtime();
            config.policy.max_concurrent_jobs = limit;
            assert!(config.validate().is_ok());
        }
    }
    #[test]
    fn runner_archive_and_version_are_required_validated_runtime_identity() {
        let config = runtime();
        assert!(config.validate().is_ok());
        for field in ["runner_archive", "runner_version"] {
            let mut json = serde_json::to_value(&config).unwrap();
            json["tart"].as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<RuntimeConfig>(json).is_err());
        }
        let mut changed = config.clone();
        changed.tart.runner_archive = "/different-generation/runner.tar.gz".into();
        assert!(!config.same_runtime(&changed));
        changed = config.clone();
        changed.tart.runner_version = "2.338.3".into();
        assert!(!config.same_runtime(&changed));
        changed.tart.runner_archive = "relative.tar.gz".into();
        assert!(changed.validate().is_err());
        changed = config;
        changed.tart.runner_version = "2.338.2;invalid".into();
        assert!(changed.validate().is_err());
    }
    #[test]
    fn invalid_configuration_reports_coordinates_without_echoing_field_names_or_values() {
        let file = tempfile::NamedTempFile::new().unwrap();
        std::fs::write(
            file.path(),
            br#"{"PRIVATE_SENTINEL_FIELD":"PRIVATE_SENTINEL_VALUE"}"#,
        )
        .unwrap();
        let error = RuntimeConfig::load(file.path()).unwrap_err();
        assert!(matches!(
            error,
            ServiceError::ConfigurationSyntax {
                category: "schema",
                ..
            }
        ));
        let message = error.to_string();
        assert!(message.contains("line 1"));
        assert!(!message.contains("PRIVATE_SENTINEL"));
    }
    #[test]
    fn invalid_settings_block_admission_without_hiding_runner_cleanup_inventory() {
        let mut journal = pending(Operation::DeleteRunner);
        let attempt = journal.active.as_mut().unwrap();
        attempt.phase = Phase::Cleaning;
        attempt.runner_id = Some(9);
        let snapshot = RepositorySnapshot {
            jobs: vec![],
            runners: vec![Runner {
                id: 9,
                name: attempt.runner_name.clone(),
                status: "offline".into(),
                busy: false,
            }],
            admission_safe: false,
        };
        assert!(!snapshot.admission_safe);
        assert_eq!(
            runner_observation(attempt, &snapshot),
            RunnerObservation::Idle
        );
        let observed = Observation {
            vm: VmObservation::Absent,
            runner: runner_observation(attempt, &snapshot),
            ..Observation::default()
        };
        // Once prior intent is resolved, the production scheduler still emits exact owned deletion.
        journal.active.as_mut().unwrap().pending = None;
        let decision = crate::scheduler::decide(&runtime().policy, &journal, &observed, 10);
        assert_eq!(decision.effect.unwrap().operation, Operation::DeleteRunner);
    }
    #[tokio::test]
    async fn surviving_clone_lease_blocks_recovery_until_release_then_cleaning_observes_inventory()
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let binary = directory.path().join("inventory-fixture");
        std::fs::write(&binary, b"#!/bin/sh\nprintf '[]\\n'\n").unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o700)).unwrap();
        let mut config = runtime();
        config.tart.tart_home = directory.path().to_owned();
        config.tart.binary = binary;
        let mut backend = single_backend(config.clone()).unwrap();
        let mut journal = pending(Operation::CloneVm);
        journal.active.as_mut().unwrap().vm_created = false;
        journal.active.as_mut().unwrap().vm_booted = false;
        let attempt = journal.active.as_ref().unwrap();
        let lease = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(
                directory
                    .path()
                    .join(format!(".{}.clone.lock", attempt.vm_name)),
            )
            .unwrap();
        lease.lock().unwrap();
        backend.last_repositories = vec![attempt.repository.clone()];
        backend.next_github_poll = u64::MAX;
        backend.snapshot_complete = true;
        backend.snapshots.insert(
            attempt.repository.key(),
            RepositorySnapshot {
                jobs: vec![],
                runners: vec![],
                admission_safe: false,
            },
        );
        let observation = backend.observe(&config.policy, &journal, 10).await;
        assert_eq!(observation.vm, VmObservation::Unknown);
        assert_eq!(observation.effect_result.unwrap().outcome, Outcome::Unknown);
        // This fixture has no intended native child inheriting the held fd.
        // Release its lock explicitly before transient parallel forks can
        // prolong an accidental duplicate's lifetime past the parent drop.
        lease.unlock().unwrap();
        drop(lease);
        let observation = backend.observe(&config.policy, &journal, 11).await;
        assert_eq!(observation.vm, VmObservation::Unknown);
        assert_eq!(
            observation.effect_result.as_ref().unwrap().outcome,
            Outcome::Failed
        );
        let cleaning = crate::scheduler::decide(&config.policy, &journal, &observation, 11).next;
        assert_eq!(cleaning.active.as_ref().unwrap().phase, Phase::Cleaning);
        let observation = backend.observe(&config.policy, &cleaning, 12).await;
        assert_eq!(observation.vm, VmObservation::Absent);
    }
    #[test]
    fn recovered_guest_preparation_requires_ready_and_never_replays_installation() {
        let mut backend = single_backend(runtime()).unwrap();
        let journal = pending(Operation::PrepareGuest);
        let mut observed = Observation {
            guest: GuestObservation::Ready,
            ..Observation::default()
        };
        assert_eq!(
            backend
                .pending_outcome(&journal, &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Succeeded { runner_id: None }
        );
        observed.guest = GuestObservation::Unknown;
        assert_eq!(
            backend
                .pending_outcome(&journal, &observed, 10, false)
                .unwrap()
                .outcome,
            Outcome::Failed
        );
    }

    fn startup_fixture() -> (tempfile::TempDir, RuntimeConfig, LiveBackend) {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let binary = directory.path().join("asif-startup-fixture");
        let output = std::process::Command::new("rustc")
            .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/asif-startup.rs"))
            .arg("-o")
            .arg(&binary)
            .output()
            .unwrap();
        assert!(output.status.success(), "ASIF fixture compilation failed");
        let mut config = runtime();
        config.tart.binary = binary;
        config.tart.tart_home = directory.path().into();
        let mut backend = single_backend(config.clone()).unwrap();
        backend.last_repositories = config.policy.repositories.clone();
        backend.next_github_poll = u64::MAX;
        backend.snapshot_complete = true;
        backend.snapshots.insert(
            "test/repo".into(),
            RepositorySnapshot {
                jobs: vec![],
                runners: vec![],
                admission_safe: false,
            },
        );
        std::fs::write(directory.path().join("booting"), b"").unwrap();
        (directory, config, backend)
    }
    fn startup_events(directory: &Path) -> String {
        std::fs::read_to_string(directory.join("events")).unwrap_or_default()
    }
    #[tokio::test]
    async fn typed_guest_failure_is_saved_before_delete_and_survives_backend_restart() {
        let (directory, _, mut backend) = startup_fixture();
        backend.runtime.state_directory = directory.path().into();
        std::fs::remove_file(directory.path().join("booting")).unwrap();
        std::fs::write(directory.path().join("require-diagnostic"), b"").unwrap();
        let mut attempt = pending(Operation::DeleteVm).active.unwrap();
        attempt.phase = Phase::Cleaning;
        attempt.guest_prepared = true;
        std::fs::write(directory.path().join("reported-stopped"), &attempt.vm_name).unwrap();
        let summary = backend.diagnostic_for(&attempt, Operation::StartRunner);
        summary.guest = Some(crate::guest::GuestStatus {
            schema: 1,
            attempt_id: Some(attempt.nonce.clone()),
            phase: GuestPhase::Exited,
            updated_at: 9,
            exit_code: Some(5),
            reason: Some(crate::guest::TerminalReason::ProcessExited),
        });
        summary.failure(Operation::StartRunner, SafeError::ProcessRejected, 9);
        // Actual server assignment arrives after the initial candidate summary.
        attempt.assigned = Some(JobIdentity {
            repository: attempt.candidate.repository.clone(),
            run_id: 7,
            run_attempt: 3,
            job_id: 42,
        });
        attempt.runner_id = Some(9);
        assert_eq!(
            backend
                .execute(&Effect {
                    ticket: 1,
                    operation: Operation::DeleteVm,
                    attempt: attempt.clone()
                })
                .await,
            Outcome::Succeeded { runner_id: None }
        );
        assert!(startup_events(directory.path()).contains("diagnostic_exists_before_delete"));
        assert!(!directory.path().join("reported-stopped").exists());
        let saved = diagnostics::load(directory.path(), &attempt.nonce)
            .unwrap()
            .unwrap();
        assert_eq!(saved.candidate, attempt.candidate);
        assert_eq!(saved.assigned, attempt.assigned);
        assert_ne!(
            saved.candidate.job_id,
            saved.assigned.as_ref().unwrap().job_id
        );
        assert_eq!(saved.runner_id, Some(9));
        assert_eq!(
            saved.runner_name.as_deref(),
            Some(attempt.runner_name.as_str())
        );
        assert_eq!(saved.vm_name.as_deref(), Some(attempt.vm_name.as_str()));
        assert_eq!(
            saved.assigned.as_ref().unwrap().url(),
            "https://github.com/test/repo/actions/runs/7/job/42"
        );
        let mut restarted = single_backend(backend.runtime.clone()).unwrap();
        let recovered = restarted.diagnostic_for(&attempt, Operation::DeleteRunner);
        assert_eq!(recovered.guest.as_ref().unwrap().exit_code, Some(5));
        assert_eq!(
            recovered.first_failure.as_ref().unwrap().operation,
            Operation::StartRunner
        );
        assert_eq!(recovered.last_outcome, EffectState::Succeeded);
    }
    #[tokio::test]
    async fn unavailable_diagnostics_do_not_prevent_authorized_space_cleanup() {
        let (directory, _, mut backend) = startup_fixture();
        backend.runtime.state_directory = directory.path().join("missing-state-directory");
        std::fs::remove_file(directory.path().join("booting")).unwrap();
        let mut attempt = pending(Operation::DeleteVm).active.unwrap();
        attempt.phase = Phase::Cleaning;
        attempt.guest_prepared = true;
        std::fs::write(directory.path().join("reported-stopped"), &attempt.vm_name).unwrap();
        assert_eq!(
            backend
                .execute(&Effect {
                    ticket: 1,
                    operation: Operation::DeleteVm,
                    attempt
                })
                .await,
            Outcome::Succeeded { runner_id: None }
        );
        assert!(startup_events(directory.path()).contains("owned_delete"));
    }
    #[tokio::test]
    async fn recovered_boot_uses_positive_guest_rpc_without_asif_inventory_or_replaying_run() {
        let (directory, config, mut backend) = startup_fixture();
        let mut journal = pending(Operation::BootVm);
        journal.active.as_mut().unwrap().vm_booted = false;
        // No retained process handle after restart and no guest response: this
        // remains Unknown. Listing would reproduce the real VF lock collision.
        let observed = backend.observe(&config.policy, &journal, 10).await;
        assert_eq!(observed.vm, VmObservation::Unknown);
        assert_eq!(
            observed.effect_result.as_ref().unwrap().outcome,
            Outcome::Unknown
        );
        assert_eq!(
            crate::scheduler::decide(&config.policy, &journal, &observed, 10).next,
            journal
        );
        std::fs::write(directory.path().join("guest-agent-ready"), b"").unwrap();
        let observed = backend.observe(&config.policy, &journal, 11).await;
        assert_eq!(observed.vm, VmObservation::Running);
        assert_eq!(
            observed.effect_result.as_ref().unwrap().outcome,
            Outcome::Succeeded { runner_id: None }
        );
        let confirmed = crate::scheduler::decide(&config.policy, &journal, &observed, 11).next;
        let observed = backend.observe(&config.policy, &confirmed, 12).await;
        let decision = crate::scheduler::decide(&config.policy, &confirmed, &observed, 12);
        assert_eq!(decision.effect.unwrap().operation, Operation::PrepareGuest);
        let events = startup_events(directory.path());
        assert!(
            events.lines().all(|event| event == "guest_agent"),
            "unexpected startup operation: {events}"
        );
    }
    #[tokio::test]
    async fn starting_guest_preparation_recovery_never_inventories_or_assumes_absence() {
        let (directory, config, mut backend) = startup_fixture();
        let journal = pending(Operation::PrepareGuest);
        let observed = backend.observe(&config.policy, &journal, 10).await;
        assert_eq!(observed.vm, VmObservation::Unknown);
        assert_eq!(observed.effect_result.unwrap().outcome, Outcome::Failed);
        std::fs::write(directory.path().join("guest-agent-ready"), b"").unwrap();
        std::fs::write(directory.path().join("helper-ready"), b"").unwrap();
        let observed = backend.observe(&config.policy, &journal, 11).await;
        assert_eq!(observed.vm, VmObservation::Running);
        assert_eq!(observed.guest, GuestObservation::Ready);
        assert_eq!(
            observed.effect_result.unwrap().outcome,
            Outcome::Succeeded { runner_id: None }
        );
        let events = startup_events(directory.path());
        assert!(
            events
                .lines()
                .all(|event| ["guest_agent", "guest_status"].contains(&event)),
            "unsafe startup operation: {events}"
        );
        // An absolute expired boot deadline fails the owned attempt without
        // issuing another run, a metadata probe, or any JIT operation.
        let observed = backend
            .observe(&config.policy, &pending(Operation::BootVm), 601)
            .await;
        assert_eq!(observed.vm, VmObservation::Unknown);
        assert_eq!(observed.effect_result.unwrap().outcome, Outcome::Failed);
        assert_eq!(startup_events(directory.path()), events);
    }
    #[tokio::test]
    async fn prelock_retained_owner_is_reaped_before_stopped_inventory_can_delete_its_vm() {
        let (directory, config, mut backend) = startup_fixture();
        std::fs::remove_file(directory.path().join("booting")).unwrap();
        let mut journal = pending(Operation::BootVm);
        let attempt = journal.active.as_mut().unwrap();
        attempt.phase = Phase::Cleaning;
        attempt.pending = None;
        attempt.vm_booted = false;
        std::fs::write(directory.path().join("reported-stopped"), &attempt.vm_name).unwrap();
        let child = tokio::process::Command::new(&config.tart.binary)
            .arg("owner-before-pidlock")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        backend.running_vm = Some((attempt.nonce.clone(), RunningVm::from_test_child(child)));
        tokio::time::timeout(Duration::from_secs(2), async {
            while !directory.path().join("prelock-owner-ready").exists() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(directory.path().join("prelock-owner.lock"))
            .unwrap();
        assert!(matches!(
            lock.try_lock(),
            Err(std::fs::TryLockError::WouldBlock)
        ));
        let observed = backend.observe(&config.policy, &journal, 601).await;
        assert_eq!(observed.vm, VmObservation::Stopped);
        assert!(backend.running_vm.is_none());
        lock.try_lock()
            .expect("the exact owned child must already be reaped");
        lock.unlock().unwrap();
        let effect = crate::scheduler::decide(&config.policy, &journal, &observed, 601)
            .effect
            .unwrap();
        assert_eq!(effect.operation, Operation::DeleteVm);
        assert_eq!(
            backend.execute(&effect).await,
            Outcome::Succeeded { runner_id: None }
        );
        let events = startup_events(directory.path());
        assert!(!events.contains("unsafe_inventory_or_delete_before_owner_exit"));
        assert!(events.contains("owned_delete"));
    }
    #[tokio::test]
    async fn recovered_unready_boot_without_exact_owner_never_trusts_stopped_or_absent_inventory() {
        let (directory, config, mut backend) = startup_fixture();
        let mut journal = pending(Operation::BootVm);
        journal.active.as_mut().unwrap().vm_booted = false;
        let observed = backend.observe(&config.policy, &journal, 601).await;
        let journal = crate::scheduler::decide(&config.policy, &journal, &observed, 601).next;
        assert_eq!(journal.active.as_ref().unwrap().phase, Phase::Cleaning);
        let observed = backend.observe(&config.policy, &journal, 602).await;
        assert_eq!(observed.vm, VmObservation::Unknown);
        assert!(!observed.admission_safe);
        let decision = crate::scheduler::decide(&config.policy, &journal, &observed, 602);
        assert!(decision.effect.is_none());
        assert!(decision.next.active.is_some());
        let effect = Effect {
            ticket: 99,
            operation: Operation::DeleteVm,
            attempt: journal.active.unwrap(),
        };
        assert_eq!(backend.execute(&effect).await, Outcome::Unknown);
        assert!(
            startup_events(directory.path()).is_empty(),
            "uncertain startup must not inventory or delete"
        );
    }
    #[tokio::test]
    async fn versioned_boot_intent_crash_before_spawn_can_clean_only_after_fresh_inventory() {
        let (directory, config, mut backend) = startup_fixture();
        std::fs::remove_file(directory.path().join("booting")).unwrap();
        let mut journal = pending(Operation::BootVm);
        let attempt = journal.active.as_mut().unwrap();
        attempt.vm_booted = false;
        attempt.boot_lease_version = 1;
        std::fs::write(directory.path().join("reported-stopped"), &attempt.vm_name).unwrap();
        let observed = backend.observe(&config.policy, &journal, 601).await;
        let journal = crate::scheduler::decide(&config.policy, &journal, &observed, 601).next;
        assert_eq!(journal.active.as_ref().unwrap().phase, Phase::Cleaning);
        assert!(
            startup_events(directory.path()).is_empty(),
            "Starting must not inventory or replay a boot"
        );
        let observed = backend.observe(&config.policy, &journal, 602).await;
        assert_eq!(observed.vm, VmObservation::Stopped);
        assert!(startup_events(directory.path()).contains("diskutil_metadata_probe"));
        let decision = crate::scheduler::decide(&config.policy, &journal, &observed, 602);
        assert!(
            decision.next.active.is_some(),
            "free lease is not VM absence"
        );
        assert_eq!(decision.effect.unwrap().operation, Operation::DeleteVm);
    }
    #[tokio::test]
    async fn inherited_boot_lease_blocks_recovery_until_native_owner_exits_then_exact_cleanup() {
        use std::os::unix::fs::OpenOptionsExt;
        let (directory, config, mut backend) = startup_fixture();
        std::fs::remove_file(directory.path().join("booting")).unwrap();
        let mut journal = pending(Operation::BootVm);
        let attempt = journal.active.as_mut().unwrap();
        attempt.phase = Phase::Cleaning;
        attempt.pending = None;
        attempt.vm_booted = false;
        attempt.boot_lease_version = 1;
        let name = attempt.vm_name.clone();
        let lease_path = directory.path().join(format!(".{name}.clone.lock"));
        let lease = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&lease_path)
            .unwrap();
        lease.lock().unwrap();
        let mut owner = tokio::process::Command::new(&config.tart.binary)
            .arg("boot-lease-owner")
            .stdin(std::process::Stdio::from(lease.try_clone().unwrap()))
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !directory.path().join("boot-lease-owner-ready").exists() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        drop(lease); // Native fd0, not a mapped RunningVm, now owns the lease.
        std::fs::write(directory.path().join("reported-stopped"), &name).unwrap();
        let observed = backend.observe(&config.policy, &journal, 601).await;
        assert_eq!(observed.vm, VmObservation::Unknown);
        let blocked = crate::scheduler::decide(&config.policy, &journal, &observed, 601);
        assert!(blocked.effect.is_none());
        assert!(blocked.next.active.is_some());
        let premature = Effect {
            ticket: 99,
            operation: Operation::DeleteVm,
            attempt: journal.active.as_ref().unwrap().clone(),
        };
        assert_eq!(backend.execute(&premature).await, Outcome::Unknown);
        assert!(
            startup_events(directory.path()).is_empty(),
            "held boot lease must precede inventory/deletion"
        );
        owner.kill().await.unwrap();
        owner.wait().await.unwrap();
        // An unrelated concurrent fork may briefly retain a CLOEXEC duplicate
        // from before the test parent's drop. Production correctly waits for
        // every holder, so observe only after that quiescence is established.
        tokio::time::timeout(Duration::from_secs(2), async {
            let name = OwnedVmName::parse(&name).unwrap();
            while !backend.tart.operation_finished(&name).unwrap() {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();
        let observed = backend.observe(&config.policy, &journal, 602).await;
        assert_eq!(observed.vm, VmObservation::Stopped);
        let decision = crate::scheduler::decide(&config.policy, &journal, &observed, 602);
        let effect = decision.effect.clone().unwrap();
        assert_eq!(effect.operation, Operation::DeleteVm);
        let outcome = backend.execute(&effect).await;
        assert_eq!(outcome, Outcome::Succeeded { runner_id: None });
        assert!(!lease_path.exists());
        let resolved = crate::scheduler::decide(
            &config.policy,
            &decision.next,
            &Observation {
                effect_result: Some(EffectResult {
                    ticket: effect.ticket,
                    outcome,
                }),
                ..Observation::default()
            },
            603,
        )
        .next;
        let observed = backend.observe(&config.policy, &resolved, 604).await;
        assert_eq!(observed.vm, VmObservation::Absent);
        assert!(
            crate::scheduler::decide(&config.policy, &resolved, &observed, 604)
                .next
                .active
                .is_none()
        );
        assert!(!startup_events(directory.path()).contains("unexpected_effect_or_replay"));
    }
}
