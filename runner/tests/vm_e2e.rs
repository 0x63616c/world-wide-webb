//! Explicit service-context feasibility gate, never a default test or GitHub job.
//! Root runs the compiled ignored test as the real UID 451 LaunchDaemon. Passing
//! covers this boot's VM/helper lifecycle; cold-boot-before-login, networking,
//! controller recovery and GitHub/JIT acceptance remain separate evidence.
use homelab_runner::{
    guest::GuestPhase,
    keychain,
    service::{RuntimeConfig, unix_now},
    store::Store,
    tart::{OwnedVmName, RunningVm, Tart, VmState},
};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    time::{Instant, timeout},
};

const TOTAL_LIMIT: Duration = Duration::from_secs(20 * 60);
const EVIDENCE_LIMIT: usize = 16 * 1024;

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum Stage {
    HostObservation,
    Keychain,
    ToolPreflight,
    Inventory,
    Clone,
    Boot,
    PrepareGuest,
    GuestReady,
    Stop,
    Delete,
    LeaseCleanup,
    Complete,
}
impl Stage {
    fn label(self) -> &'static str {
        match self {
            Self::HostObservation => "host_observation",
            Self::Keychain => "keychain",
            Self::ToolPreflight => "tool_preflight",
            Self::Inventory => "inventory",
            Self::Clone => "clone",
            Self::Boot => "boot",
            Self::PrepareGuest => "prepare_guest",
            Self::GuestReady => "guest_ready",
            Self::Stop => "stop",
            Self::Delete => "delete",
            Self::LeaseCleanup => "lease_cleanup",
            Self::Complete => "complete",
        }
    }
}
#[derive(Serialize)]
struct StageEvidence {
    stage: Stage,
    started_at: u64,
    completed_at: Option<u64>,
}
#[derive(Serialize)]
struct Evidence {
    schema: u8,
    proof_scope: &'static str,
    uid: u32,
    started_at: u64,
    finished_at: Option<u64>,
    boot_uuid: Option<String>,
    /// Current `who` console observation only; does not establish login history.
    host_gui_observed: Option<bool>,
    nonce: String,
    vm_name: String,
    image: String,
    tart_binary: PathBuf,
    guest_helper: PathBuf,
    boot_deadline: Option<u64>,
    boot_lease_held: bool,
    boot_lease_released: bool,
    stages: Vec<StageEvidence>,
    passed: bool,
    failure_category: Option<&'static str>,
}
struct Proof {
    file: PathBuf,
    evidence: Evidence,
}
impl Proof {
    fn create(runtime: &RuntimeConfig, name: &OwnedVmName) -> Result<Self, &'static str> {
        let file = runtime.state_directory.join("vm-proof.json");
        let proof = Self {
            file,
            evidence: Evidence {
                schema: 1,
                proof_scope: "service_account_stock_vm_public_helper_lifecycle_no_job",
                uid: rustix::process::geteuid().as_raw(),
                started_at: unix_now(),
                finished_at: None,
                boot_uuid: None,
                host_gui_observed: None,
                nonce: name.attempt_id().into(),
                vm_name: name.as_str().into(),
                image: runtime.policy.image.clone(),
                tart_binary: runtime.tart.binary.clone(),
                guest_helper: runtime.tart.guest_helper.clone(),
                boot_deadline: None,
                boot_lease_held: false,
                boot_lease_released: false,
                stages: Vec::new(),
                passed: false,
                failure_category: None,
            },
        };
        // Preserve a previous failure's exact VM identity. Archive/review evidence
        // explicitly before another run; an uncertain proof is never overwritten.
        proof.save(true)?;
        Ok(proof)
    }
    fn save(&self, first: bool) -> Result<(), &'static str> {
        let directory = self.file.parent().ok_or("evidence_directory")?;
        private_directory(directory)?;
        if !first {
            let metadata = fs::symlink_metadata(&self.file).map_err(|_| "evidence_missing")?;
            if !metadata.is_file()
                || metadata.uid() != 451
                || metadata.nlink() != 1
                || metadata.mode() & 0o7777 != 0o600
            {
                return Err("evidence_permissions");
            }
        }
        let bytes = serde_json::to_vec_pretty(&self.evidence).map_err(|_| "evidence_encoding")?;
        if bytes.len() > EVIDENCE_LIMIT {
            return Err("evidence_limit");
        }
        let mut pending =
            tempfile::NamedTempFile::new_in(directory).map_err(|_| "evidence_create")?;
        pending
            .as_file()
            .set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| "evidence_permissions")?;
        pending.write_all(&bytes).map_err(|_| "evidence_write")?;
        pending.as_file().sync_all().map_err(|_| "evidence_sync")?;
        if first {
            pending
                .persist_noclobber(&self.file)
                .map_err(|_| "evidence_exists_or_publish_failed")?;
        } else {
            pending
                .persist(&self.file)
                .map_err(|_| "evidence_publish")?;
        }
        File::open(directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| "evidence_directory_sync")
    }
    fn begin(&mut self, stage: Stage) -> Result<(), &'static str> {
        if self.evidence.stages.len() >= 16 {
            return Err("stage_limit");
        }
        self.evidence.stages.push(StageEvidence {
            stage,
            started_at: unix_now(),
            completed_at: None,
        });
        self.save(false)?;
        println!("vm-proof: {}", stage.label());
        Ok(())
    }
    fn complete(&mut self) -> Result<(), &'static str> {
        self.evidence
            .stages
            .last_mut()
            .ok_or("stage_missing")?
            .completed_at = Some(unix_now());
        self.save(false)
    }
}

