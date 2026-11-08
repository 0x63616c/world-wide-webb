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
    net::{Ipv4Addr, Ipv6Addr},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt},
    process::{Child, Command},
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

// Test-local transport only: production keeps its fixed Softnet policy. Raw
// native output is bounded and interpreted here, never included in evidence.
struct NetworkOutput {
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}
async fn network_bytes(mut stream: impl AsyncRead + Unpin) -> std::io::Result<(Vec<u8>, bool)> {
    let mut bytes = Vec::new();
    let mut exceeded = false;
    let mut chunk = [0; 1024];
    loop {
        let n = stream.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        let keep = n.min(8192usize.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&chunk[..keep]);
        exceeded |= keep < n;
    }
    Ok((bytes, exceeded))
}
async fn network_command(mut command: Command) -> Result<NetworkOutput, &'static str> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command.spawn().map_err(|_| "network_command_spawn")?;
    let mut out = tokio::spawn(network_bytes(child.stdout.take().ok_or("network_stdout")?));
    let mut err = tokio::spawn(network_bytes(child.stderr.take().ok_or("network_stderr")?));
    let status = match timeout(Duration::from_secs(12), child.wait()).await {
        Ok(Ok(status)) => status,
        _ => {
            let _ = child.start_kill();
            let _ = timeout(Duration::from_secs(5), child.wait()).await;
            out.abort();
            err.abort();
            return Err("network_command_wait");
        }
    };
    let result = timeout(Duration::from_secs(2), async {
        tokio::join!(&mut out, &mut err)
    })
    .await;
    let (out_result, err_result) = match result {
        Ok(value) => value,
        Err(_) => {
            out.abort();
            err.abort();
            return Err("network_command_pipe_deadline");
        }
    };
    let (stdout, out_large) = out_result
        .map_err(|_| "network_stdout_task")?
        .map_err(|_| "network_stdout_read")?;
    let (stderr, err_large) = err_result
        .map_err(|_| "network_stderr_task")?
        .map_err(|_| "network_stderr_read")?;
    if out_large || err_large {
        return Err("network_output_limit");
    }
    Ok(NetworkOutput {
        code: status.code(),
        stdout,
        stderr,
    })
}
fn network_tart_command(runtime: &RuntimeConfig, args: &[&str]) -> Command {
    let mut command = Command::new(&runtime.tart.binary);
    command
        .args(args)
        .env_clear()
        .env("HOME", &runtime.tart.home)
        .env("TART_HOME", &runtime.tart.tart_home)
        .env(
            "PATH",
            format!(
                "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                runtime.tart.helper_directory.display()
            ),
        )
        .env("TART_NO_AUTO_PRUNE", "1");
    command
}
async fn network_exec(
    runtime: &RuntimeConfig,
    name: &OwnedVmName,
    args: &[&str],
) -> Result<NetworkOutput, &'static str> {
    let mut command = network_tart_command(runtime, &["exec", name.as_str()]);
    command.args(args);
    network_command(command).await
}
fn network_control_boot(
    runtime: &RuntimeConfig,
    name: &OwnedVmName,
) -> Result<Child, &'static str> {
    network_tart_command(
        runtime,
        &[
            "run",
            "--no-graphics",
            "--no-clipboard",
            "--no-audio",
            "--no-usb-accessories",
            "--net-softnet",
            "--net-softnet-allow=0.0.0.0/0",
            name.as_str(),
        ],
    )
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .kill_on_drop(true)
    .spawn()
    .map_err(|_| "network_control_boot_spawn")
}
async fn network_reap(child: &mut Child) -> Result<(), &'static str> {
    if child
        .try_wait()
        .map_err(|_| "network_owner_poll")?
        .is_some()
    {
        return Ok(());
    }
    let _ = child.start_kill();
    timeout(Duration::from_secs(10), child.wait())
        .await
        .map_err(|_| "network_owner_reap_deadline")?
        .map_err(|_| "network_owner_reap")?;
    Ok(())
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum TcpObservation {
    Connected,
    TimedOut,
    Refused,
    Unreachable,
    Prohibited,
}
fn tcp_observation(output: &NetworkOutput, address: &str) -> Result<TcpObservation, &'static str> {
    if output.code == Some(0) {
        return Ok(TcpObservation::Connected);
    }
    // A Tart RPC error, signal, missing nc, or unknown native failure must never
    // count as a blocked connection. Require nc's exact destination projection.
    if output.code != Some(1) || !output.stdout.is_empty() {
        return Err("tcp_probe_transport_or_status");
    }
    let stderr = std::str::from_utf8(&output.stderr).map_err(|_| "tcp_probe_encoding")?;
    let prefix = format!("nc: connectx to {address} port 22 (tcp) failed: ");
    for line in stderr.lines() {
        if let Some(reason) = line.strip_prefix(&prefix) {
            return match reason {
                "Operation timed out" => Ok(TcpObservation::TimedOut),
                "Connection refused" => Ok(TcpObservation::Refused),
                "No route to host" | "Network is unreachable" => Ok(TcpObservation::Unreachable),
                "Operation not permitted" | "Permission denied" => Ok(TcpObservation::Prohibited),
                _ => Err("tcp_probe_unrecognized_native_failure"),
            };
        }
    }
    Err("tcp_probe_unrecognized_native_failure")
}
async fn guest_tcp(
    runtime: &RuntimeConfig,
    name: &OwnedVmName,
    address: &str,
    ipv6: bool,
) -> Result<TcpObservation, &'static str> {
    let output = network_exec(
        runtime,
        name,
        &[
            "/usr/bin/nc",
            if ipv6 { "-6" } else { "-4" },
            "-n",
            "-v",
            "-z",
            "-G",
            "3",
            "-w",
            "3",
            address,
            "22",
        ],
    )
    .await?;
    tcp_observation(&output, address)
}
async fn host_tcp(address: &str) -> Result<TcpObservation, &'static str> {
    let mut command = Command::new("/usr/bin/nc");
    command
        .args(["-4", "-n", "-v", "-z", "-G", "3", "-w", "3", address, "22"])
        .env_clear()
        .env("PATH", "/usr/bin:/bin");
    tcp_observation(&network_command(command).await?, address)
}
#[derive(Serialize)]
struct PeerCheck {
    name: &'static str,
    expected: &'static str,
    observation: TcpObservation,
}
#[derive(Serialize)]
struct PeerEvidence {
    schema: u8,
    scope: &'static str,
    started_at: u64,
    finished_at: Option<u64>,
    stage: &'static str,
    image: String,
    tart_binary: PathBuf,
    softnet_directory: PathBuf,
    control_policy: &'static str,
    production_client_arguments: Vec<String>,
    client: String,
    target: String,
    client_memory_mib: u32,
    target_memory_mib: u32,
    target_pid: Option<u32>,
    control_client_pid: Option<u32>,
    production_client_pid: Option<u32>,
    target_ipv4: Option<String>,
    target_netmask: Option<String>,
    open_client_ipv4: Option<String>,
    open_client_netmask: Option<String>,
    production_client_ipv4: Option<String>,
    production_client_netmask: Option<String>,
    topology: &'static str,
    topology_source: &'static str,
    policy_causality_proven: bool,
    production_client_public_https: bool,
    peer_ipv6: Option<String>,
    checks: Vec<PeerCheck>,
    public_ipv6_black_box_proven: bool,
    ipv6_scope: &'static str,
    cleanup_client: bool,
    cleanup_target: bool,
    passed: bool,
    failure: Option<&'static str>,
}
fn save_peer_evidence(
    path: &Path,
    evidence: &PeerEvidence,
    first: bool,
) -> Result<(), &'static str> {
    let directory = path.parent().ok_or("peer_evidence_directory")?;
    private_directory(directory)?;
    let bytes = serde_json::to_vec_pretty(evidence).map_err(|_| "peer_evidence_encoding")?;
    if bytes.len() > EVIDENCE_LIMIT {
        return Err("peer_evidence_bound");
    }
    if !first {
        let metadata = fs::symlink_metadata(path).map_err(|_| "peer_evidence_missing")?;
        if !metadata.is_file()
            || metadata.uid() != 451
            || metadata.nlink() != 1
            || metadata.mode() & 0o7777 != 0o600
        {
            return Err("peer_evidence_permissions");
        }
    }
    let mut pending =
        tempfile::NamedTempFile::new_in(directory).map_err(|_| "peer_evidence_create")?;
    pending
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .map_err(|_| "peer_evidence_permissions")?;
    pending
        .write_all(&bytes)
        .map_err(|_| "peer_evidence_write")?;
    pending
        .as_file()
        .sync_all()
        .map_err(|_| "peer_evidence_sync")?;
    if first {
        pending
            .persist_noclobber(path)
            .map_err(|_| "peer_evidence_publish")?;
    } else {
        pending.persist(path).map_err(|_| "peer_evidence_publish")?;
    }
    File::open(directory)
        .and_then(|f| f.sync_all())
        .map_err(|_| "peer_evidence_directory_sync")
}
fn peer_check(
    evidence: &mut PeerEvidence,
    name: &'static str,
    expected: &'static str,
    observation: TcpObservation,
) -> Result<(), &'static str> {
    if evidence.checks.len() >= 20 {
        return Err("peer_check_bound");
    }
    evidence.checks.push(PeerCheck {
        name,
        expected,
        observation,
    });
    if expected != "observed_only"
        && (expected == "connected") != (observation == TcpObservation::Connected)
    {
        return Err(name);
    }
    Ok(())
}
async fn peer_ipv4_configuration(
    runtime: &RuntimeConfig,
    name: &OwnedVmName,
) -> Result<(Ipv4Addr, Ipv4Addr), &'static str> {
    let mut values = Vec::new();
    for arguments in [
        vec!["/usr/sbin/ipconfig", "getifaddr", "en0"],
        vec!["/usr/sbin/ipconfig", "getoption", "en0", "subnet_mask"],
    ] {
        let output = network_exec(runtime, name, &arguments).await?;
        if output.code != Some(0) {
            return Err("peer_ipv4_configuration");
        }
        values.push(
            std::str::from_utf8(&output.stdout)
                .map_err(|_| "peer_ipv4_configuration")?
                .trim()
                .parse::<Ipv4Addr>()
                .map_err(|_| "peer_ipv4_configuration")?,
        );
    }
    if !values[0].is_private() || values[1] != Ipv4Addr::new(255, 255, 255, 248) {
        return Err("peer_expected_private_29_topology");
    }
    Ok((values[0], values[1]))
}
async fn peer_guest_ready(
    tart: &Tart,
    name: &OwnedVmName,
    deadline: Instant,
) -> Result<(), &'static str> {
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("peer_boot_deadline");
        }
        if matches!(
            timeout(
                remaining.min(Duration::from_secs(30)),
                tart.guest_agent_ready(name)
            )
            .await,
            Ok(Ok(true))
        ) {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
fn target_link_local(output: &[u8]) -> Option<String> {
    std::str::from_utf8(output).ok()?.lines().find_map(|line| {
        let mut words = line.split_whitespace();
        if words.next() != Some("inet6") {
            return None;
        }
        let raw = words.next()?;
        let (address, zone) = raw.split_once('%')?;
        let ip = address.parse::<Ipv6Addr>().ok()?;
        (zone == "en0" && ip.segments()[0] & 0xffc0 == 0xfe80).then(|| format!("{ip}%en0"))
    })
}

#[tokio::test]
#[ignore = "explicit two-VM peer/IPv6 gate: UID451 LaunchDaemon, idle held controller, no GitHub or JIT"]
async fn launchdaemon_two_vm_peer_and_ipv6_isolation() {
    assert_eq!(std::env::consts::OS, "macos");
    assert_eq!(rustix::process::geteuid().as_raw(), 451);
    let configuration = std::env::var_os("HOMELAB_RUNNER_VM_CONFIG")
        .expect("reviewed root-owned proof configuration");
    let runtime = load_config(Path::new(&configuration)).expect("unsafe peer proof configuration");
    let store = Store::open(&runtime.state_directory).expect("exclusive idle controller lock");
    assert!(store.load().expect("valid journal").active.is_none());
    private_directory(&runtime.state_directory).unwrap();
    private_directory(&runtime.tart.tart_home).unwrap();
    let tart = Tart::new(runtime.tart.clone()).unwrap();
    tart.verify_helper().expect("reviewed protected binaries");
    tart.verify_version().await.unwrap();
    assert!(
        !tart
            .inventory()
            .await
            .expect("initial stopped inventory")
            .iter()
            .any(|vm| vm.running || homelab_runner::names::parse(&vm.name).is_some()),
        "all controller-owned VMs must be absent before this two-VM gate"
    );
    let storage = rustix::fs::statvfs(&runtime.tart.tart_home).unwrap();
    assert!(
        storage.f_bavail.saturating_mul(storage.f_frsize) >= runtime.policy.admission_free_bytes
    );
    keychain::prepare(runtime.keychain.as_ref().unwrap())
        .await
        .expect("dedicated service keychain");
    let client = OwnedVmName::parse(&homelab_runner::names::attempt_name(
        &runtime.policy.host_name,
        &uuid::Uuid::new_v4().simple().to_string(),
    ))
    .unwrap();
    let target = OwnedVmName::parse(&homelab_runner::names::attempt_name(
        &runtime.policy.host_name,
        &uuid::Uuid::new_v4().simple().to_string(),
    ))
    .unwrap();
    let evidence_path = runtime.state_directory.join(format!(
        "vm-peer-proof-{}.json",
        uuid::Uuid::new_v4().simple()
    ));
    let mut evidence = PeerEvidence {
        schema: 2,
        scope: "two_disposable_vms_production_architecture_boundary_no_job",
        started_at: unix_now(),
        finished_at: None,
        stage: "reserved",
        image: runtime.policy.image.clone(),
        tart_binary: runtime.tart.binary.clone(),
        softnet_directory: runtime.tart.helper_directory.clone(),
        control_policy: "test_only_softnet_allow_all_IPv4; no_host_integrations_or_exposed_ports",
        production_client_arguments: homelab_runner::tart::run_arguments(&client),
        client: client.as_str().into(),
        target: target.as_str().into(),
        client_memory_mib: 8192,
        target_memory_mib: 4096,
        target_pid: None,
        control_client_pid: None,
        production_client_pid: None,
        target_ipv4: None,
        target_netmask: None,
        open_client_ipv4: None,
        open_client_netmask: None,
        production_client_ipv4: None,
        production_client_netmask: None,
        topology: "separate_Tart_runs_each_initialize_one_Softnet_vmnet_network_with_unused_private_29; permissive_baseline_does_not_establish_filter_causality",
        topology_source: "https://github.com/openai/softnet/blob/0.25.0/lib/manager.rs#L249-L252; https://github.com/openai/tart/blob/2.41.1/Sources/tart/Network/Softnet.swift#L43-L48",
        policy_causality_proven: false,
        production_client_public_https: false,
        peer_ipv6: None,
        checks: Vec::new(),
        public_ipv6_black_box_proven: false,
        ipv6_scope: "loopback_positive_and_conditional_peer_negative; public_IPv6_unproven; Softnet0.25_source_drops_nonARP_nonIPv4",
        cleanup_client: false,
        cleanup_target: false,
        passed: false,
        failure: None,
    };
    save_peer_evidence(&evidence_path, &evidence, true).unwrap();
    println!("peer-proof: private evidence={}", evidence_path.display());
    let mut target_owner: Option<Child> = None;
    let mut control_owner: Option<Child> = None;
    let mut production_owner: Option<RunningVm> = None;
    let result = timeout(TOTAL_LIMIT, async {
        evidence.stage = "cloning";
        save_peer_evidence(&evidence_path, &evidence, false)?;
        // Both stopped clones exist before either VF boot. No disk-capacity
        // inventory is allowed until both guest-agent RPCs have succeeded.
        tart.clone_vm(&runtime.policy.image, &target, 2, 4096)
            .await
            .map_err(|_| "peer_target_clone")?;
        tart.clone_vm(&runtime.policy.image, &client, runtime.policy.cpu, 8192)
            .await
            .map_err(|_| "peer_client_clone")?;
        evidence.stage = "booting_open_controls";
        target_owner = Some(network_control_boot(&runtime, &target)?);
        control_owner = Some(network_control_boot(&runtime, &client)?);
        evidence.target_pid = target_owner.as_ref().and_then(Child::id);
        evidence.control_client_pid = control_owner.as_ref().and_then(Child::id);
        save_peer_evidence(&evidence_path, &evidence, false)?;
        let deadline = Instant::now() + Duration::from_secs(600);
        peer_guest_ready(&tart, &target, deadline).await?;
        peer_guest_ready(&tart, &client, deadline).await?;
        if target_owner
            .as_mut()
            .ok_or("target_owner_missing")?
            .try_wait()
            .map_err(|_| "target_owner_status")?
            .is_some()
            || control_owner
                .as_mut()
                .ok_or("client_owner_missing")?
                .try_wait()
                .map_err(|_| "client_owner_status")?
                .is_some()
        {
            return Err("control_owner_exited");
        }
        let (address, target_mask) = peer_ipv4_configuration(&runtime, &target).await?;
        let (open_address, open_mask) = peer_ipv4_configuration(&runtime, &client).await?;
        if u32::from(address) & u32::from(target_mask)
            == u32::from(open_address) & u32::from(open_mask)
        {
            return Err("peer_expected_separate_networks");
        }
        let address = address.to_string();
        evidence.target_ipv4 = Some(address.clone());
        evidence.target_netmask = Some(target_mask.to_string());
        evidence.open_client_ipv4 = Some(open_address.to_string());
        evidence.open_client_netmask = Some(open_mask.to_string());
        peer_check(
            &mut evidence,
            "target_ipv4_loopback_ssh",
            "connected",
            guest_tcp(&runtime, &target, "127.0.0.1", false).await?,
        )?;
        peer_check(
            &mut evidence,
            "host_target_ipv4_ssh_before",
            "connected",
            host_tcp(&address).await?,
        )?;
        peer_check(
            &mut evidence,
            "open_client_target_ipv4_ssh",
            "observed_only",
            guest_tcp(&runtime, &client, &address, false).await?,
        )?;
        peer_check(
            &mut evidence,
            "host_open_client_ipv4_ssh",
            "connected",
            host_tcp(&open_address.to_string()).await?,
        )?;
        evidence.stage = "rebooting_same_client_production_policy";
        save_peer_evidence(&evidence_path, &evidence, false)?;
        tart.stop(&client)
            .await
            .map_err(|_| "peer_control_client_stop")?;
        timeout(
            Duration::from_secs(10),
            control_owner.as_mut().ok_or("client_owner_missing")?.wait(),
        )
        .await
        .map_err(|_| "peer_control_client_reap")?
        .map_err(|_| "peer_control_client_reap")?;
        control_owner = None;
        production_owner = Some(
            tart.boot(&client)
                .map_err(|_| "peer_production_client_boot")?,
        );
        evidence.production_client_pid = production_owner.as_ref().and_then(RunningVm::process_id);
        save_peer_evidence(&evidence_path, &evidence, false)?;
        peer_guest_ready(&tart, &client, Instant::now() + Duration::from_secs(600)).await?;
        if production_owner
            .as_mut()
            .ok_or("production_owner_missing")?
            .exited()
            .map_err(|_| "production_owner_status")?
        {
            return Err("production_owner_exited");
        }
        evidence.stage = "preparing_production_client_public_helper_sdk_dns";
        save_peer_evidence(&evidence_path, &evidence, false)?;
        tart.prepare_guest(&client, Duration::from_secs(600))
            .await
            .map_err(|_| "peer_production_client_prepare")?;
        let (production_address, production_mask) =
            peer_ipv4_configuration(&runtime, &client).await?;
        if u32::from(
            address
                .parse::<Ipv4Addr>()
                .map_err(|_| "peer_target_address")?,
        ) & u32::from(target_mask)
            == u32::from(production_address) & u32::from(production_mask)
        {
            return Err("peer_expected_separate_networks");
        }
        evidence.production_client_ipv4 = Some(production_address.to_string());
        evidence.production_client_netmask = Some(production_mask.to_string());
        let https = network_exec(
            &runtime,
            &client,
            &[
                "/usr/bin/curl",
                "--ipv4",
                "--silent",
                "--show-error",
                "--fail",
                "--connect-timeout",
                "5",
                "--max-time",
                "8",
                "--output",
                "/dev/null",
                "--write-out",
                "%{http_code}",
                "https://api.github.com",
            ],
        )
        .await?;
        if https.code != Some(0) || https.stdout != b"200" {
            return Err("peer_production_client_public_https");
        }
        evidence.production_client_public_https = true;
        peer_check(
            &mut evidence,
            "production_client_ipv4_loopback_ssh",
            "connected",
            guest_tcp(&runtime, &client, "127.0.0.1", false).await?,
        )?;
        peer_check(
            &mut evidence,
            "production_client_ipv6_loopback_ssh",
            "connected",
            guest_tcp(&runtime, &client, "::1", true).await?,
        )?;
        peer_check(
            &mut evidence,
            "production_client_target_ipv4_ssh",
            "blocked",
            guest_tcp(&runtime, &client, &address, false).await?,
        )?;
        peer_guest_ready(&tart, &client, Instant::now() + Duration::from_secs(30)).await?;
        peer_guest_ready(&tart, &target, Instant::now() + Duration::from_secs(30)).await?;
        peer_check(
            &mut evidence,
            "host_target_ipv4_ssh_after",
            "connected",
            host_tcp(&address).await?,
        )?;
        peer_check(
            &mut evidence,
            "target_ipv4_loopback_ssh_after",
            "connected",
            guest_tcp(&runtime, &target, "127.0.0.1", false).await?,
        )?;
        let output = network_exec(&runtime, &target, &["/sbin/ifconfig", "en0"]).await?;
        if output.code == Some(0)
            && let Some(link_local) = target_link_local(&output.stdout)
            && let Ok(TcpObservation::Connected) =
                guest_tcp(&runtime, &target, &link_local, true).await
        {
            evidence.peer_ipv6 = Some(link_local.clone());
            peer_check(
                &mut evidence,
                "target_ipv6_linklocal_ssh",
                "connected",
                TcpObservation::Connected,
            )?;
            peer_check(
                &mut evidence,
                "production_client_target_ipv6_linklocal_ssh",
                "blocked",
                guest_tcp(&runtime, &client, &link_local, true).await?,
            )?;
        }
        if target_owner
            .as_mut()
            .ok_or("target_owner_missing")?
            .try_wait()
            .map_err(|_| "target_owner_status")?
            .is_some()
        {
            return Err("continuous_target_owner_exited");
        }
        evidence.stage = "checks_complete";
        save_peer_evidence(&evidence_path, &evidence, false)?;
        Ok::<(), &'static str>(())
    })
    .await
    .unwrap_or(Err("peer_total_deadline"));
    evidence.failure = result.err();
    evidence.stage = "cleanup";
    // Stop's native command uses only the exact config/PID lock; unlike list,
    // it does not inspect ASIF capacity. Give Tart a chance to stop Softnet too.
    if production_owner.is_some() || control_owner.is_some() {
        let _ = network_command(network_tart_command(
            &runtime,
            &["stop", "--timeout", "5", client.as_str()],
        ))
        .await;
    }
    if target_owner.is_some() {
        let _ = network_command(network_tart_command(
            &runtime,
            &["stop", "--timeout", "5", target.as_str()],
        ))
        .await;
    }
    // Reap every exact retained native owner before any delete/list can open a
    // half-started ASIF disk. Never infer absence from a failed guest RPC.
    let mut quiescent = true;
    if let Some(owner) = production_owner.as_mut() {
        quiescent &= owner.terminate_and_reap().await.is_ok();
    }
    if let Some(owner) = control_owner.as_mut() {
        quiescent &= network_reap(owner).await.is_ok();
    }
    if let Some(owner) = target_owner.as_mut() {
        quiescent &= network_reap(owner).await.is_ok();
    }
    if quiescent {
        evidence.cleanup_client = tart.delete(&client).await.is_ok();
        evidence.cleanup_target = tart.delete(&target).await.is_ok();
    }
    evidence.finished_at = Some(unix_now());
    if evidence.failure.is_none() && !quiescent {
        evidence.failure = Some("peer_owner_quiescence_failed");
    }
    if evidence.failure.is_none() && (!evidence.cleanup_client || !evidence.cleanup_target) {
        evidence.failure = Some("peer_exact_cleanup_failed");
    }
    evidence.passed = result.is_ok() && evidence.cleanup_client && evidence.cleanup_target;
    evidence.stage = "complete";
    save_peer_evidence(&evidence_path, &evidence, false).expect("bounded final peer evidence");
    assert!(
        evidence.passed,
        "peer proof failed: category={:?}, client_cleanup={}, target_cleanup={}; exact private evidence retained",
        evidence.failure, evidence.cleanup_client, evidence.cleanup_target
    );
    println!(
        "peer-proof: passed production peer isolation with public HTTPS and separate /29 networks; filter causality and public IPv6 remain unproven"
    );
}

#[test]
fn peer_probe_requires_native_destination_failure_and_parses_only_link_local_addresses() {
    let output = NetworkOutput {
        code: Some(1),
        stdout: Vec::new(),
        stderr: b"Error: failed to connect to guest agent".to_vec(),
    };
    assert!(tcp_observation(&output, "192.168.64.2").is_err());
    let output = NetworkOutput {
        code: Some(1),
        stdout: Vec::new(),
        stderr: b"nc: connectx to 192.168.64.2 port 22 (tcp) failed: Operation timed out\n"
            .to_vec(),
    };
    assert_eq!(
        tcp_observation(&output, "192.168.64.2").unwrap(),
        TcpObservation::TimedOut
    );
    assert!(tcp_observation(&output, "192.168.64.3").is_err());
    assert_eq!(
        target_link_local(b" inet6 ::1 prefixlen 128\n inet6 fe80::123%en0 prefixlen 64\n"),
        Some("fe80::123%en0".into())
    );
    assert!(target_link_local(b"inet6 2001:db8::1%en0 prefixlen 64").is_none());
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
        .any(|vm| vm.running || homelab_runner::names::parse(&vm.name).is_some())
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
    let name = OwnedVmName::parse(&homelab_runner::names::attempt_name(
        &runtime.policy.host_name,
        &uuid::Uuid::new_v4().simple().to_string(),
    ))
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
