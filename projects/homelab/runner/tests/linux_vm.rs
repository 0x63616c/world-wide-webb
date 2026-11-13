//! Explicit native Linux guest component gate. This never contacts GitHub or
//! clones/deletes VMs. The operator supplies an already-running disposable clone
//! in the separate linux-validation inventory, owned by a UID451 LaunchDaemon.
use homelab_runner::{
    config::{LinuxProfile, Platform, RepositoryConfig},
    guest::GuestPhase,
    state::{Attempt, JobIdentity, Phase},
    tart::{OwnedVmName, Tart, TartConfig, TartError},
};
use serde::Deserialize;
use std::{fs, os::unix::fs::MetadataExt, path::PathBuf, time::Duration};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofConfig {
    tart: TartConfig,
    linux: LinuxProfile,
    vm_name: OwnedVmName,
    evidence: PathBuf,
}

#[tokio::test]
#[ignore = "native mutation: UID451 LaunchDaemon and an already-running isolated Linux fixture; no GitHub credentials"]
async fn linux_preparation_and_one_shot_transport() {
    assert_eq!(rustix::process::geteuid().as_raw(), 451);
    let path = std::env::var_os("HOMELAB_LINUX_COMPONENT_CONFIG").expect("explicit proof config");
    let config: ProofConfig = serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
    assert_eq!(
        config.tart.tart_home,
        PathBuf::from("/var/lib/_runner/linux-validation")
    );
    assert_eq!(fs::metadata(&config.tart.tart_home).unwrap().uid(), 451);
    assert!(!config.evidence.exists(), "never overwrite prior proof");
    assert!(config.evidence.starts_with(&config.tart.tart_home));
    let nonce = config.vm_name.attempt_id().to_owned();
    let attempt = Attempt {
        nonce,
        vm_name: config.vm_name.as_str().to_owned(),
        runner_name: config.vm_name.as_str().to_owned(),
        repository: RepositoryConfig {
            owner: "fixture".into(),
            name: "linux".into(),
            repository_id: 1,
            installation_id: 1,
            runner_group_id: 1,
            trust_approved: true,
        },
        platform: Platform::LinuxArm64,
        disk_growth_bytes: config.linux.disk_growth_bytes,
        image: config.linux.image.clone(),
        cpu: config.linux.cpu,
        memory_mib: config.linux.memory_mib,
        linux_profile: Some(config.linux),
        candidate: JobIdentity {
            repository: "fixture/linux".into(),
            run_id: 1,
            run_attempt: 1,
            job_id: 1,
        },
        assigned: None,
        phase: Phase::Starting,
        boot_deadline: 0,
        unassigned_deadline: None,
        running_deadline: None,
        running_seconds: 120,
        unassigned_seconds: 30,
        vm_created: true,
        vm_booted: true,
        boot_lease_version: 1,
        guest_prepared: false,
        jit_created: false,
        runner_started: false,
        runner_id: None,
        pending: None,
    };
    let tart = Tart::new(config.tart)
        .unwrap()
        .for_attempt(&attempt)
        .unwrap();
    tart.verify_version().await.unwrap();
    tart.prepare_guest(&config.vm_name, Duration::from_secs(180))
        .await
        .unwrap();
    assert_eq!(
        tart.guest_status(&config.vm_name).await.unwrap().phase,
        GuestPhase::Ready
    );
    assert!(tart.guest_agent_ready(&config.vm_name).await.unwrap());
    // Lost preparation responses may be retried only while the guest is unclaimed.
    tart.prepare_guest(&config.vm_name, Duration::from_secs(30))
        .await
        .unwrap();
    // Not a credential: the official listener must reject this synthetic payload.
    // Its exit still proves the Linux helper's one-shot transport and supervision.
    tart.bootstrap(&config.vm_name, b"LINUX_COMPONENT_INVALID_JIT")
        .await
        .unwrap();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    let terminal = loop {
        let status = tart.guest_status(&config.vm_name).await.unwrap();
        if matches!(status.phase, GuestPhase::Exited | GuestPhase::Failed) {
            break status;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "listener did not terminate"
        );
        tokio::time::sleep(Duration::from_secs(1)).await;
    };
    assert_eq!(
        terminal.phase,
        GuestPhase::Exited,
        "the official listener must actually start"
    );
    // The pinned run.sh wrapper can mask a listener failure with exit zero.
    // This is a wrapper observation, never a claim about a GitHub job result.
    assert!(terminal.exit_code.is_some());
    assert!(
        tart.bootstrap(&config.vm_name, b"SECOND_INVALID_JIT")
            .await
            .is_err()
    );
    assert!(matches!(
        tart.prepare_guest(&config.vm_name, Duration::from_secs(10))
            .await,
        Err(TartError::GuestAlreadyClaimed)
    ));
    let proof = serde_json::json!({
        "schema": 1, "vm": config.vm_name.as_str(), "platform": "linux-arm64",
        "preparation": "ready", "repeat_unclaimed_preparation": "ready",
        "synthetic_wrapper_exit": terminal, "second_submission": "rejected",
        "claimed_preparation": "rejected", "github_job_execution": "not exercised"
    });
    use std::io::Write;
    let mut output = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&config.evidence)
        .unwrap();
    output
        .write_all(&serde_json::to_vec_pretty(&proof).unwrap())
        .unwrap();
    output.sync_all().unwrap();
}
