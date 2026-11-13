use homelab_runner::{config::*, scheduler::*, state::*};

fn repo(name: &str, id: u64) -> RepositoryConfig {
    RepositoryConfig {
        owner: "owner".into(),
        name: name.into(),
        repository_id: id,
        installation_id: 1,
        runner_group_id: 1,
        trust_approved: true,
    }
}
fn config() -> Config {
    Config {
        host_name: "homelab-macbook".into(),
        admission_enabled: true,
        max_concurrent_jobs: 1,
        max_macos_guests: 2,
        cpu_budget: 12,
        memory_budget_mib: 24576,
        linux: None,
        repositories: vec![repo("a", 1), repo("b", 2)],
        image: format!("registry/image@sha256:{}", "a".repeat(64)),
        cpu: 4,
        memory_mib: 8192,
        admission_free_bytes: 100,
        emergency_free_bytes: 10,
        deadlines: Deadlines::default(),
    }
}
fn job(repository: &str, id: u64) -> JobIdentity {
    JobIdentity {
        repository: repository.into(),
        run_id: 1,
        run_attempt: 2,
        job_id: id,
    }
}
fn candidate(repository: &str, id: u64, time: u64) -> Candidate {
    Candidate {
        job: job(repository, id),
        created_at: time,
        labels: vec![
            "self-hosted".into(),
            "macOS".into(),
            "ARM64".into(),
            "homelab-tart".into(),
        ],
        group: None,
    }
}
fn observation() -> Observation {
    let candidates = vec![candidate("owner/a", 1, 1), candidate("owner/b", 2, 2)];
    Observation {
        admission_safe: true,
        revalidated: candidates.iter().map(|c| c.job.clone()).collect(),
        candidates,
        free_bytes: Some(100),
        admission_nonce: Some("a".repeat(32)),
        vm: VmObservation::Absent,
        runner: RunnerObservation::Absent,
        ..Observation::default()
    }
}
fn reserved() -> Journal {
    decide(&config(), &Journal::default(), &observation(), 100).next
}

#[test]
fn host_identity_is_snapshotted_and_legacy_attempts_still_recover() {
    let current = reserved();
    let attempt = current.active.as_ref().unwrap();
    assert_eq!(
        attempt.vm_name,
        format!("homelab-macbook-job-{}", attempt.nonce)
    );
    assert_eq!(attempt.runner_name, attempt.vm_name);
    current.validate().unwrap();

    let mut renamed_host = config();
    renamed_host.host_name = "other-mac".into();
    let after = decide(&renamed_host, &current, &observation(), 101).next;
    assert_eq!(after.active.as_ref().unwrap().vm_name, attempt.vm_name);

    let mut legacy = current.clone();
    let active = legacy.active.as_mut().unwrap();
    active.vm_name = format!("homelab-job-{}", active.nonce);
    active.runner_name = active.vm_name.clone();
    legacy.validate().unwrap();
    assert_eq!(
        decide(&config(), &legacy, &observation(), 101)
            .next
            .active
            .unwrap()
            .vm_name,
        legacy.active.unwrap().vm_name
    );
}
fn resolve(j: &Journal, outcome: Outcome, now: u64) -> Journal {
    let ticket = j.active.as_ref().unwrap().pending.as_ref().unwrap().ticket;
    let mut o = observation();
    o.effect_result = Some(EffectResult { ticket, outcome });
    let d = decide(&config(), j, &o, now);
    assert!(d.effect.is_none());
    d.next
}
fn listening() -> Journal {
    let mut j = reserved();
    let mut o = observation();
    for op in [
        Operation::CloneVm,
        Operation::BootVm,
        Operation::PrepareGuest,
        Operation::CreateJit,
        Operation::StartRunner,
    ] {
        assert_eq!(
            j.active
                .as_ref()
                .unwrap()
                .pending
                .as_ref()
                .unwrap()
                .operation,
            op
        );
        j = resolve(
            &j,
            Outcome::Succeeded {
                runner_id: Some(99),
            },
            101,
        );
        if op != Operation::StartRunner {
            o.vm = VmObservation::Running;
            o.guest = GuestObservation::Ready;
            j = decide(&config(), &j, &o, 101).next;
        }
    }
    j
}

fn booted() -> Journal {
    let j = resolve(&reserved(), Outcome::Succeeded { runner_id: None }, 101);
    let j = decide(&config(), &j, &observation(), 102).next;
    assert_eq!(
        j.active
            .as_ref()
            .unwrap()
            .pending
            .as_ref()
            .unwrap()
            .operation,
        Operation::BootVm
    );
    resolve(&j, Outcome::Succeeded { runner_id: None }, 103)
}

#[test]
fn stock_vm_prepares_public_helper_before_any_jit_and_waits_for_guest_readiness() {
    let j = booted();
    let mut o = observation();
    o.vm = VmObservation::Running;
    // Even a preexisting guest Ready response cannot skip our durable preparation.
    o.guest = GuestObservation::Ready;
    let d = decide(&config(), &j, &o, 104);
    assert_eq!(d.effect.unwrap().operation, Operation::PrepareGuest);
    let a = d.next.active.as_ref().unwrap();
    assert!(!a.guest_prepared);
    assert!(!a.jit_created);
    assert!(a.runner_id.is_none());
    // A crash after public injection cannot replay the operation or mint a JIT.
    let restarted: Journal = serde_json::from_slice(&serde_json::to_vec(&d.next).unwrap()).unwrap();
    assert!(decide(&config(), &restarted, &o, 105).effect.is_none());
    let j = resolve(&restarted, Outcome::Succeeded { runner_id: None }, 106);
    assert!(j.active.as_ref().unwrap().guest_prepared);
    assert_eq!(j.active.as_ref().unwrap().boot_deadline, 700);
    o.guest = GuestObservation::Unknown;
    assert!(decide(&config(), &j, &o, 107).effect.is_none());
    o.guest = GuestObservation::Ready;
    assert_eq!(
        decide(&config(), &j, &o, 108).effect.unwrap().operation,
        Operation::CreateJit
    );
}