fn private_directory(path: &Path) -> Result<(), &'static str> {
    let metadata = fs::symlink_metadata(path).map_err(|_| "state_directory_missing")?;
    if !metadata.is_dir() || metadata.uid() != 451 || metadata.mode() & 0o7777 != 0o700 {
        return Err("state_directory_permissions");
    }
    Ok(())
}

fn load_config(path: &Path) -> Result<RuntimeConfig, &'static str> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(path)
        .map_err(|_| "config_open")?;
    let metadata = file.metadata().map_err(|_| "config_metadata")?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.uid() != 0
        || metadata.mode() & 0o022 != 0
    {
        return Err("config_not_root_owned_metadata");
    }
    // A writable parent could replace even a root-owned filename between reads.
    let canonical = fs::canonicalize(path).map_err(|_| "config_path")?;
    for directory in canonical.parent().ok_or("config_path")?.ancestors() {
        let metadata = fs::symlink_metadata(directory).map_err(|_| "config_parent")?;
        if !metadata.is_dir() || metadata.uid() != 0 || metadata.mode() & 0o022 != 0 {
            return Err("config_parent_permissions");
        }
    }
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "config_read")?;
    if bytes.len() > 1024 * 1024 {
        return Err("config_limit");
    }
    let config: RuntimeConfig = serde_json::from_slice(&bytes).map_err(|_| "config_schema")?;
    config.validate().map_err(|_| "config_policy")?;
    if config.policy.admission_enabled
        || !config.policy.repositories.is_empty()
        || config.keychain.is_none()
    {
        return Err("proof_requires_disabled_empty_repository_policy_and_explicit_keychain");
    }
    if std::env::var_os("HOME").as_deref() != Some(config.tart.home.as_os_str()) {
        return Err("service_home_mismatch");
    }
    let keychain = config.keychain.as_ref().ok_or("keychain_missing")?;
    if keychain.service_uid != 451 || keychain.service_home != config.tart.home {
        return Err("keychain_service_identity");
    }
    Ok(config)
}

