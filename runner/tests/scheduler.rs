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
        admission_enabled: true,
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
    assert_eq!(d.next.retry_after, 145);
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