#[test]
fn failed_guest_preparation_cleans_exact_vm_without_ever_creating_a_registration() {
    let mut o = observation();
    o.vm = VmObservation::Running;
    let pending = decide(&config(), &booted(), &o, 104).next;
    let j = resolve(&pending, Outcome::Failed, 105);
    let a = j.active.as_ref().unwrap();
    assert_eq!(a.phase, Phase::Cleaning);
    assert!(!a.jit_created);
    assert!(a.runner_id.is_none());
    let d = decide(&config(), &j, &o, 106);
    let effect = d.effect.unwrap();
    assert_eq!(effect.operation, Operation::StopVm);
    assert_eq!(effect.attempt.vm_name, a.vm_name);
}

#[test]
fn guest_preparation_cannot_extend_the_persisted_boot_deadline() {
    let mut o = observation();
    o.vm = VmObservation::Running;
    let pending = decide(&config(), &booted(), &o, 104).next;
    let j = resolve(&pending, Outcome::Succeeded { runner_id: None }, 701);
    o.guest = GuestObservation::Ready;
    let d = decide(&config(), &j, &o, 702);
    assert_eq!(d.effect.unwrap().operation, Operation::StopVm);
    assert!(!d.next.active.unwrap().jit_created);
}

#[test]
fn old_journals_default_guest_preparation_to_false() {
    let mut value = serde_json::to_value(reserved()).unwrap();
    value["active"]
        .as_object_mut()
        .unwrap()
        .remove("guest_prepared");
    value["active"]
        .as_object_mut()
        .unwrap()
        .remove("boot_lease_version");
    let decoded: Journal = serde_json::from_value(value).unwrap();
    assert!(!decoded.active.as_ref().unwrap().guest_prepared);
    assert_eq!(decoded.active.as_ref().unwrap().boot_lease_version, 0);
    assert!(decoded.validate().is_ok());
}

#[test]
fn boot_lease_protocol_is_durable_in_intent_before_any_spawn_and_never_replayed() {
    let cloned = resolve(&reserved(), Outcome::Succeeded { runner_id: None }, 101);
    assert_eq!(cloned.active.as_ref().unwrap().boot_lease_version, 0);
    let decision = decide(&config(), &cloned, &observation(), 102);
    let effect = decision.effect.unwrap();
    assert_eq!(effect.operation, Operation::BootVm);
    assert_eq!(effect.attempt.boot_lease_version, 1);
    let restarted: Journal =
        serde_json::from_slice(&serde_json::to_vec(&decision.next).unwrap()).unwrap();
    assert_eq!(restarted.active.as_ref().unwrap().boot_lease_version, 1);
    assert!(
        decide(&config(), &restarted, &Observation::default(), 103)
            .effect
            .is_none()
    );
    let mut unsupported = restarted;
    unsupported.active.as_mut().unwrap().boot_lease_version = 2;
    assert!(unsupported.validate().is_err());
}

#[test]
fn intent_is_durable_and_pending_is_never_replayed() {
    let d = decide(&config(), &Journal::default(), &observation(), 100);
    let effect = d.effect.unwrap();
    assert_eq!(effect.operation, Operation::CloneVm);
    assert_eq!(effect.attempt, d.next.active.clone().unwrap());
    let encoded = serde_json::to_vec(&d.next).unwrap();
    let restarted: Journal = serde_json::from_slice(&encoded).unwrap();
    assert_eq!(
        decide(&config(), &restarted, &observation(), 200).effect,
        None
    );
    assert_eq!(restarted.active.unwrap().boot_deadline, 700);
}

#[test]
fn fairness_rotates_repositories_and_oldest_job_wins_within_repository() {
    let mut o = observation();
    o.candidates.push(candidate("owner/a", 3, 0));
    o.revalidated.push(job("owner/a", 3));
    let first = decide(&config(), &Journal::default(), &o, 100).next;
    assert_eq!(first.active.as_ref().unwrap().candidate.job_id, 3);
    let mut cleaned = first;
    cleaned.active = None;
    o.admission_nonce = Some("b".repeat(32));
    let second = decide(&config(), &cleaned, &o, 200).next;
    assert_eq!(second.active.unwrap().repository.key(), "owner/b");
}

#[test]
fn discovery_backoff_partial_pages_and_revalidation_fail_closed() {
    let mut o = observation();
    o.admission_safe = false;
    assert!(
        decide(&config(), &Journal::default(), &o, 100)
            .next
            .active
            .is_none()
    );
    o.admission_safe = true;
    o.revalidated.clear();
    assert!(
        decide(&config(), &Journal::default(), &o, 100)
            .next
            .active
            .is_none()
    );
}

#[test]
fn unsupported_labels_and_group_routing_are_rejected() {
    for unsupported in ["linux", "x64", "custom-xcode-99"] {
        let mut o = observation();
        o.candidates.retain(|c| c.job.repository == "owner/a");
        o.candidates[0].labels.push(unsupported.into());
        assert!(
            decide(&config(), &Journal::default(), &o, 100)
                .next
                .active
                .is_none()
        );
    }
    let mut o = observation();
    for c in &mut o.candidates {
        c.group = Some("other".into());
    }
    assert!(
        decide(&config(), &Journal::default(), &o, 100)
            .next
            .active
            .is_none()
    );
}