/// Fixed native observations, bounded in memory. Usernames/output never enter
/// the evidence or console; only a validated boot UUID and console boolean do.
async fn host_observation(
    program: &str,
    args: &[&str],
    limit: u64,
) -> Result<Vec<u8>, &'static str> {
    let mut child = Command::new(program)
        .args(args)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| "host_observation_spawn")?;
    let result = timeout(Duration::from_secs(10), async {
        let stdout = child.stdout.take().ok_or("host_observation_pipe")?;
        let mut bytes = Vec::new();
        stdout
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .await
            .map_err(|_| "host_observation_read")?;
        if bytes.len() as u64 > limit {
            return Err("host_observation_limit");
        }
        let status = child.wait().await.map_err(|_| "host_observation_wait")?;
        if !status.success() {
            return Err("host_observation_status");
        }
        Ok(bytes)
    })
    .await;
    match result {
        Ok(Ok(bytes)) => Ok(bytes),
        other => {
            let _ = timeout(Duration::from_secs(5), child.kill()).await;
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
            other.unwrap_or(Err("host_observation_timeout"))
        }
    }
}

async fn lifecycle(
    runtime: &RuntimeConfig,
    tart: &Tart,
    name: &OwnedVmName,
    proof: &mut Proof,
    running: &mut Option<RunningVm>,
) -> Result<(), &'static str> {
    proof.begin(Stage::HostObservation)?;
    let boot = host_observation("/usr/sbin/sysctl", &["-n", "kern.bootsessionuuid"], 128).await?;
    let boot = std::str::from_utf8(&boot).map_err(|_| "boot_uuid_encoding")?;
    proof.evidence.boot_uuid = Some(
        uuid::Uuid::parse_str(boot.trim())
            .map_err(|_| "boot_uuid_invalid")?
            .to_string(),
    );
    let who = host_observation("/usr/bin/who", &[], 32 * 1024).await?;
    let who = std::str::from_utf8(&who).map_err(|_| "console_observation_encoding")?;
    proof.evidence.host_gui_observed = Some(
        who.lines()
            .any(|line| line.split_whitespace().nth(1) == Some("console")),
    );
    proof.complete()?;

    proof.begin(Stage::Keychain)?;
    let keychain = keychain::prepare(runtime.keychain.as_ref().ok_or("keychain_missing")?)
        .await
        .map_err(|error| {
            // This typed error contains native status/OS errors, never the password.
            eprintln!("vm-proof: keychain: {error}");
            "keychain_failed"
        })?;
    if !keychain.login_selected {
        return Err("keychain_login_not_selected");
    }
    proof.complete()?;
    proof.begin(Stage::ToolPreflight)?;
    tart.verify_helper()
        .map_err(|_| "tool_helper_preflight_failed")?;
    tart.verify_version()
        .await
        .map_err(|_| "tool_version_preflight_failed")?;
    proof.complete()?;
    proof.begin(Stage::Inventory)?;
    let inventory = tart
        .inventory()
        .await
        .map_err(|_| "initial_inventory_failed")?;
    if inventory
        .iter()
        .any(|vm| vm.running || vm.name.starts_with("homelab-job-"))
    {
        return Err("existing_running_or_owned_vm");
    }
    let storage =
        rustix::fs::statvfs(&runtime.tart.tart_home).map_err(|_| "storage_observation_failed")?;
    if storage.f_bavail.saturating_mul(storage.f_frsize) < runtime.policy.admission_free_bytes {
        return Err("storage_below_configured_admission_reserve");
    }
    proof.complete()?;

    proof.begin(Stage::Clone)?;
    tart.clone_vm(
        &runtime.policy.image,
        name,
        runtime.policy.cpu,
        runtime.policy.memory_mib,
    )
    .await
    .map_err(|_| "clone_failed_preserve_for_inspection")?;
    proof.complete()?;
    proof.begin(Stage::Boot)?;
    let boot_limit = Duration::from_secs(runtime.policy.deadlines.boot_seconds).min(TOTAL_LIMIT);
    let boot_end = Instant::now() + boot_limit;
    proof.evidence.boot_deadline = Some(unix_now().saturating_add(boot_limit.as_secs()));
    proof.save(false)?;
    *running = Some(tart.boot(name).map_err(|_| "boot_spawn_failed")?);
    if tart
        .operation_finished(name)
        .map_err(|_| "boot_lease_observation_failed")?
    {
        return Err("boot_lease_not_held");
    }
    proof.evidence.boot_lease_held = true;
    proof.save(false)?;
    loop {
        if running
            .as_mut()
            .ok_or("boot_handle_missing")?
            .exited()
            .map_err(|_| "boot_process_observation_failed")?
        {
            return Err("boot_process_exited");
        }
        // Inventory capacity reads contend with ASIF's exclusive startup lock.
        if tart.guest_agent_ready(name).await.unwrap_or(false) {
            break;
        }
        let remaining = boot_end.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("boot_deadline");
        }
        tokio::time::sleep(remaining.min(Duration::from_secs(2))).await;
    }
    proof.complete()?;
    proof.begin(Stage::PrepareGuest)?;
    let remaining = boot_end.saturating_duration_since(Instant::now());
    if remaining.is_zero() {
        return Err("boot_deadline_before_guest_preparation");
    }
    tart.prepare_guest(name, remaining)
        .await
        .map_err(|_| "public_guest_preparation_failed")?;
    proof.complete()?;
    proof.begin(Stage::GuestReady)?;
    let remaining = boot_end.saturating_duration_since(Instant::now());
    let status = timeout(remaining, tart.guest_status(name))
        .await
        .map_err(|_| "guest_readiness_deadline")?
        .map_err(|_| "guest_status_failed")?;
    if status.phase != GuestPhase::Ready || status.attempt_id.is_some() {
        return Err("guest_not_unclaimed_ready");
    }
    proof.complete()?;

    proof.begin(Stage::Stop)?;
    if tart
        .operation_finished(name)
        .map_err(|_| "running_lease_observation_failed")?
    {
        return Err("running_lease_not_held");
    }
    if running
        .as_mut()
        .ok_or("boot_handle_missing")?
        .exited()
        .map_err(|_| "pre_stop_process_observation_failed")?
        || !tart
            .inventory()
            .await
            .map_err(|_| "pre_stop_inventory_failed")?
            .iter()
            .any(|vm| vm.name == name.as_str() && vm.state == VmState::Running)
    {
        return Err("vm_exited_before_stop_proof");
    }
    tart.stop(name)
        .await
        .map_err(|_| "stop_failed_preserve_for_inspection")?;
    let exit_deadline = Instant::now() + Duration::from_secs(10);
    while !running
        .as_mut()
        .ok_or("boot_handle_missing")?
        .exited()
        .map_err(|_| "stop_process_observation_failed")?
    {
        if Instant::now() >= exit_deadline {
            return Err("stop_process_still_present");
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if !tart
        .operation_finished(name)
        .map_err(|_| "stopped_lease_observation_failed")?
    {
        return Err("boot_lease_still_held_after_exit");
    }
    proof.evidence.boot_lease_released = true;
    proof.complete()?;
    proof.begin(Stage::Delete)?;
    tart.delete(name)
        .await
        .map_err(|_| "delete_failed_preserve_for_inspection")?;
    if tart
        .inventory()
        .await
        .map_err(|_| "final_inventory_failed")?
        .iter()
        .any(|vm| vm.name == name.as_str())
    {
        return Err("owned_vm_still_present");
    }
    proof.complete()?;
    proof.begin(Stage::LeaseCleanup)?;
    tart.cleanup_clone_operation(name)
        .await
        .map_err(|_| "clone_lease_cleanup_failed")?;
    match fs::symlink_metadata(
        runtime
            .tart
            .tart_home
            .join(format!(".{}.clone.lock", name.as_str())),
    ) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        _ => return Err("clone_lease_still_present_or_unknown"),
    }
    proof.complete()?;
    proof.begin(Stage::Complete)?;
    proof.evidence.passed = true;
    proof.evidence.finished_at = Some(unix_now());
    proof.complete()
}

