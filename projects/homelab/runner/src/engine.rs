//! The same durable-effect driver is used by production and fault-injection tests.
use crate::{
    config::Config,
    scheduler::{self, Effect, EffectResult, Observation, Outcome},
    state::Journal,
    store::{Store, StoreError},
};

fn store_category(error: &StoreError) -> &'static str {
    match error {
        StoreError::Permissions => "permissions",
        StoreError::Locked => "locked",
        StoreError::Invalid => "invalid",
        StoreError::Io(_) => "io",
    }
}
pub trait Persistence {
    fn load(&self) -> Result<Journal, StoreError>;
    fn save(&self, journal: &Journal) -> Result<(), StoreError>;
}
impl Persistence for Store {
    fn load(&self) -> Result<Journal, StoreError> {
        Store::load(self)
    }
    fn save(&self, journal: &Journal) -> Result<(), StoreError> {
        Store::save(self, journal)
    }
}
#[allow(async_fn_in_trait)]
pub trait EngineBackend {
    /// A saved pending intent is reconciled here. Never execute it again.
    async fn observe(&mut self, config: &Config, journal: &Journal, now: u64) -> Observation;
    async fn execute(&mut self, effect: &Effect) -> Outcome;
}
pub struct Engine<B, S = Store> {
    pub backend: B,
    store: S,
    journal: Journal,
}
#[derive(Debug)]
pub struct StepReport {
    pub reason: &'static str,
    pub changed: bool,
    pub executed: bool,
    pub admission: serde_json::Value,
}
impl<B: EngineBackend, S: Persistence> Engine<B, S> {
    pub fn open(store: S, backend: B) -> Result<Self, StoreError> {
        let journal = store.load().inspect_err(|error| {
            tracing::error!(
                operation = "load_journal",
                category = store_category(error),
                "durable state unavailable; admission blocked"
            )
        })?;
        Ok(Self {
            backend,
            store,
            journal,
        })
    }
    pub fn journal(&self) -> &Journal {
        &self.journal
    }
    pub async fn step(&mut self, config: &Config, now: u64) -> Result<StepReport, StoreError> {
        let observed = self.backend.observe(config, &self.journal, now).await;
        let decision = scheduler::decide(config, &self.journal, &observed, now);
        let mut blockers = observed.admission_blockers.clone();
        if self
            .journal
            .attempts()
            .filter(|a| a.platform == crate::config::Platform::MacosArm64)
            .count()
            >= config.max_macos_guests
            && observed.candidates.iter().any(|c| {
                crate::config::Platform::resolve(&c.labels)
                    == Some(crate::config::Platform::MacosArm64)
            })
        {
            blockers.push("macos_guest_limit");
        }
        let admission = serde_json::json!({
            "blockers": blockers,
            "queued_candidates": observed.candidates.len(),
            "revalidated_candidates": observed.revalidated.len(),
            "admission_safe": observed.admission_safe,
            "free_bytes": observed.free_bytes,
            "max_jobs": config.max_concurrent_jobs,
            "max_macos_guests": config.max_macos_guests,
            "cpu_budget": config.cpu_budget,
            "memory_budget_mib": config.memory_budget_mib,
            "retry_after": self.journal.retry_after,
            "capacity": decision.capacity,
        });
        let mut changed = decision.next != self.journal;
        if changed {
            // If this fails, no external effect is permitted, even if rename may have succeeded.
            self.store.save(&decision.next).inspect_err(|error| {
                tracing::error!(
                    operation = "persist_intent",
                    category = store_category(error),
                    sequence = decision.next.sequence,
                    "durable state write failed; external effect prevented"
                )
            })?;
            self.journal = decision.next;
        }
        let executed = decision.effect.is_some();
        if let Some(effect) = decision.effect {
            // Scheduler effects always require the exact intent to have reached the durable store.
            let outcome = self.backend.execute(&effect).await;
            let resolution = Observation {
                effect_result: Some(EffectResult {
                    ticket: effect.ticket,
                    outcome,
                }),
                ..Observation::default()
            };
            let resolved = scheduler::decide(config, &self.journal, &resolution, now);
            if resolved.next != self.journal {
                self.store.save(&resolved.next).inspect_err(|error| {
                    tracing::error!(
                        operation = "persist_result",
                        category = store_category(error),
                        ticket = effect.ticket,
                        "effect resolution write failed; pending intent retained for reconciliation"
                    )
                })?;
                self.journal = resolved.next;
                changed = true;
            }
        }
        Ok(StepReport {
            reason: decision.reason,
            changed,
            executed,
            admission,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        config::{Deadlines, RepositoryConfig},
        scheduler::{Candidate, VmObservation},
        state::{JobIdentity, Operation},
    };
    use std::{
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::{Arc, Mutex},
    };
    fn config() -> Config {
        Config {
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
                runner_group_id: 1,
                trust_approved: true,
            }],
            image: format!("ghcr.io/test/base@sha256:{}", "a".repeat(64)),
            cpu: 4,
            memory_mib: 8192,
            admission_free_bytes: 100,
            emergency_free_bytes: 10,
            deadlines: Deadlines::default(),
        }
    }
    fn demand() -> Observation {
        let job = JobIdentity {
            repository: "test/repo".into(),
            run_id: 1,
            run_attempt: 1,
            job_id: 2,
        };
        Observation {
            admission_safe: true,
            candidates: vec![Candidate {
                job: job.clone(),
                created_at: 1,
                labels: vec!["homelab-tart".into()],
                group: None,
            }],
            revalidated: vec![job],
            free_bytes: Some(1000),
            admission_nonce: Some("a".repeat(32)),
            vm: VmObservation::Absent,
            ..Observation::default()
        }
    }
    struct Backend {
        journal_file: PathBuf,
        calls: Arc<Mutex<Vec<Operation>>>,
        crash: bool,
    }
    impl EngineBackend for Backend {
        async fn observe(&mut self, _: &Config, journal: &Journal, _: u64) -> Observation {
            if journal.active.is_some() {
                Observation::default()
            } else {
                demand()
            }
        }
        async fn execute(&mut self, effect: &Effect) -> Outcome {
            let disk: Journal =
                serde_json::from_slice(&std::fs::read(&self.journal_file).unwrap()).unwrap();
            assert_eq!(disk.active.unwrap().pending.unwrap().ticket, effect.ticket);
            self.calls.lock().unwrap().push(effect.operation);
            assert!(!self.crash, "injected crash after external effect");
            Outcome::Succeeded { runner_id: None }
        }
    }
    #[tokio::test]
    async fn real_store_is_committed_before_effect_and_restart_never_replays_pending_intent() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let calls = Arc::new(Mutex::new(vec![]));
        let backend = Backend {
            journal_file: root.path().join("journal.json"),
            calls: calls.clone(),
            crash: true,
        };
        let mut engine = Engine::open(Store::open(root.path()).unwrap(), backend).unwrap();
        // A task panic models process loss after the effect and before its resolution write.
        let result = tokio::spawn(async move { engine.step(&config(), 10).await }).await;
        assert!(result.is_err());
        let backend = Backend {
            journal_file: root.path().join("journal.json"),
            calls: calls.clone(),
            crash: false,
        };
        let mut restarted = Engine::open(Store::open(root.path()).unwrap(), backend).unwrap();
        assert!(!restarted.step(&config(), 11).await.unwrap().executed);
        assert_eq!(*calls.lock().unwrap(), vec![Operation::CloneVm]);
        assert!(
            restarted
                .journal()
                .active
                .as_ref()
                .unwrap()
                .pending
                .is_some()
        );
    }
    struct RejectWrites;
    impl Persistence for RejectWrites {
        fn load(&self) -> Result<Journal, StoreError> {
            Ok(Journal::default())
        }
        fn save(&self, _: &Journal) -> Result<(), StoreError> {
            Err(StoreError::Io(std::io::Error::other(
                "injected fsync failure",
            )))
        }
    }
    #[tokio::test]
    async fn failed_durable_write_prevents_effect() {
        let calls = Arc::new(Mutex::new(vec![]));
        let mut engine = Engine::open(
            RejectWrites,
            Backend {
                journal_file: "unused".into(),
                calls: calls.clone(),
                crash: false,
            },
        )
        .unwrap();
        assert!(engine.step(&config(), 10).await.is_err());
        assert!(calls.lock().unwrap().is_empty());
        assert!(engine.journal().active.is_none());
    }
    struct World {
        path: PathBuf,
        vm: VmObservation,
        runner: crate::scheduler::RunnerObservation,
        guest: crate::scheduler::GuestObservation,
        operations: Vec<Operation>,
    }
    impl EngineBackend for World {
        async fn observe(&mut self, _: &Config, journal: &Journal, _: u64) -> Observation {
            let mut observed = if journal.active.is_none() {
                demand()
            } else {
                Observation::default()
            };
            observed.vm = self.vm.clone();
            observed.runner = self.runner.clone();
            observed.guest = self.guest.clone();
            observed.free_bytes = Some(1000);
            observed
        }
        async fn execute(&mut self, effect: &Effect) -> Outcome {
            let disk: Journal =
                serde_json::from_slice(&std::fs::read(&self.path).unwrap()).unwrap();
            assert_eq!(disk.active.unwrap().pending.unwrap().ticket, effect.ticket);
            self.operations.push(effect.operation);
            match effect.operation {
                Operation::CloneVm => self.vm = VmObservation::Stopped,
                Operation::BootVm => {
                    self.vm = VmObservation::Running;
                }
                Operation::PrepareGuest => self.guest = crate::scheduler::GuestObservation::Ready,
                Operation::CreateJit => {
                    self.runner = crate::scheduler::RunnerObservation::Idle;
                    return Outcome::Succeeded { runner_id: Some(7) };
                }
                Operation::StartRunner => {
                    self.runner = crate::scheduler::RunnerObservation::Busy(JobIdentity {
                        repository: "test/repo".into(),
                        run_id: 8,
                        run_attempt: 1,
                        job_id: 99,
                    })
                }
                Operation::StopVm => self.vm = VmObservation::Stopped,
                Operation::DeleteVm => self.vm = VmObservation::Absent,
                Operation::DeleteRunner => {
                    self.runner = crate::scheduler::RunnerObservation::Absent
                }
            }
            Outcome::Succeeded { runner_id: None }
        }
    }
    #[tokio::test]
    async fn complete_driver_binds_actual_job_then_cleans_every_owned_resource_before_release() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let world = World {
            path: root.path().join("journal.json"),
            vm: VmObservation::Absent,
            runner: crate::scheduler::RunnerObservation::Absent,
            guest: crate::scheduler::GuestObservation::Unknown,
            operations: vec![],
        };
        let mut engine = Engine::open(Store::open(root.path()).unwrap(), world).unwrap();
        for _ in 0..7 {
            engine.step(&config(), 10).await.unwrap();
        }
        let attempt = engine.journal().active.as_ref().unwrap();
        assert_eq!(attempt.assigned.as_ref().unwrap().job_id, 99);
        assert_eq!(attempt.candidate.job_id, 2);
        engine.backend.guest = crate::scheduler::GuestObservation::Exited;
        let mut draining = config();
        draining.admission_enabled = false;
        for _ in 0..6 {
            engine.step(&draining, 20).await.unwrap();
        }
        assert!(engine.journal().active.is_none());
        assert_eq!(
            engine.backend.operations,
            vec![
                Operation::CloneVm,
                Operation::BootVm,
                Operation::PrepareGuest,
                Operation::CreateJit,
                Operation::StartRunner,
                Operation::StopVm,
                Operation::DeleteVm,
                Operation::DeleteRunner
            ]
        );
        let disk: Journal =
            serde_json::from_slice(&std::fs::read(root.path().join("journal.json")).unwrap())
                .unwrap();
        assert!(disk.active.is_none());
    }
    struct FailResolution {
        store: Store,
        writes: std::cell::Cell<u32>,
    }
    impl Persistence for FailResolution {
        fn load(&self) -> Result<Journal, StoreError> {
            self.store.load()
        }
        fn save(&self, journal: &Journal) -> Result<(), StoreError> {
            let count = self.writes.get() + 1;
            self.writes.set(count);
            if count == 2 {
                Err(StoreError::Io(std::io::Error::other(
                    "injected result-write failure",
                )))
            } else {
                self.store.save(journal)
            }
        }
    }
    #[tokio::test]
    async fn failed_result_write_retains_durable_intent_for_restart_without_replay() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let calls = Arc::new(Mutex::new(vec![]));
        let backend = Backend {
            journal_file: root.path().join("journal.json"),
            calls: calls.clone(),
            crash: false,
        };
        let store = FailResolution {
            store: Store::open(root.path()).unwrap(),
            writes: std::cell::Cell::new(0),
        };
        let mut engine = Engine::open(store, backend).unwrap();
        assert!(engine.step(&config(), 10).await.is_err());
        drop(engine);
        let backend = Backend {
            journal_file: root.path().join("journal.json"),
            calls: calls.clone(),
            crash: false,
        };
        let mut engine = Engine::open(Store::open(root.path()).unwrap(), backend).unwrap();
        assert!(!engine.step(&config(), 11).await.unwrap().executed);
        assert_eq!(*calls.lock().unwrap(), vec![Operation::CloneVm]);
    }
}