#[test]
fn busy_runner_cleanup_rejection_retains_slot_until_registration_is_absent() {
    let mut journal = listening();
    journal.active.as_mut().unwrap().phase = Phase::Cleaning;
    let mut observed = observation();
    observed.vm = VmObservation::Absent;
    observed.runner = RunnerObservation::Busy(job("owner/a", 42));
    let first = decide(&config(), &journal, &observed, 500);
    assert_eq!(first.effect.unwrap().operation, Operation::DeleteRunner);
    let uncertain = resolve(&first.next, Outcome::Unknown, 501);
    assert!(uncertain.active.as_ref().unwrap().pending.is_some());
    let reconciled = resolve(&uncertain, Outcome::Failed, 532);
    let retry = decide(&config(), &reconciled, &observed, 533);
    assert_eq!(retry.effect.unwrap().operation, Operation::DeleteRunner);
    assert!(retry.next.active.is_some());
    let removed = resolve(&retry.next, Outcome::Succeeded { runner_id: None }, 534);
    observed.runner = RunnerObservation::Unknown;
    assert!(
        decide(&config(), &removed, &observed, 535)
            .next
            .active
            .is_some()
    );
    observed.runner = RunnerObservation::Absent;
    assert!(
        decide(&config(), &removed, &observed, 536)
            .next
            .active
            .is_none()
    );
}

#[test]
fn actual_assignment_survives_candidate_cancellation_and_api_outage() {
    let j = listening();
    let mut o = observation();
    o.candidates.clear();
    o.revalidated.clear();
    o.vm = VmObservation::Running;
    o.runner = RunnerObservation::Busy(job("owner/a", 42));
    let d = decide(&config(), &j, &o, 200);
    let a = d.next.active.as_ref().unwrap();
    assert_eq!(a.assigned.as_ref().unwrap().job_id, 42);
    assert_eq!(a.candidate.job_id, 1);
    assert_eq!(a.running_deadline, Some(7400));
    o.runner = RunnerObservation::Unknown;
    o.admission_safe = false;
    let d = decide(&config(), &d.next, &o, 400);
    assert_eq!(d.next.active.unwrap().phase, Phase::Running);
    assert!(d.effect.is_none());
}

#[test]
fn deadline_is_absolute_across_restart_and_cleans_during_api_outage() {
    let j = listening();
    let mut o = observation();
    o.vm = VmObservation::Running;
    o.runner = RunnerObservation::Unknown;
    let d = decide(&config(), &j, &o, 402);
    assert_eq!(d.effect.unwrap().operation, Operation::StopVm);
    assert_eq!(d.next.active.unwrap().unassigned_deadline, Some(401));
}

#[test]
fn lost_jit_response_is_not_recreated_and_recovered_registration_is_retired() {
    let mut j = listening();
    let a = j.active.as_mut().unwrap();
    a.phase = Phase::Starting;
    a.pending = Some(Intent {
        ticket: j.sequence,
        operation: Operation::CreateJit,
    });
    let unknown = resolve(&j, Outcome::Unknown, 200);
    assert!(unknown.active.as_ref().unwrap().pending.is_some());
    let j = resolve(&unknown, Outcome::RecoveredJit { runner_id: 99 }, 201);
    assert_eq!(j.active.as_ref().unwrap().phase, Phase::Cleaning);
    let mut o = observation();
    o.vm = VmObservation::Absent;
    o.runner = RunnerObservation::Idle;
    let d = decide(&config(), &j, &o, 202);
    assert_eq!(d.effect.unwrap().operation, Operation::DeleteRunner);
}

#[test]
fn successful_cleanup_admits_waiting_work_without_a_cooldown() {
    let mut journal = listening();
    journal.active.as_mut().unwrap().phase = Phase::Cleaning;
    let observed = observation();
    let released = decide(&config(), &journal, &observed, 200);
    assert!(released.next.is_idle());
    let next = decide(&config(), &released.next, &observed, 200);
    assert!(next.effect.is_some(), "{}", next.reason);
}

#[test]
fn failed_clone_and_failed_cleanup_retain_slot_until_both_resources_absent() {
    let j = resolve(&reserved(), Outcome::Failed, 110);
    let mut o = observation();
    o.vm = VmObservation::Stopped; // partial clone exists despite failure
    o.runner = RunnerObservation::Unknown;
    let d = decide(&config(), &j, &o, 111);
    assert_eq!(d.effect.unwrap().operation, Operation::DeleteVm);
    let j = resolve(&d.next, Outcome::Failed, 112);
    o.vm = VmObservation::Unknown;
    assert!(decide(&config(), &j, &o, 113).next.active.is_some());
    o.vm = VmObservation::Absent;
    assert!(decide(&config(), &j, &o, 114).next.active.is_some());
    o.runner = RunnerObservation::Absent;
    let d = decide(&config(), &j, &o, 115);
    assert!(d.next.active.is_none());
    assert_eq!(d.next.retry_after, 142);
}

#[test]
fn disabling_admission_does_not_skip_cleanup_or_interrupt_running_job() {
    let mut cfg = config();
    cfg.admission_enabled = false;
    let mut j = listening();
    let mut o = observation();
    o.vm = VmObservation::Running;
    o.runner = RunnerObservation::Busy(job("owner/a", 5));
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.active.as_ref().unwrap().phase, Phase::Running);
    assert!(d.effect.is_none());
    j = d.next;
    j.active.as_mut().unwrap().phase = Phase::Cleaning;
    assert_eq!(
        decide(&cfg, &j, &o, 201).effect.unwrap().operation,
        Operation::StopVm
    );
    assert!(
        decide(&cfg, &Journal::default(), &o, 200)
            .next
            .active
            .is_none()
    );
}

#[test]
fn changed_allowlist_retains_original_cleanup_identity() {
    let mut cfg = config();
    cfg.repositories.clear();
    let mut j = listening();
    j.active.as_mut().unwrap().phase = Phase::Cleaning;
    let mut o = observation();
    o.runner = RunnerObservation::Idle;
    let effect = decide(&cfg, &j, &o, 200).effect.unwrap();
    assert_eq!(effect.attempt.repository.key(), "owner/a");
    assert_eq!(effect.attempt.runner_id, Some(99));
}