#[tokio::test]
#[ignore = "explicit VM mutation: run only as UID451 system LaunchDaemon with HOMELAB_RUNNER_VM_CONFIG"]
async fn launchdaemon_stock_vm_lifecycle() {
    let configuration = std::env::var_os("HOMELAB_RUNNER_VM_CONFIG")
        .expect("set HOMELAB_RUNNER_VM_CONFIG to reviewed root-owned metadata");
    // Keep this a runtime guard: Linux CI must compile and skip the ignored test.
    let actual_os = std::env::consts::OS.to_owned();
    assert_eq!(actual_os, "macos", "VM proof requires macOS");
    assert_eq!(
        rustix::process::geteuid().as_raw(),
        451,
        "VM proof requires the actual UID451 LaunchDaemon"
    );
    let runtime =
        load_config(Path::new(&configuration)).expect("unsafe or invalid proof configuration");
    let store = Store::open(&runtime.state_directory)
        .expect("state directory or exclusive controller lock unavailable");
    assert!(
        store
            .load()
            .expect("journal invalid; preserve it")
            .active
            .is_none(),
        "an active controller attempt must finish before proof"
    );
    private_directory(&runtime.tart.tart_home)
        .expect("TART_HOME must be service-owned and private");
    let name = OwnedVmName::parse(&format!("homelab-job-{}", uuid::Uuid::new_v4().simple()))
        .expect("generated exact owned name");
    let tart = Tart::new(runtime.tart.clone()).expect("invalid Tart configuration");
    let mut proof = Proof::create(&runtime, &name)
        .expect("preserve existing evidence or repair private evidence directory");
    let mut running = None;
    let result = match timeout(
        TOTAL_LIMIT,
        lifecycle(&runtime, &tart, &name, &mut proof, &mut running),
    )
    .await
    {
        Ok(result) => result,
        Err(_) => Err("total_twenty_minute_deadline"),
    };
    if let Err(category) = result {
        proof.evidence.passed = false;
        proof.evidence.failure_category = Some(category);
        proof.evidence.finished_at = Some(unix_now());
        if proof.save(false).is_err() {
            eprintln!("vm-proof: failed to commit failure evidence; preserve previous evidence");
        }
        let stage = proof
            .evidence
            .stages
            .last()
            .map_or("preflight", |event| event.stage.label());
        panic!(
            "vm-proof failed at {stage}: {category}; exact VM/evidence preserved for inspection"
        );
    }
    println!(
        "vm-proof: passed service-account VM/helper lifecycle; no GitHub job or cold-boot claim"
    );
}