#[test]
fn old_run_rerun_and_matrix_jobs_are_independent_demand() {
    let mut o = observation();
    o.candidates = vec![candidate("owner/a", 50, 0), candidate("owner/a", 51, 0)];
    o.revalidated = o.candidates.iter().map(|c| c.job.clone()).collect();
    assert_eq!(
        decide(&config(), &Journal::default(), &o, 100)
            .next
            .active
            .unwrap()
            .candidate
            .job_id,
        50
    );
    o.candidates.remove(0);
    assert_eq!(
        decide(&config(), &Journal::default(), &o, 100)
            .next
            .active
            .unwrap()
            .candidate
            .job_id,
        51
    );
}

#[test]
fn corrupt_ownership_or_stale_effect_ticket_blocks_mutations() {
    let mut j = reserved();
    let mut o = observation();
    o.effect_result = Some(EffectResult {
        ticket: 999,
        outcome: Outcome::Succeeded { runner_id: None },
    });
    assert_eq!(decide(&config(), &j, &o, 100).next, j);
    j.active.as_mut().unwrap().vm_name = "unrelated-vm".into();
    assert!(j.validate().is_err());
    assert!(decide(&config(), &j, &o, 100).effect.is_none());
}

#[test]
fn storage_emergency_stops_owned_vm_and_retains_slot() {
    let j = listening();
    let mut o = observation();
    o.vm = VmObservation::Running;
    o.runner = RunnerObservation::Unknown;
    o.free_bytes = Some(9);
    let d = decide(&config(), &j, &o, 200);
    let effect = d.effect.unwrap();
    assert_eq!(effect.operation, Operation::StopVm);
    assert_eq!(effect.attempt.vm_name, j.active.unwrap().vm_name);
    assert_eq!(d.next.active.unwrap().phase, Phase::Cleaning);
}

#[test]
fn every_pending_operation_requires_matching_reconciliation_before_any_effect() {
    for operation in [
        Operation::CloneVm,
        Operation::BootVm,
        Operation::PrepareGuest,
        Operation::CreateJit,
        Operation::StartRunner,
        Operation::StopVm,
        Operation::DeleteVm,
        Operation::DeleteRunner,
    ] {
        let mut j = listening();
        let sequence = j.sequence;
        let a = j.active.as_mut().unwrap();
        a.pending = Some(Intent {
            ticket: sequence,
            operation,
        });
        let d = decide(&config(), &j, &observation(), 1_000_000);
        assert!(d.effect.is_none(), "{operation:?}");
        assert_eq!(d.next, j);
    }
}

#[test]
fn disabled_starting_attempt_still_boots_and_known_rejected_jit_cleans_up() {
    let mut cfg = config();
    cfg.admission_enabled = false;
    let j = resolve(&reserved(), Outcome::Succeeded { runner_id: None }, 110);
    let mut o = observation();
    o.vm = VmObservation::Stopped;
    assert_eq!(
        decide(&cfg, &j, &o, 111).effect.unwrap().operation,
        Operation::BootVm
    );
    let mut j = listening();
    j.active.as_mut().unwrap().pending = Some(Intent {
        ticket: j.sequence,
        operation: Operation::CreateJit,
    });
    let j = resolve(&j, Outcome::Failed, 200);
    o.vm = VmObservation::Running;
    assert_eq!(
        decide(&cfg, &j, &o, 201).effect.unwrap().operation,
        Operation::StopVm
    );
}

#[test]
fn allowlist_trust_and_pinned_image_are_required_for_admission() {
    let mut cfg = config();
    for r in &mut cfg.repositories {
        r.trust_approved = false;
    }
    assert!(
        decide(&cfg, &Journal::default(), &observation(), 100)
            .next
            .active
            .is_none()
    );
    cfg = config();
    cfg.image = "registry/image:latest".into();
    assert!(cfg.validate().is_err());
    assert!(
        decide(&cfg, &Journal::default(), &observation(), 100)
            .next
            .active
            .is_none()
    );
}

fn running_attempt(nonce: char, id: u64) -> Attempt {
    let mut a = listening().active.unwrap();
    a.nonce = nonce.to_string().repeat(32);
    a.vm_name = format!("homelab-macbook-job-{}", a.nonce);
    a.runner_name = a.vm_name.clone();
    a.candidate = job("owner/a", id);
    a.assigned = Some(a.candidate.clone());
    a.phase = Phase::Running;
    a.running_deadline = Some(10000);
    a.runner_id = Some(id + 100);
    a
}
fn fleet(count: usize) -> Journal {
    let mut j = listening();
    j.active = Some(running_attempt('a', 1));
    j.additional = (1..count)
        .map(|i| {
            running_attempt(
                char::from_digit((10 + i as u32) % 16, 16).unwrap(),
                i as u64 + 1,
            )
        })
        .collect();
    j.last_attempt = None;
    j
}
fn fleet_observation(journal: &Journal) -> Observation {
    let mut observed = observation();
    observed.free_bytes = Some(10000);
    observed.admission_nonce = Some(format!("{:032x}", u64::MAX));
    observed.candidates = (1..=10).map(|id| candidate("owner/a", id, id)).collect();
    observed.revalidated = observed.candidates.iter().map(|c| c.job.clone()).collect();
    for attempt in journal.attempts() {
        observed.attempts.insert(
            attempt.nonce.clone(),
            Box::new(Observation {
                vm: VmObservation::Running,
                runner: attempt
                    .assigned
                    .clone()
                    .map_or(RunnerObservation::Idle, RunnerObservation::Busy),
                free_bytes: Some(10000),
                ..Observation::default()
            }),
        );
    }
    observed
}
#[test]
fn configured_capacity_admits_second_but_never_third_macos_guest() {
    let n = 2;
    let mut cfg = config();
    cfg.max_concurrent_jobs = n;
    let j = fleet(n - 1);
    let o = fleet_observation(&j);
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.attempts().count(), n);
    assert_eq!(d.effect.unwrap().operation, Operation::CloneVm);
    let mut full = d.next;
    let a = full.additional.last_mut().unwrap();
    a.pending = None;
    a.phase = Phase::Cleaning;
    let o = fleet_observation(&full);
    let d = decide(&cfg, &full, &o, 201);
    assert_eq!(d.next.attempts().count(), n);
    assert_ne!(d.effect.map(|e| e.operation), Some(Operation::CloneVm));
}

#[test]
fn unsupported_macos_capacity_is_rejected_before_admission() {
    for limit in [0, 5, 8, 128, usize::MAX] {
        let mut cfg = config();
        cfg.max_concurrent_jobs = limit;
        assert!(
            cfg.validate()
                .unwrap_err()
                .contains("invalid total, macOS or resource capacity")
        );
        let observed = fleet_observation(&Journal::default());
        let decision = decide(&cfg, &Journal::default(), &observed, 200);
        assert!(decision.effect.is_none());
        assert!(decision.next.is_idle());
    }
}
#[test]
fn second_guest_requires_storage_for_both_growth_reservations() {
    let mut cfg = config();
    cfg.max_concurrent_jobs = 2;
    let j = fleet(1);
    let mut o = fleet_observation(&j);
    o.free_bytes = Some(189);
    assert!(decide(&cfg, &j, &o, 200).effect.is_none());
    o.free_bytes = Some(190);
    assert_eq!(
        decide(&cfg, &j, &o, 200).effect.unwrap().operation,
        Operation::CloneVm
    );
}
#[test]
fn slot_reduction_and_hold_leave_running_attempts_intact() {
    let j = fleet(3);
    let o = fleet_observation(&j);
    for enabled in [true, false] {
        let mut cfg = config();
        cfg.admission_enabled = enabled;
        let d = decide(&cfg, &j, &o, 200);
        assert_eq!(d.next, j);
        assert!(d.effect.is_none());
    }
}
#[test]
fn missing_peer_observation_never_borrows_another_vms_absence() {
    let j = fleet(2);
    let mut o = fleet_observation(&j);
    o.attempts.remove(&j.additional[0].nonce);
    o.vm = VmObservation::Absent;
    assert_eq!(decide(&config(), &j, &o, 200).next, j);
}
#[test]
fn cleanup_releases_only_its_slot_and_drain_requires_every_attempt() {
    let mut j = fleet(2);
    j.active.as_mut().unwrap().phase = Phase::Cleaning;
    let mut o = fleet_observation(&j);
    let a = o
        .attempts
        .get_mut(&j.active.as_ref().unwrap().nonce)
        .unwrap();
    a.vm = VmObservation::Absent;
    a.runner = RunnerObservation::Absent;
    let d = decide(&config(), &j, &o, 200);
    assert_eq!(d.next.attempts().count(), 1);
    assert_eq!(d.next.active.as_ref().unwrap(), &j.additional[0]);
    assert!(!d.next.is_idle());
    j = d.next;
    j.active.as_mut().unwrap().phase = Phase::Cleaning;
    let mut o = fleet_observation(&j);
    let a = o
        .attempts
        .get_mut(&j.active.as_ref().unwrap().nonce)
        .unwrap();
    a.vm = VmObservation::Absent;
    a.runner = RunnerObservation::Absent;
    assert!(decide(&config(), &j, &o, 201).next.is_idle());
}
#[test]
fn simultaneous_pending_intents_have_unique_tickets_and_resolve_independently() {
    let mut j = fleet(2);
    let mut o = fleet_observation(&j);
    for a in j.active.iter_mut().chain(j.additional.iter_mut()) {
        a.phase = Phase::Cleaning;
    }
    let first = decide(&config(), &j, &o, 200);
    let first_effect = first.effect.unwrap();
    j = first.next;
    let second = decide(&config(), &j, &o, 200);
    let second_effect = second.effect.unwrap();
    j = second.next;
    assert_ne!(first_effect.attempt.nonce, second_effect.attempt.nonce);
    assert_ne!(first_effect.ticket, second_effect.ticket);
    j.validate().unwrap();
    // A later sequence number must not invalidate the earlier pending operation.
    o = Observation {
        effect_result: Some(EffectResult {
            ticket: first_effect.ticket,
            outcome: Outcome::Succeeded { runner_id: None },
        }),
        ..Observation::default()
    };
    let resolved = decide(&config(), &j, &o, 201);
    assert!(resolved.effect.is_none());
    let earlier = resolved
        .next
        .attempts()
        .find(|a| a.nonce == first_effect.attempt.nonce)
        .unwrap();
    let later = resolved
        .next
        .attempts()
        .find(|a| a.nonce == second_effect.attempt.nonce)
        .unwrap();
    assert!(earlier.pending.is_none());
    assert_eq!(later.pending.as_ref().unwrap().ticket, second_effect.ticket);
}
#[test]
fn stalled_pending_attempt_does_not_block_a_peer_timeout() {
    let mut j = fleet(2);
    j.active.as_mut().unwrap().pending = Some(Intent {
        ticket: j.sequence,
        operation: Operation::StopVm,
    });
    j.additional[0].running_deadline = Some(150);
    let o = fleet_observation(&j);
    let d = decide(&config(), &j, &o, 200);
    assert_eq!(d.effect.unwrap().attempt.nonce, j.additional[0].nonce);
    assert_eq!(d.next.active.as_ref().unwrap(), j.active.as_ref().unwrap());
}
#[test]
fn demand_reservations_follow_actual_assignment_and_exclude_provisioning_hints() {
    let mut j = fleet(2);
    j.additional[0].assigned = None;
    j.active.as_mut().unwrap().assigned = Some(job("owner/a", 9));
    let mut demand = (1..=10).map(|id| candidate("owner/a", id, id)).collect();
    filter_reserved(&mut demand, &j);
    let ids: Vec<_> = demand.iter().map(|c| c.job.job_id).collect();
    assert!(ids.contains(&1));
    assert!(!ids.contains(&2));
    assert!(!ids.contains(&9));
}
#[test]
fn restart_preserves_every_owned_attempt_and_rejects_duplicate_ownership() {
    let root = tempfile::tempdir().unwrap();
    std::fs::set_permissions(
        root.path(),
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .unwrap();
    let store = homelab_runner::store::Store::open(root.path()).unwrap();
    let j = fleet(3);
    store.save(&j).unwrap();
    drop(store);
    let store = homelab_runner::store::Store::open(root.path()).unwrap();
    assert_eq!(store.load().unwrap(), j);
    let mut invalid = j.clone();
    invalid.additional.push(invalid.active.clone().unwrap());
    assert!(store.save(&invalid).is_err());
    assert_eq!(store.load().unwrap(), j);
}
#[test]
fn legacy_journal_and_policy_migrate_without_losing_owned_attempt() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    std::fs::set_permissions(
        root.path(),
        std::os::unix::fs::PermissionsExt::from_mode(0o700),
    )
    .unwrap();
    let store = homelab_runner::store::Store::open(root.path()).unwrap();
    let j = fleet(1);
    let mut old = serde_json::to_value(&j).unwrap();
    old["version"] = 1.into();
    old.as_object_mut().unwrap().remove("last_attempt");
    std::fs::write(
        root.path().join("journal.json"),
        serde_json::to_vec(&old).unwrap(),
    )
    .unwrap();
    std::fs::set_permissions(
        root.path().join("journal.json"),
        std::fs::Permissions::from_mode(0o600),
    )
    .unwrap();
    let loaded = store.load().unwrap();
    assert_eq!(loaded.version, JOURNAL_VERSION);
    assert_eq!(loaded.active, j.active);
    let mut old_policy = serde_json::to_value(config()).unwrap();
    old_policy
        .as_object_mut()
        .unwrap()
        .remove("max_concurrent_jobs");
    let cfg: Config = serde_json::from_value(old_policy).unwrap();
    assert_eq!(cfg.max_concurrent_jobs, 1);
    let mut invalid = cfg;
    invalid.max_concurrent_jobs = 0;
    assert!(invalid.validate().is_err());
}