#[tokio::test]
#[ignore = "explicit pre-JIT boot-only retry of the exact stopped VM in private vm-proof.json; no clone or deletion"]
async fn launchdaemon_existing_vm_boot_diagnostic() {
    assert_eq!(std::env::consts::OS, "macos");
    assert_eq!(rustix::process::geteuid().as_raw(), 451);
    let configuration =
        std::env::var_os("HOMELAB_RUNNER_VM_CONFIG").expect("set reviewed proof configuration");
    let runtime = load_config(Path::new(&configuration)).expect("unsafe proof configuration");
    assert_eq!(
        fs::canonicalize(std::env::current_dir().unwrap()).unwrap(),
        fs::canonicalize(&runtime.tart.home).unwrap(),
        "probe LaunchDaemon must use the production service working directory"
    );
    let store = Store::open(&runtime.state_directory).expect("exclusive controller lock");
    assert!(store.load().expect("valid journal").active.is_none());
    private_directory(&runtime.state_directory).expect("private proof directory");
    let file = OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(runtime.state_directory.join("vm-proof.json"))
        .expect("existing exact proof");
    let metadata = file.metadata().unwrap();
    assert!(
        metadata.is_file()
            && metadata.uid() == 451
            && metadata.nlink() == 1
            && metadata.mode() & 0o7777 == 0o600
            && metadata.len() <= EVIDENCE_LIMIT as u64
    );
    let mut bytes = Vec::new();
    file.take(EVIDENCE_LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .unwrap();
    assert!(bytes.len() <= EVIDENCE_LIMIT);
    let proof: serde_json::Value = serde_json::from_slice(&bytes).expect("valid existing evidence");
    assert_eq!(
        proof["failure_category"].as_str(),
        Some("boot_process_exited")
    );
    let name = OwnedVmName::parse(proof["vm_name"].as_str().expect("exact recorded VM")).unwrap();
    assert_eq!(proof["nonce"].as_str(), Some(name.attempt_id()));
    assert_eq!(proof["image"].as_str(), Some(runtime.policy.image.as_str()));
    keychain::prepare(runtime.keychain.as_ref().unwrap())
        .await
        .expect("dedicated keychain prepared");
    let tart = Tart::new(runtime.tart.clone()).unwrap();
    let inventory = tart.inventory().await.expect("fresh inventory");
    assert!(
        !inventory.iter().any(|vm| vm.running),
        "another VM is already running"
    );
    assert!(
        inventory
            .iter()
            .any(|vm| vm.name == name.as_str() && vm.state == VmState::Stopped),
        "recorded VM must exist stopped"
    );
    let diagnostic = runtime.state_directory.join(format!(
        "vm-boot-stderr-{}.log",
        uuid::Uuid::new_v4().simple()
    ));
    let mut running = tart
        .boot_with_startup_diagnostics(&name, &diagnostic)
        .expect("diagnostic boot spawn");
    println!(
        "vm-boot-probe: bounded private stderr file={}",
        diagnostic.display()
    );
    let end = Instant::now()
        + Duration::from_secs(runtime.policy.deadlines.boot_seconds).min(TOTAL_LIMIT);
    // Tart inventory opens ASIF disks for capacity reads and can race the
    // framework's exclusive boot lock. Probe the guest agent directly instead.
    {
        let preparation = tart.prepare_guest(&name, end.saturating_duration_since(Instant::now()));
        tokio::pin!(preparation);
        loop {
            tokio::select! {
                result=&mut preparation=>{result.expect("public helper preparation failed; private native diagnostic preserved");break;}
                _=tokio::time::sleep(Duration::from_millis(100))=>{
                    if let Some(result)=running.exit_diagnostic().expect("typed native status") {
                        panic!("vm-boot-probe: native process exited during guest preparation: {}",serde_json::to_string(&result).unwrap());
                    }
                }
            }
        }
    }
    let status = tart.guest_status(&name).await.expect("safe guest status");
    assert_eq!(status.phase, GuestPhase::Ready);
    assert!(status.attempt_id.is_none());
    println!(
        "vm-boot-probe: guest_ready vm={}; waiting for primary agent to stop exact VM; no JIT or automatic cleanup",
        name.as_str()
    );
    let stop_end = Instant::now() + Duration::from_secs(600);
    loop {
        if let Some(result) = running.exit_diagnostic().expect("typed native status") {
            println!(
                "vm-boot-probe: after verified guest_ready: {}",
                serde_json::to_string(&result).unwrap()
            );
            assert!(
                !tart
                    .inventory()
                    .await
                    .expect("post-stop inventory")
                    .iter()
                    .any(|vm| vm.name == name.as_str() && vm.running)
            );
            return;
        }
        assert!(
            Instant::now() < stop_end,
            "vm-boot-probe: guest_ready observed but explicit stop not observed; VM/evidence preserved"
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