#[derive(Default)]
struct FleetBackendFixture {
    journal_file: std::path::PathBuf,
    vms: std::collections::BTreeMap<String, bool>,
    runners: std::collections::BTreeMap<String, bool>,
    finished: Option<String>,
    effects: Vec<(String, Operation)>,
}
impl homelab_runner::engine::EngineBackend for FleetBackendFixture {
    async fn observe(&mut self, _: &Config, journal: &Journal, _: u64) -> Observation {
        let mut observed = fleet_observation(journal);
        observed.admission_nonce = Some(format!(
            "{:032x}",
            u64::MAX as u128 + journal.sequence as u128
        ));
        for attempt in journal.attempts() {
            let vm = match self.vms.get(&attempt.nonce) {
                Some(true) => VmObservation::Running,
                Some(false) => VmObservation::Stopped,
                None => VmObservation::Absent,
            };
            let runner = match self.runners.get(&attempt.nonce) {
                Some(true) => RunnerObservation::Busy(attempt.candidate.clone()),
                Some(false) => RunnerObservation::Idle,
                None => RunnerObservation::Absent,
            };
            let guest = if self.finished.as_ref() == Some(&attempt.nonce) {
                GuestObservation::Exited
            } else {
                GuestObservation::Ready
            };
            observed.attempts.insert(
                attempt.nonce.clone(),
                Box::new(Observation {
                    vm,
                    runner,
                    guest,
                    free_bytes: Some(10000),
                    ..Observation::default()
                }),
            );
        }
        observed
    }
    async fn execute(&mut self, effect: &Effect) -> Outcome {
        // Production's durable engine must have written this exact attempt's intent first.
        let saved: Journal =
            serde_json::from_slice(&std::fs::read(&self.journal_file).unwrap()).unwrap();
        let attempt = saved
            .attempts()
            .find(|a| a.nonce == effect.attempt.nonce)
            .unwrap();
        assert_eq!(attempt.pending.as_ref().unwrap().ticket, effect.ticket);
        assert_eq!(
            attempt.pending.as_ref().unwrap().operation,
            effect.operation
        );
        self.effects.push((attempt.nonce.clone(), effect.operation));
        let nonce = attempt.nonce.clone();
        match effect.operation {
            Operation::CloneVm => {
                assert!(self.vms.insert(nonce, false).is_none());
            }
            Operation::BootVm => {
                self.vms.insert(nonce, true);
            }
            Operation::CreateJit => {
                assert!(self.runners.insert(nonce, false).is_none());
                return Outcome::Succeeded {
                    runner_id: Some(effect.ticket + 100),
                };
            }
            Operation::StartRunner => {
                self.runners.insert(nonce, true);
            }
            Operation::StopVm => {
                self.vms.insert(nonce, false);
            }
            Operation::DeleteVm => {
                self.vms.remove(&nonce);
            }
            Operation::DeleteRunner => {
                self.runners.remove(&nonce);
            }
            Operation::PrepareGuest => {}
        }
        Outcome::Succeeded { runner_id: None }
    }
}
#[tokio::test]
async fn production_engine_runs_two_jobs_and_cleans_one_without_touching_its_peer() {
    use homelab_runner::{engine::Engine, store::Store};
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let backend = FleetBackendFixture {
        journal_file: directory.path().join("journal.json"),
        ..Default::default()
    };
    let mut engine = Engine::open(Store::open(directory.path()).unwrap(), backend).unwrap();
    let mut cfg = config();
    cfg.max_concurrent_jobs = 2;
    for _ in 0..80 {
        engine.step(&cfg, 200).await.unwrap();
        if engine.journal().attempts().count() == 2
            && engine
                .journal()
                .attempts()
                .all(|a| a.phase == Phase::Running)
        {
            break;
        }
    }
    assert_eq!(
        engine
            .journal()
            .attempts()
            .filter(|a| a.phase == Phase::Running)
            .count(),
        2
    );
    let first = engine.journal().active.as_ref().unwrap().nonce.clone();
    let survivor = engine.journal().additional[0].clone();
    cfg.admission_enabled = false;
    engine.backend.finished = Some(first.clone());
    for _ in 0..40 {
        engine.step(&cfg, 201).await.unwrap();
        if engine.journal().attempts().count() == 1 {
            break;
        }
    }
    assert_eq!(engine.journal().attempts().count(), 1);
    assert_eq!(engine.journal().active.as_ref().unwrap(), &survivor);
    assert!(!engine.backend.vms.contains_key(&first));
    assert!(!engine.backend.runners.contains_key(&first));
    assert!(engine.backend.vms[&survivor.nonce]);
    assert!(
        !engine
            .backend
            .effects
            .iter()
            .any(|(nonce, op)| nonce == &survivor.nonce
                && matches!(
                    op,
                    Operation::StopVm | Operation::DeleteVm | Operation::DeleteRunner
                ))
    );
    // Reopen the real durable store and keep the surviving job's identity/deadline.
    let backend = std::mem::take(&mut engine.backend);
    let saved = engine.journal().clone();
    drop(engine);
    let mut engine = Engine::open(Store::open(directory.path()).unwrap(), backend).unwrap();
    assert_eq!(engine.journal(), &saved);
    engine.step(&cfg, 202).await.unwrap();
    assert_eq!(engine.journal().active.as_ref().unwrap(), &survivor);
    engine.backend.finished = Some(survivor.nonce.clone());
    for _ in 0..40 {
        engine.step(&cfg, 203).await.unwrap();
        if engine.journal().is_idle() {
            break;
        }
    }
    assert!(engine.journal().is_idle());
    assert!(engine.backend.vms.is_empty());
    assert!(engine.backend.runners.is_empty());
}

fn mixed_config() -> Config {
    let mut cfg = config();
    cfg.max_concurrent_jobs = 4;
    cfg.linux = Some(homelab_runner::config::LinuxProfile {
        image: format!("ghcr.io/test/linux@sha256:{}", "b".repeat(64)),
        cpu: 2,
        memory_mib: 4096,
        disk_growth_bytes: 24,
        routing_audit_approved: true,
        runner_archive: "/nix/store/linux-runner.tar.gz".into(),
        runner_version: "2.338.2".into(),
    });
    cfg
}
fn linux_candidate(id: u64) -> Candidate {
    let mut c = candidate("owner/a", id, id);
    c.labels = homelab_runner::config::Platform::LinuxArm64
        .labels()
        .map(String::from)
        .to_vec();
    c
}
fn linux_fleet(count: usize) -> Journal {
    let mut j = fleet(count);
    for a in j.active.iter_mut().chain(j.additional.iter_mut()) {
        a.platform = homelab_runner::config::Platform::LinuxArm64;
        a.linux_profile = mixed_config().linux;
        a.cpu = 2;
        a.memory_mib = 4096;
        a.disk_growth_bytes = 24;
    }
    j
}
fn demand(mut o: Observation, candidates: Vec<Candidate>) -> Observation {
    o.revalidated = candidates.iter().map(|c| c.job.clone()).collect();
    o.candidates = candidates;
    o
}
#[test]
fn fourth_linux_borrows_capacity_but_fifth_never_starts() {
    let cfg = mixed_config();
    let j = linux_fleet(3);
    let o = demand(fleet_observation(&j), vec![linux_candidate(44)]);
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.attempts().count(), 4);
    let a = d.next.additional.last().unwrap();
    assert_eq!(a.platform, homelab_runner::config::Platform::LinuxArm64);
    assert_eq!(a.memory_mib, 4096);
    assert_eq!(a.linux_profile, cfg.linux);
    let mut full = linux_fleet(4);
    full.sequence = 50;
    assert!(
        decide(
            &cfg,
            &full,
            &demand(fleet_observation(&full), vec![linux_candidate(55)]),
            200
        )
        .effect
        .is_none()
    );
}
#[test]
fn operations_guests_share_the_linux_snapshot_and_total_capacity() {
    use homelab_runner::config::Platform;
    let cfg = mixed_config();
    let j = linux_fleet(3);
    let mut candidate = linux_candidate(44);
    candidate.labels = Platform::LinuxOperationsArm64
        .labels()
        .map(String::from)
        .to_vec();
    let decision = decide(
        &cfg,
        &j,
        &demand(fleet_observation(&j), vec![candidate]),
        200,
    );
    assert_eq!(decision.next.attempts().count(), 4);
    let attempt = decision.next.additional.last().unwrap();
    assert_eq!(attempt.platform, Platform::LinuxOperationsArm64);
    assert_eq!(attempt.linux_profile, cfg.linux);
    assert_eq!(attempt.cpu, 2);
    assert_eq!(attempt.memory_mib, 4096);
    assert!(decision.next.validate().is_ok());
    assert!(
        decide(
            &cfg,
            &decision.next,
            &demand(fleet_observation(&decision.next), vec![linux_candidate(55)]),
            201
        )
        .effect
        .is_none()
    );
}

#[test]
fn two_mac_guests_leave_two_linux_slots_and_never_admit_third_mac() {
    let cfg = mixed_config();
    let j = fleet(2);
    let o = demand(
        fleet_observation(&j),
        vec![candidate("owner/a", 33, 1), linux_candidate(44)],
    );
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.attempts().count(), 3);
    assert_eq!(
        d.next.additional.last().unwrap().platform,
        homelab_runner::config::Platform::LinuxArm64
    );
}
#[test]
fn waiting_mac_takes_released_borrowed_capacity_before_replacement_linux() {
    let cfg = mixed_config();
    let j = linux_fleet(3);
    let o = demand(
        fleet_observation(&j),
        vec![linux_candidate(44), candidate("owner/a", 55, 99)],
    );
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(
        d.next.additional.last().unwrap().platform,
        homelab_runner::config::Platform::MacosArm64
    );
}
#[test]
fn mixed_admission_respects_cpu_ram_disk_and_routing_audit() {
    let j = linux_fleet(3);
    let o = demand(fleet_observation(&j), vec![linux_candidate(44)]);
    for resource in ["cpu", "ram", "disk", "audit"] {
        let mut cfg = mixed_config();
        let mut observed = o.clone();
        match resource {
            "cpu" => cfg.cpu_budget = 7,
            "ram" => cfg.memory_budget_mib = 15000,
            "disk" => observed.free_bytes = Some(100),
            "audit" => cfg.linux.as_mut().unwrap().routing_audit_approved = false,
            _ => unreachable!(),
        }
        assert!(
            decide(&cfg, &j, &observed, 200).effect.is_none(),
            "{resource}"
        );
    }
}
#[test]
fn legacy_v2_fleet_migrates_without_losing_pending_peer_or_identity() {
    let mut j = fleet(2);
    j.version = 2;
    j.active.as_mut().unwrap().pending = Some(Intent {
        ticket: 1,
        operation: Operation::StopVm,
    });
    j.additional[0].pending = Some(Intent {
        ticket: 2,
        operation: Operation::StopVm,
    });
    j.sequence = 2;
    let mut value = serde_json::to_value(&j).unwrap();
    for a in std::iter::once(value["active"].as_object_mut().unwrap()) {
        a.remove("platform");
        a.remove("linux_profile");
        a.remove("disk_growth_bytes");
    }
    let mut loaded: Journal = serde_json::from_value(value).unwrap();
    loaded.migrate();
    assert!(loaded.validate().is_ok());
    assert_eq!(loaded.version, homelab_runner::state::JOURNAL_VERSION);
    assert_eq!(loaded.attempts().count(), 2);
    assert_eq!(
        loaded.active.unwrap().platform,
        homelab_runner::config::Platform::MacosArm64
    );
}

#[test]
fn two_mac_plus_two_linux_fit_exactly_and_one_mib_less_blocks_fourth() {
    let mut cfg = mixed_config();
    let mut j = fleet(3);
    let linux = j.additional.last_mut().unwrap();
    linux.platform = homelab_runner::config::Platform::LinuxArm64;
    linux.linux_profile = cfg.linux.clone();
    linux.cpu = 2;
    linux.memory_mib = 4096;
    linux.disk_growth_bytes = 24;
    let o = demand(fleet_observation(&j), vec![linux_candidate(66)]);
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.attempts().count(), 4);
    assert_eq!(d.next.attempts().map(|a| u32::from(a.cpu)).sum::<u32>(), 12);
    assert_eq!(d.next.attempts().map(|a| a.memory_mib).sum::<u32>(), 24576);
    cfg.memory_budget_mib = 24575;
    assert!(decide(&cfg, &j, &o, 200).effect.is_none());
}
#[test]
fn already_starting_mac_attempts_do_not_reserve_linux_capacity_twice() {
    let cfg = mixed_config();
    let mut j = fleet(2);
    for a in j.active.iter_mut().chain(j.additional.iter_mut()) {
        a.phase = Phase::Starting;
        a.assigned = None;
    }
    let o = demand(
        fleet_observation(&j),
        vec![candidate("owner/a", 88, 1), linux_candidate(99)],
    );
    let d = decide(&cfg, &j, &o, 200);
    assert_eq!(d.next.attempts().count(), 3);
    assert_eq!(
        d.next.additional.last().unwrap().platform,
        homelab_runner::config::Platform::LinuxArm64
    );
}

#[test]
fn borrowed_linux_does_not_refill_resources_needed_by_waiting_large_mac() {
    let mut cfg = mixed_config();
    cfg.memory_mib = 16384;
    let j = linux_fleet(3);
    let o = demand(
        fleet_observation(&j),
        vec![linux_candidate(44), candidate("owner/a", 55, 99)],
    );
    // A fourth Linux VM would fit today but would stop the waiting macOS job
    // fitting after one of the three already-borrowed slots is released.
    let d = decide(&cfg, &j, &o, 200);
    assert!(d.effect.is_none());
    assert_eq!(d.next, j);
    let freed = linux_fleet(2);
    let o = demand(
        fleet_observation(&freed),
        vec![linux_candidate(44), candidate("owner/a", 55, 99)],
    );
    let d = decide(&cfg, &freed, &o, 200);
    assert_eq!(
        d.effect.unwrap().attempt.platform,
        homelab_runner::config::Platform::MacosArm64
    );
}

#[test]
fn malformed_linux_runner_versions_are_rejected_before_a_slot_is_owned() {
    for version in ["2..3", ".2.3", "2.3.", "0.1.0", "123456.1.2", "2.3.70000"] {
        let mut cfg = mixed_config();
        cfg.linux.as_mut().unwrap().runner_version = version.into();
        assert!(
            cfg.validate().is_err(),
            "invalid version admitted: {version}"
        );
        let observed = demand(observation(), vec![linux_candidate(44)]);
        assert!(
            decide(&cfg, &Journal::default(), &observed, 200)
                .effect
                .is_none()
        );
    }
}

#[test]
fn admission_diagnostics_identify_disk_reservation_and_required_bytes() {
    let mut observed = observation();
    observed.free_bytes = Some(99);
    let decision = decide(&config(), &Journal::default(), &observed, 100);
    assert!(decision.effect.is_none());
    assert_eq!(decision.reason, "resource reservations block queued demand");
    assert_eq!(decision.capacity[0].required_free_bytes, 100);
    assert_eq!(decision.capacity[0].blockers, vec!["disk_growth_reserved"]);
}
