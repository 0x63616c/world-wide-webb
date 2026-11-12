//! Narrow adapter for Tart 2.41.1. Runtime/headless and network proof is external.
use crate::config::valid_runner_version;
use crate::guest::{GuestPhase, GuestStatus, MAX_JIT_BYTES};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs::File,
    os::unix::{fs::MetadataExt, process::ExitStatusExt},
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::{Child, Command},
    time::timeout,
};

pub const TART_VERSION: &str = "2.41.1";
pub const GUEST_HELPER: &str = "/usr/local/libexec/homelab-runner-guest";
/// Reviewed against Softnet 0.25.0: directional ingress deny enables stateful
/// replies, and non-ARP/non-IPv4 ethertypes are dropped by both proxy directions.
/// DNS and public-address hairpin isolation still require real reachability tests.
pub const SOFTNET_BLOCK: &str = "@host,@peers,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,100.64.0.0/10,169.254.0.0/16,127.0.0.0/8,0.0.0.0/8,224.0.0.0/4,240.0.0.0/4,in 0.0.0.0/0";
const OUTPUT_LIMIT: usize = 128 * 1024;
const MAX_GUEST_HELPER_BYTES: u64 = 64 * 1024 * 1024;
const MAX_RUNNER_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
const GUEST_RUNNER_DIRECTORY: &str = "/Users/admin/actions-runner";
const GUEST_RUNNER_LISTENER: &str = "/Users/admin/actions-runner/bin/Runner.Listener";
const STARTUP_DIAGNOSTIC_LIMIT: usize = 64 * 1024;
const GUEST_STATUS_PATH: &str = "/var/lib/homelab-runner/status.json";
const GUEST_SERVICE_PATH: &str = "/Library/LaunchDaemons/org.homelab.runner-guest.plist";
const GUEST_SERVICE_PLIST: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>org.homelab.runner-guest</string>
<key>ProgramArguments</key><array>
<string>/usr/local/libexec/homelab-runner-guest</string><string>serve</string>
<string>--runner</string><string>/Users/admin/actions-runner/run.sh</string>
<string>--home</string><string>/Users/admin</string>
</array>
<key>UserName</key><string>admin</string><key>GroupName</key><string>staff</string>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>/Users/admin</string>
<key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
<key>RunAtLoad</key><true/><key>KeepAlive</key><false/>
<key>Umask</key><integer>63</integer>
</dict></plist>
"#;

const LINUX_SERVICE: &str = include_str!("../images/linux/homelab-runner-guest.service");

#[derive(Debug, thiserror::Error)]
pub enum TartError {
    #[error("invalid Tart adapter configuration")]
    Configuration,
    #[error("invalid exact owned VM name")]
    Ownership,
    #[error("Tart {operation}: process I/O failure ({kind:?})")]
    Io {
        operation: &'static str,
        kind: std::io::ErrorKind,
    },
    #[error("Tart {0}: deadline exceeded; reconcile before retry")]
    Timeout(&'static str),
    #[error("Tart {0}: child termination could not be confirmed; retain ownership")]
    TerminationUnconfirmed(&'static str),
    #[error("Tart operation lease is still held; retain ownership")]
    CloneLeaseBusy,
    #[error("Tart operation lease path or permissions invalid")]
    CloneLeaseInvalid,
    #[error(
        "Tart {operation}: rejected operation (exit code {exit_code:?}, signal {signal:?}); reconcile inventory"
    )]
    Failed {
        operation: &'static str,
        exit_code: Option<i32>,
        signal: Option<i32>,
    },
    #[error("Tart helper preflight: {0}")]
    Helper(&'static str),
    #[error("Tart {0}: output exceeded bound")]
    OutputLimit(&'static str),
    #[error("invalid or ambiguous Tart inventory")]
    Inventory,
    #[error("Tart version does not match reviewed 2.41.1")]
    Version,
    #[error("guest status invalid")]
    GuestStatus,
    #[error("guest identity differs from reviewed stock image")]
    GuestIdentity,
    #[error("guest already has a claimed or unreadable status; cleanup instead of preparing again")]
    GuestAlreadyClaimed,
    #[error(
        "startup diagnostic output requires a new private0600 file in a service-owned0700 directory"
    )]
    StartupDiagnosticPath,
    #[error("guest runner version does not match the pinned official archive")]
    RunnerVersion,
}

#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize)]
pub struct OwnedVmName(String);
impl OwnedVmName {
    pub fn parse(value: &str) -> Result<Self, TartError> {
        if crate::names::parse(value).is_none() {
            return Err(TartError::Ownership);
        }
        Ok(Self(value.to_owned()))
    }
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub fn attempt_id(&self) -> &str {
        self.0.rsplit_once("-job-").expect("validated name").1
    }
}
impl<'de> Deserialize<'de> for OwnedVmName {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Self::parse(&String::deserialize(d)?).map_err(serde::de::Error::custom)
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VmState {
    Running,
    Stopped,
    Suspended,
}
#[derive(Clone, Debug, Deserialize)]
pub struct LocalVm {
    #[serde(rename = "Source")]
    pub source: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "State")]
    pub state: VmState,
    #[serde(rename = "Running")]
    pub running: bool,
}
pub fn parse_inventory(bytes: &[u8]) -> Result<Vec<LocalVm>, TartError> {
    if bytes.len() > OUTPUT_LIMIT {
        return Err(TartError::Inventory);
    }
    let rows: Vec<LocalVm> = serde_json::from_slice(bytes).map_err(|_| TartError::Inventory)?;
    let mut names = HashSet::new();
    for vm in &rows {
        if vm.source != "local"
            || vm.name.is_empty()
            || !names.insert(&vm.name)
            || vm.running != (vm.state == VmState::Running)
        {
            return Err(TartError::Inventory);
        }
    }
    Ok(rows)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TartConfig {
    pub binary: PathBuf,
    pub home: PathBuf,
    pub tart_home: PathBuf,
    /// Parent directory containing the reviewed, provisioned Softnet executable.
    pub helper_directory: PathBuf,
    /// Public guest binary from the same immutable controller package.
    pub guest_helper: PathBuf,
    /// Cached official ARM64 archive pinned independently from the Xcode image.
    pub runner_archive: PathBuf,
    pub runner_version: String,
}
#[derive(Clone)]
pub struct Tart {
    config: TartConfig,
    platform: crate::config::Platform,
}
impl Tart {
    pub fn new(config: TartConfig) -> Result<Self, TartError> {
        if [
            &config.binary,
            &config.home,
            &config.tart_home,
            &config.helper_directory,
            &config.guest_helper,
            &config.runner_archive,
        ]
        .iter()
        .any(|p| !p.is_absolute())
            || !valid_runner_version(&config.runner_version)
        {
            return Err(TartError::Configuration);
        }
        Ok(Self {
            config,
            platform: crate::config::Platform::MacosArm64,
        })
    }
    /// Select only journal-snapshotted public artifacts, never mutable current policy.
    pub fn for_attempt(&self, attempt: &crate::state::Attempt) -> Result<Self, TartError> {
        let mut config = self.config.clone();
        if let Some(linux) = &attempt.linux_profile {
            config.runner_archive = linux.runner_archive.clone();
            config.runner_version = linux.runner_version.clone();
        } else if attempt.platform.is_linux() {
            return Err(TartError::Configuration);
        }
        let mut tart = Self::new(config)?;
        tart.platform = attempt.platform;
        Ok(tart)
    }
    fn runner_directory(&self) -> &'static str {
        match self.platform {
            crate::config::Platform::MacosArm64 => GUEST_RUNNER_DIRECTORY,
            crate::config::Platform::LinuxArm64 | crate::config::Platform::LinuxOperationsArm64 => {
                "/home/admin/actions-runner"
            }
        }
    }
    fn runner_listener(&self) -> &'static str {
        match self.platform {
            crate::config::Platform::MacosArm64 => GUEST_RUNNER_LISTENER,
            crate::config::Platform::LinuxArm64 | crate::config::Platform::LinuxOperationsArm64 => {
                "/home/admin/actions-runner/bin/Runner.Listener"
            }
        }
    }
    /// Provisioning must install the reviewed helper with root ownership and
    /// setuid before boot. Never let Tart enter its interactive sudo/chmod path.
    /// The caller must separately attest tool signatures/hashes and privilege drop.
    pub fn verify_helper(&self) -> Result<(), TartError> {
        trusted_executable(&self.config.helper_directory.join("softnet"), true)?;
        trusted_executable(&self.config.binary, false)?;
        trusted_executable(&self.config.guest_helper, false)?;
        let _ = open_runner_archive(&self.config.runner_archive)?;
        Ok(())
    }
    fn command(&self, args: &[String]) -> Command {
        let mut cmd = Command::new(&self.config.binary);
        cmd.args(args)
            .env_clear()
            .env("HOME", &self.config.home)
            .env("TART_HOME", &self.config.tart_home)
            .env(
                "PATH",
                format!(
                    "{}:/usr/bin:/bin:/usr/sbin:/sbin",
                    self.config.helper_directory.display()
                ),
            )
            .env("TART_NO_AUTO_PRUNE", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        cmd
    }
    async fn execute(
        &self,
        op: &'static str,
        args: Vec<String>,
        input: Option<&[u8]>,
        deadline: Duration,
    ) -> Result<Vec<u8>, TartError> {
        self.execute_with_lease(op, args, input, deadline, None, None)
            .await
    }
    async fn execute_with_lease(
        &self,
        op: &'static str,
        args: Vec<String>,
        input: Option<&[u8]>,
        deadline: Duration,
        lease: Option<&CloneLease>,
        public_file: Option<File>,
    ) -> Result<Vec<u8>, TartError> {
        let mut cmd = self.command(&args);
        if let Some(lease) = lease {
            if input.is_some() || public_file.is_some() {
                return Err(TartError::Configuration);
            }
            // stdin is an intentional clone/set operation lease, never the
            // global controller lock. Command duplicates it onto fd0 for exec.
            cmd.stdin(Stdio::from(
                lease
                    .file
                    .try_clone()
                    .map_err(|e| io_error("clone lease duplicate", e))?,
            ));
        }
        if let Some(file) = public_file {
            if input.is_some() {
                return Err(TartError::Configuration);
            }
            cmd.stdin(Stdio::from(file));
        }
        if input.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().map_err(|e| io_error(op, e))?;
        let stdout = child.stdout.take().ok_or(missing_pipe(op))?;
        let stderr = child.stderr.take().ok_or(missing_pipe(op))?;
        // Drain both streams concurrently; neither stream, including stderr on failure,
        // is included in errors or logs because Tart/guest diagnostics may be sensitive.
        let mut out_task = tokio::spawn(read_bounded(stdout));
        let mut err_task = tokio::spawn(read_bounded(stderr));
        let result = timeout(deadline, async {
            if let Some(input) = input {
                let mut stdin = child.stdin.take().ok_or(missing_pipe(op))?;
                stdin.write_all(input).await.map_err(|e| io_error(op, e))?;
                stdin.shutdown().await.map_err(|e| io_error(op, e))?;
            }
            child.wait().await.map_err(|e| io_error(op, e))
        })
        .await;
        let status = match result {
            Ok(Ok(status)) => status,
            other => {
                let _ = child.start_kill();
                let terminated = matches!(
                    timeout(Duration::from_secs(2), child.wait()).await,
                    Ok(Ok(_))
                );
                out_task.abort();
                err_task.abort();
                if !terminated {
                    return Err(TartError::TerminationUnconfirmed(op));
                }
                return Err(match other {
                    Err(_) => TartError::Timeout(op),
                    Ok(Err(error)) => error,
                    Ok(Ok(_)) => unreachable!(),
                });
            }
        };
        // Descendants can retain the pipe after the direct child exits. Bound that too.
        let streams = match timeout(Duration::from_secs(2), async {
            tokio::join!(&mut out_task, &mut err_task)
        })
        .await
        {
            Ok(streams) => streams,
            Err(_) => {
                out_task.abort();
                err_task.abort();
                return Err(TartError::Timeout(op));
            }
        };
        let (out, oversized) = streams
            .0
            .map_err(|_| missing_pipe(op))?
            .map_err(|e| io_error(op, e))?;
        let (_, err_oversized) = streams
            .1
            .map_err(|_| missing_pipe(op))?
            .map_err(|e| io_error(op, e))?;
        if oversized || err_oversized {
            return Err(TartError::OutputLimit(op));
        }
        if !status.success() {
            return Err(TartError::Failed {
                operation: op,
                exit_code: status.code(),
                signal: status.signal(),
            });
        }
        Ok(out)
    }
    pub async fn verify_version(&self) -> Result<(), TartError> {
        let output = self
            .execute(
                "version",
                vec!["--version".into()],
                None,
                Duration::from_secs(10),
            )
            .await?;
        let version = std::str::from_utf8(&output)
            .map_err(|_| TartError::Version)?
            .trim();
        if version != TART_VERSION && version != format!("tart {TART_VERSION}") {
            return Err(TartError::Version);
        }
        Ok(())
    }
    pub async fn inventory(&self) -> Result<Vec<LocalVm>, TartError> {
        parse_inventory(
            &self
                .execute(
                    "list",
                    strings(&["list", "--source", "local", "--format", "json"]),
                    None,
                    Duration::from_secs(30),
                )
                .await?,
        )
    }
    /// Install public bootstrap code into the pinned stock image before any JIT
    /// exists. The caller persists this operation and its absolute boot deadline.
    /// A lost response is reconciled by status; it never licenses a JIT replay.
    pub async fn prepare_guest(
        &self,
        name: &OwnedVmName,
        deadline: Duration,
    ) -> Result<(), TartError> {
        if self.platform == crate::config::Platform::MacosArm64 {
            trusted_executable(&self.config.guest_helper, false)?;
        }
        if deadline.is_zero() {
            return Err(TartError::Timeout("prepare guest"));
        }
        match timeout(
            deadline.min(Duration::from_secs(600)),
            self.prepare_guest_inner(name),
        )
        .await
        {
            Ok(result) => result,
            Err(_) => Err(TartError::TerminationUnconfirmed("prepare guest")),
        }
    }
    async fn guest_command(
        &self,
        name: &OwnedVmName,
        op: &'static str,
        args: &[&str],
        input: Option<&[u8]>,
    ) -> Result<Vec<u8>, TartError> {
        self.execute(
            op,
            guest_exec_arguments(name, args, input.is_some()),
            input,
            Duration::from_secs(30),
        )
        .await
    }
    async fn prepare_guest_inner(&self, name: &OwnedVmName) -> Result<(), TartError> {
        if self.platform.is_linux() {
            return self.prepare_linux_guest(name).await;
        }
        loop {
            match self.guest_agent_ready(name).await {
                Ok(true) => break,
                Err(TartError::GuestIdentity) => return Err(TartError::GuestIdentity),
                _ => tokio::time::sleep(Duration::from_secs(2)).await,
            }
        }
        let already_ready = match self.guest_status(name).await {
            Ok(status) if status.phase == GuestPhase::Ready => true,
            Ok(_) => return Err(TartError::GuestAlreadyClaimed),
            Err(_) => false,
        };
        let uid = self
            .guest_command(
                name,
                "guest sudo identity",
                &["/usr/bin/sudo", "-n", "/usr/bin/id", "-u"],
                None,
            )
            .await?;
        if uid.as_slice() != b"0\n" && uid.as_slice() != b"0" {
            return Err(TartError::GuestIdentity);
        }
        // An absent helper is expected on the stock image. An existing claim
        // whose helper cannot be queried is ambiguous and must never be reset.
        if !already_ready {
            match self
                .guest_command(
                    name,
                    "guest claim probe",
                    &["/usr/bin/sudo", "-n", "/bin/test", "-e", GUEST_STATUS_PATH],
                    None,
                )
                .await
            {
                Ok(_) => return Err(TartError::GuestAlreadyClaimed),
                Err(TartError::Failed {
                    exit_code: Some(1), ..
                }) => {}
                Err(error) => return Err(error),
            }
        }
        self.ensure_runner_unregistered(name).await?;
        // Softnet intentionally blocks the host/gateway and private ranges, so
        // the stock guest's automatic gateway DNS is unavailable. Configure the
        // verified Ethernet service to use public resolvers without weakening
        // host/LAN/tailnet isolation. This also runs on unclaimed Ready retries.
        self.guest_command(
            name,
            "guest public DNS",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/sbin/networksetup",
                "-setdnsservers",
                "Ethernet",
                "1.1.1.1",
                "9.9.9.9",
            ],
            None,
        )
        .await?;
        // GitHub reports the guest hostname separately from its runner name.
        // Set both before registration so its logs identify the same resource.
        for key in ["ComputerName", "LocalHostName", "HostName"] {
            self.guest_command(
                name,
                "guest hostname",
                &[
                    "/usr/bin/sudo",
                    "-n",
                    "/usr/sbin/scutil",
                    "--set",
                    key,
                    name.as_str(),
                ],
                None,
            )
            .await?;
        }
        self.prepare_runner(name).await?;
        if already_ready {
            return Ok(());
        }
        let binary = read_guest_helper(&self.config.guest_helper)?;
        self.guest_command(
            name,
            "guest libexec directory",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/bin/install",
                "-d",
                "-o",
                "root",
                "-g",
                "wheel",
                "-m",
                "0755",
                "/usr/local/libexec",
            ],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest helper upload",
            &[
                "/usr/bin/sudo",
                "-n",
                "/bin/dd",
                "of=/usr/local/libexec/homelab-runner-guest",
            ],
            Some(&binary),
        )
        .await?;
        self.guest_command(
            name,
            "guest helper permissions",
            &["/usr/bin/sudo", "-n", "/bin/chmod", "0555", GUEST_HELPER],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest private state",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/bin/install",
                "-d",
                "-o",
                "admin",
                "-g",
                "staff",
                "-m",
                "0700",
                "/var/lib/homelab-runner",
            ],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest service upload",
            &[
                "/usr/bin/sudo",
                "-n",
                "/bin/dd",
                "of=/Library/LaunchDaemons/org.homelab.runner-guest.plist",
            ],
            Some(GUEST_SERVICE_PLIST.as_bytes()),
        )
        .await?;
        self.guest_command(
            name,
            "guest service permissions",
            &[
                "/usr/bin/sudo",
                "-n",
                "/bin/chmod",
                "0644",
                GUEST_SERVICE_PATH,
            ],
            None,
        )
        .await?;
        // launchctl may report already loaded after an ambiguous transport loss.
        // Only the safe Ready record below establishes successful preparation.
        let _ = self
            .guest_command(
                name,
                "guest service bootstrap",
                &[
                    "/usr/bin/sudo",
                    "-n",
                    "/bin/launchctl",
                    "bootstrap",
                    "system",
                    GUEST_SERVICE_PATH,
                ],
                None,
            )
            .await;
        loop {
            match self.guest_status(name).await {
                Ok(status) if status.phase == GuestPhase::Ready => return Ok(()),
                Ok(_) => return Err(TartError::GuestAlreadyClaimed),
                Err(_) => tokio::time::sleep(Duration::from_secs(2)).await,
            }
        }
    }
    async fn prepare_linux_guest(&self, name: &OwnedVmName) -> Result<(), TartError> {
        loop {
            match self.guest_agent_ready(name).await {
                Ok(true) => break,
                Err(TartError::GuestIdentity) => return Err(TartError::GuestIdentity),
                _ => tokio::time::sleep(Duration::from_secs(2)).await,
            }
        }
        let already_ready = match self.guest_status(name).await {
            Ok(status) if status.phase == GuestPhase::Ready => true,
            Ok(_) => return Err(TartError::GuestAlreadyClaimed),
            Err(_) => false,
        };
        self.ensure_runner_unregistered(name).await?;
        let uid = self
            .guest_command(
                name,
                "guest sudo identity",
                &["/usr/bin/sudo", "-n", "/usr/bin/id", "-u"],
                None,
            )
            .await?;
        if uid != b"0\n" && uid != b"0" {
            return Err(TartError::GuestIdentity);
        }
        if !already_ready {
            match self
                .guest_command(
                    name,
                    "guest claim probe",
                    &["/usr/bin/sudo", "-n", "/bin/test", "-e", GUEST_STATUS_PATH],
                    None,
                )
                .await
            {
                Ok(_) => return Err(TartError::GuestAlreadyClaimed),
                Err(TartError::Failed {
                    exit_code: Some(1), ..
                }) => {}
                Err(error) => return Err(error),
            }
        }
        let home = self
            .guest_command(name, "guest home", &["/usr/bin/printenv", "HOME"], None)
            .await?;
        let arch = self
            .guest_command(name, "guest architecture", &["/usr/bin/uname", "-m"], None)
            .await?;
        if home != b"/home/admin\n" || arch != b"aarch64\n" {
            return Err(TartError::GuestIdentity);
        }
        self.guest_command(
            name,
            "guest hostname",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/bin/hostnamectl",
                "set-hostname",
                name.as_str(),
            ],
            None,
        )
        .await?;
        // Public resolvers and network configuration belong to the pinned image.
        // Verify the image contract without restoring private gateway DNS.
        self.guest_command(
            name,
            "guest Docker readiness",
            &["/usr/bin/docker", "info"],
            None,
        )
        .await?;
        self.prepare_runner(name).await?;
        if already_ready {
            return Ok(());
        }
        // The Linux helper is built into the digest-pinned image. A Darwin
        // controller binary cannot be uploaded as a Linux executable.
        let version = self
            .guest_command(
                name,
                "guest helper contract",
                &[GUEST_HELPER, "--version"],
                None,
            )
            .await?;
        if version != concat!("homelab-runner ", env!("CARGO_PKG_VERSION"), "\n").as_bytes() {
            return Err(TartError::RunnerVersion);
        }
        self.guest_command(
            name,
            "guest private state",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/bin/install",
                "-d",
                "-o",
                "admin",
                "-g",
                "admin",
                "-m",
                "0700",
                "/var/lib/homelab-runner",
            ],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest service upload",
            &[
                "/usr/bin/sudo",
                "-n",
                "/bin/dd",
                "of=/etc/systemd/system/homelab-runner-guest.service",
            ],
            Some(LINUX_SERVICE.as_bytes()),
        )
        .await?;
        self.guest_command(
            name,
            "guest service permissions",
            &[
                "/usr/bin/sudo",
                "-n",
                "/bin/chmod",
                "0644",
                "/etc/systemd/system/homelab-runner-guest.service",
            ],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest systemd reload",
            &["/usr/bin/sudo", "-n", "/usr/bin/systemctl", "daemon-reload"],
            None,
        )
        .await?;
        self.guest_command(
            name,
            "guest service start",
            &[
                "/usr/bin/sudo",
                "-n",
                "/usr/bin/systemctl",
                "start",
                "homelab-runner-guest.service",
            ],
            None,
        )
        .await?;
        loop {
            match self.guest_status(name).await {
                Ok(status) if status.phase == GuestPhase::Ready => return Ok(()),
                Ok(_) => return Err(TartError::GuestAlreadyClaimed),
                Err(_) => tokio::time::sleep(Duration::from_secs(2)).await,
            }
        }
    }
    async fn prepare_runner(&self, name: &OwnedVmName) -> Result<(), TartError> {
        match self.runner_version_matches(name).await {
            Ok(true) => return Ok(()),
            Ok(false) | Err(TartError::Failed { .. }) => {}
            Err(error) => return Err(error),
        }
        self.guest_command(
            name,
            "guest runner directory",
            &["/bin/mkdir", "-p", self.runner_directory()],
            None,
        )
        .await?;
        let archive = open_runner_archive(&self.config.runner_archive)?;
        self.execute_with_lease(
            "guest runner archive",
            guest_exec_arguments(
                name,
                &["/usr/bin/tar", "-xzf", "-", "-C", self.runner_directory()],
                true,
            ),
            None,
            Duration::from_secs(180),
            None,
            Some(archive),
        )
        .await?;
        if !self.runner_version_matches(name).await? {
            return Err(TartError::RunnerVersion);
        }
        Ok(())
    }
    async fn ensure_runner_unregistered(&self, name: &OwnedVmName) -> Result<(), TartError> {
        // Never mutate an already registered runner, even if a stale/malformed
        // helper record incorrectly claims that this guest is still unclaimed.
        for file in [".runner", ".credentials", ".credentials_rsaparams"] {
            let path = format!("{}/{file}", self.runner_directory());
            match self
                .guest_command(
                    name,
                    "guest runner credential probe",
                    &["/usr/bin/sudo", "-n", "/bin/test", "-e", &path],
                    None,
                )
                .await
            {
                Ok(_) => return Err(TartError::GuestAlreadyClaimed),
                Err(TartError::Failed {
                    exit_code: Some(1), ..
                }) => {}
                Err(error) => return Err(error),
            }
        }
        Ok(())
    }
    async fn runner_version_matches(&self, name: &OwnedVmName) -> Result<bool, TartError> {
        let bytes = self
            .guest_command(
                name,
                "guest runner version",
                &[self.runner_listener(), "--version"],
                None,
            )
            .await?;
        Ok(bytes == self.config.runner_version.as_bytes()
            || bytes == format!("{}\n", self.config.runner_version).as_bytes())
    }
    /// Positive virtio guest-agent observation without touching the ASIF disk.
    /// Tart2.41.1 inventory invokes diskutil and must not be polled during boot.
    pub async fn guest_agent_ready(&self, name: &OwnedVmName) -> Result<bool, TartError> {
        let uid = self
            .guest_command(name, "guest identity", &["/usr/bin/id", "-u"], None)
            .await?;
        let expected = match self.platform {
            crate::config::Platform::MacosArm64 => "501",
            crate::config::Platform::LinuxArm64 | crate::config::Platform::LinuxOperationsArm64 => {
                "1000"
            }
        };
        if std::str::from_utf8(&uid).is_ok_and(|uid| uid.trim_end_matches('\n') == expected) {
            Ok(true)
        } else {
            Err(TartError::GuestIdentity)
        }
    }
    /// Must be called only after durable clone intent. A failed command can leave a partial VM.
    pub async fn clone_vm(
        &self,
        image: &str,
        name: &OwnedVmName,
        cpu: u16,
        memory_mib: u32,
    ) -> Result<(), TartError> {
        if !valid_image_digest(image)
            || !(1..=8).contains(&cpu)
            || !(1024..=16384).contains(&memory_mib)
        {
            return Err(TartError::Configuration);
        }
        let lease = self
            .acquire_clone_lease(name, true)?
            .ok_or(TartError::CloneLeaseInvalid)?;
        self.execute_with_lease(
            "clone",
            strings(&["clone", image, name.as_str()]),
            None,
            Duration::from_secs(1800),
            Some(&lease),
            None,
        )
        .await?;
        self.execute_with_lease(
            "set",
            strings(&[
                "set",
                name.as_str(),
                "--cpu",
                &cpu.to_string(),
                "--memory",
                &memory_mib.to_string(),
                "--random-mac",
            ]),
            None,
            Duration::from_secs(30),
            Some(&lease),
            None,
        )
        .await?;
        Ok(())
    }
    /// Compatibility name for the shared clone/set/run operation lease probe.
    pub fn clone_operation_finished(&self, name: &OwnedVmName) -> Result<bool, TartError> {
        self.operation_finished(name)
    }
    /// Check the per-attempt lease BEFORE disk inventory. A lease-aware clone,
    /// set, or foreground run may outlive its parent. Missing/free means quiescent
    /// only when the durable intent records this operation's lease contract.
    pub fn operation_finished(&self, name: &OwnedVmName) -> Result<bool, TartError> {
        match self.acquire_clone_lease(name, false) {
            Ok(Some(lease)) => {
                lease.release_probe()?;
                Ok(true)
            }
            Ok(None) => Ok(true),
            Err(TartError::CloneLeaseBusy) => Ok(false),
            Err(error) => Err(error),
        }
    }
    /// Retire the exact lease after an attempt whose VM is already absent.
    /// The controller calls this during confirmed cleanup even when no delete
    /// action was necessary. Never removes a held lease or deletes any VM.
    pub async fn cleanup_clone_operation(&self, name: &OwnedVmName) -> Result<(), TartError> {
        let lease = self.acquire_clone_lease(name, false)?;
        if self
            .inventory()
            .await?
            .iter()
            .any(|vm| vm.name == name.as_str())
        {
            return Err(TartError::Failed {
                operation: "clone lease cleanup requires absent VM",
                exit_code: None,
                signal: None,
            });
        }
        if let Some(lease) = lease {
            lease.remove()?;
        }
        Ok(())
    }
    fn acquire_clone_lease(
        &self,
        name: &OwnedVmName,
        create: bool,
    ) -> Result<Option<CloneLease>, TartError> {
        let directory = open_clone_lease_directory(&self.config.tart_home)?;
        let filename = clone_lease_filename(name);
        let mut flags = rustix::fs::OFlags::RDWR
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::CLOEXEC
            | rustix::fs::OFlags::NONBLOCK;
        if create {
            flags |= rustix::fs::OFlags::CREATE;
        }
        let file = match rustix::fs::openat(
            &directory,
            filename.as_str(),
            flags,
            rustix::fs::Mode::from_raw_mode(0o600),
        ) {
            Ok(fd) => File::from(fd),
            Err(rustix::io::Errno::NOENT) if !create => return Ok(None),
            Err(_) => return Err(TartError::CloneLeaseInvalid),
        };
        let metadata = file
            .metadata()
            .map_err(|e| io_error("clone lease metadata", e))?;
        if !metadata.is_file()
            || metadata.uid() != rustix::process::geteuid().as_raw()
            || metadata.mode() & 0o7777 != 0o600
            || metadata.nlink() != 1
        {
            return Err(TartError::CloneLeaseInvalid);
        }
        match file.try_lock() {
            Ok(()) => Ok(Some(CloneLease {
                file,
                directory,
                filename,
            })),
            Err(std::fs::TryLockError::WouldBlock) => Err(TartError::CloneLeaseBusy),
            Err(std::fs::TryLockError::Error(error)) => Err(io_error("clone lease lock", error)),
        }
    }
    /// Foreground Tart is supervised as a child, never an invented detach flag.
    /// Dropping this handle does not establish that a VM survived controller restart.
    pub fn boot(&self, name: &OwnedVmName) -> Result<RunningVm, TartError> {
        self.spawn_boot(name, None)
    }
    /// Explicit pre-JIT feasibility diagnostic only. Stores at most64KiB of raw
    /// native stderr in a new private file; the normal controller never enables
    /// this. This probe's pipe is not evidence that Tart survives parent death.
    pub fn boot_with_startup_diagnostics(
        &self,
        name: &OwnedVmName,
        path: &Path,
    ) -> Result<RunningVm, TartError> {
        let parent = path.parent().ok_or(TartError::StartupDiagnosticPath)?;
        let directory =
            open_clone_lease_directory(parent).map_err(|_| TartError::StartupDiagnosticPath)?;
        let filename = path.file_name().ok_or(TartError::StartupDiagnosticPath)?;
        let file = File::from(
            rustix::fs::openat(
                &directory,
                filename,
                rustix::fs::OFlags::WRONLY
                    | rustix::fs::OFlags::CREATE
                    | rustix::fs::OFlags::EXCL
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::from_raw_mode(0o600),
            )
            .map_err(|_| TartError::StartupDiagnosticPath)?,
        );
        self.spawn_boot(name, Some(file))
    }
    fn spawn_boot(
        &self,
        name: &OwnedVmName,
        diagnostic: Option<File>,
    ) -> Result<RunningVm, TartError> {
        self.verify_helper()?;
        self.spawn_boot_owner(name, self.command(&run_arguments(name)), diagnostic)
    }
    fn spawn_boot_owner(
        &self,
        name: &OwnedVmName,
        mut cmd: Command,
        diagnostic: Option<File>,
    ) -> Result<RunningVm, TartError> {
        let lease = self
            .acquire_clone_lease(name, true)?
            .ok_or(TartError::CloneLeaseInvalid)?;
        // Run has no stdin payload. Only fd0 deliberately inherits this lock;
        // separate guest exec commands carry JIT on their own stdin. Dropping
        // the parent's files must never explicitly unlock the shared description.
        cmd.stdin(Stdio::from(
            lease
                .file
                .try_clone()
                .map_err(|e| io_error("run lease duplicate", e))?,
        ));
        cmd.stdout(Stdio::null())
            .stderr(if diagnostic.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .kill_on_drop(false);
        let mut child = cmd.spawn().map_err(|e| io_error("run", e))?;
        let startup = if let Some(file) = diagnostic {
            let state = Arc::new(Mutex::new(StartupCapture::default()));
            let capture = Arc::clone(&state);
            let stderr = child.stderr.take().ok_or(missing_pipe("run stderr"))?;
            tokio::spawn(capture_startup(stderr, file, capture));
            Some(state)
        } else {
            None
        };
        Ok(RunningVm { child, startup })
    }
    pub async fn stop(&self, name: &OwnedVmName) -> Result<(), TartError> {
        let rows = self.inventory().await?;
        if rows
            .iter()
            .any(|r| r.name == name.as_str() && r.state == VmState::Running)
        {
            self.execute(
                "stop",
                strings(&["stop", "--timeout", "30", name.as_str()]),
                None,
                Duration::from_secs(40),
            )
            .await?;
        }
        if self
            .inventory()
            .await?
            .iter()
            .any(|r| r.name == name.as_str() && r.state == VmState::Running)
        {
            return Err(TartError::Failed {
                operation: "stop verification",
                exit_code: None,
                signal: None,
            });
        }
        Ok(())
    }
    pub async fn delete(&self, name: &OwnedVmName) -> Result<(), TartError> {
        // Hold any existing lease while deleting so an unfinished clone can
        // never publish a VM after cleanup has already reported absence.
        let lease = self.acquire_clone_lease(name, false)?;
        if let Some(vm) = self
            .inventory()
            .await?
            .iter()
            .find(|r| r.name == name.as_str())
        {
            if vm.state == VmState::Running {
                return Err(TartError::Failed {
                    operation: "delete running VM",
                    exit_code: None,
                    signal: None,
                });
            }
            self.execute(
                "delete",
                strings(&["delete", name.as_str()]),
                None,
                Duration::from_secs(120),
            )
            .await?;
        }
        if self
            .inventory()
            .await?
            .iter()
            .any(|r| r.name == name.as_str())
        {
            return Err(TartError::Failed {
                operation: "delete verification",
                exit_code: None,
                signal: None,
            });
        }
        if let Some(lease) = lease {
            lease.remove()?;
        }
        Ok(())
    }
    /// Sends the credential only on stdin. Unknown delivery outcomes must never be replayed.
    pub async fn bootstrap(&self, name: &OwnedVmName, jit: &[u8]) -> Result<(), TartError> {
        if jit.is_empty() || jit.len() > MAX_JIT_BYTES {
            return Err(TartError::Configuration);
        }
        self.execute(
            "guest submit",
            strings(&[
                "exec",
                "-i",
                name.as_str(),
                GUEST_HELPER,
                "submit",
                name.attempt_id(),
            ]),
            Some(jit),
            Duration::from_secs(30),
        )
        .await?;
        Ok(())
    }
    pub async fn guest_status(&self, name: &OwnedVmName) -> Result<GuestStatus, TartError> {
        let bytes = self
            .execute(
                "guest status",
                strings(&["exec", name.as_str(), GUEST_HELPER, "status"]),
                None,
                Duration::from_secs(15),
            )
            .await?;
        let status: GuestStatus =
            serde_json::from_slice(&bytes).map_err(|_| TartError::GuestStatus)?;
        status
            .validate(Some(name.attempt_id()))
            .map_err(|_| TartError::GuestStatus)?;
        Ok(status)
    }
}
impl TartError {
    /// For failed short operations in this process only. Does not establish VM
    /// absence, cleanup success, or termination of a pre-restart operation.
    pub fn short_command_terminated(&self) -> bool {
        !matches!(
            self,
            Self::TerminationUnconfirmed(_) | Self::CloneLeaseBusy | Self::CloneLeaseInvalid
        )
    }
}
struct CloneLease {
    file: File,
    directory: File,
    filename: String,
}
impl CloneLease {
    /// Only for a fresh observation lock that was never delegated to a native
    /// command. Unlock before dropping so an unrelated concurrent fork cannot
    /// keep this probe's transient lock alive until its exec boundary.
    fn release_probe(self) -> Result<(), TartError> {
        self.file
            .unlock()
            .map_err(|e| io_error("operation lease probe unlock", e))
    }
    fn remove(self) -> Result<(), TartError> {
        let metadata = self
            .file
            .metadata()
            .map_err(|e| io_error("clone lease cleanup metadata", e))?;
        let current = File::from(
            rustix::fs::openat(
                &self.directory,
                self.filename.as_str(),
                rustix::fs::OFlags::RDONLY
                    | rustix::fs::OFlags::NOFOLLOW
                    | rustix::fs::OFlags::NONBLOCK
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::empty(),
            )
            .map_err(|_| TartError::CloneLeaseInvalid)?,
        )
        .metadata()
        .map_err(|_| TartError::CloneLeaseInvalid)?;
        if current.ino() != metadata.ino() || current.dev() != metadata.dev() {
            return Err(TartError::CloneLeaseInvalid);
        }
        rustix::fs::unlinkat(
            &self.directory,
            self.filename.as_str(),
            rustix::fs::AtFlags::empty(),
        )
        .map_err(|_| TartError::CloneLeaseInvalid)?;
        self.directory
            .sync_all()
            .map_err(|e| io_error("clone lease cleanup sync", e))?;
        Ok(())
    }
}
fn clone_lease_filename(name: &OwnedVmName) -> String {
    format!(".{}.clone.lock", name.as_str())
}
fn open_clone_lease_directory(path: &Path) -> Result<File, TartError> {
    let directory = File::from(
        rustix::fs::open(
            path,
            rustix::fs::OFlags::RDONLY
                | rustix::fs::OFlags::DIRECTORY
                | rustix::fs::OFlags::NOFOLLOW
                | rustix::fs::OFlags::CLOEXEC,
            rustix::fs::Mode::empty(),
        )
        .map_err(|_| TartError::CloneLeaseInvalid)?,
    );
    let metadata = directory
        .metadata()
        .map_err(|_| TartError::CloneLeaseInvalid)?;
    if !metadata.is_dir()
        || metadata.uid() != rustix::process::geteuid().as_raw()
        || metadata.mode() & 0o7777 != 0o700
    {
        return Err(TartError::CloneLeaseInvalid);
    }
    Ok(directory)
}
fn io_error(operation: &'static str, error: std::io::Error) -> TartError {
    TartError::Io {
        operation,
        kind: error.kind(),
    }
}
fn missing_pipe(operation: &'static str) -> TartError {
    TartError::Io {
        operation,
        kind: std::io::ErrorKind::Other,
    }
}
fn trusted_file_path(path: &Path) -> Result<std::fs::Metadata, TartError> {
    // Check the original path, including symlink ownership and every parent;
    // checking only the resolved target permits replacement of a writable link.
    for component in path.ancestors() {
        let metadata =
            std::fs::symlink_metadata(component).map_err(|e| io_error("helper metadata", e))?;
        if !protected_executable_component(
            component,
            metadata.uid(),
            metadata.mode(),
            metadata.is_dir(),
            metadata.file_type().is_symlink(),
        ) {
            return Err(TartError::Helper(
                "executable path is not root-owned and protected from writes",
            ));
        }
    }
    let canonical =
        std::fs::canonicalize(path).map_err(|e| io_error("helper canonical path", e))?;
    for component in canonical.ancestors() {
        let metadata = std::fs::symlink_metadata(component)
            .map_err(|e| io_error("helper canonical metadata", e))?;
        if !protected_executable_component(
            component,
            metadata.uid(),
            metadata.mode(),
            metadata.is_dir(),
            false,
        ) {
            return Err(TartError::Helper(
                "resolved executable path is not root-owned and protected from writes",
            ));
        }
    }
    let metadata =
        std::fs::metadata(canonical).map_err(|e| io_error("helper executable metadata", e))?;
    if !metadata.is_file() {
        return Err(TartError::Helper("reviewed artifact is not a regular file"));
    }
    Ok(metadata)
}
pub(crate) fn trusted_executable(path: &Path, setuid: bool) -> Result<(), TartError> {
    let metadata = trusted_file_path(path)?;
    if metadata.mode() & 0o111 == 0 || (setuid && metadata.mode() & 0o4000 == 0) {
        return Err(TartError::Helper(
            "reviewed executable is missing executable or required setuid mode",
        ));
    }
    Ok(())
}
fn open_runner_archive(path: &Path) -> Result<File, TartError> {
    let metadata = trusted_file_path(path)?;
    if metadata.len() == 0 || metadata.len() > MAX_RUNNER_ARCHIVE_BYTES {
        return Err(TartError::Configuration);
    }
    File::open(path).map_err(|e| io_error("runner archive open", e))
}
fn protected_executable_component(
    path: &Path,
    uid: u32,
    mode: u32,
    directory: bool,
    symlink: bool,
) -> bool {
    if uid != 0 {
        return false;
    }
    if symlink || mode & 0o022 == 0 {
        return true;
    }
    // The multi-user Nix store is root:nixbld 1775 on the target Mac. Its sticky
    // bit prevents group members from removing/replacing root-owned store entries.
    // Every selected entry and descendant is still checked above for root owner
    // and no group/other writes. This exception applies only to this exact directory.
    path == Path::new("/nix/store") && directory && mode & 0o7777 == 0o1775
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BootFailureCategory {
    DiagnosticsDisabled,
    CleanExit,
    Keychain,
    Entitlement,
    NetworkHelper,
    Permission,
    Storage,
    MissingDependency,
    ResourceBusy,
    Virtualization,
    Terminated,
    Unknown,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct BootDiagnostic {
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,
    pub category: BootFailureCategory,
    pub capture_complete: bool,
    pub capture_truncated: bool,
    pub capture_failed: bool,
}
#[derive(Default)]
struct StartupCapture {
    bytes: Vec<u8>,
    complete: bool,
    truncated: bool,
    failed: bool,
}
async fn capture_startup(
    mut stderr: impl AsyncRead + Unpin,
    mut file: File,
    state: Arc<Mutex<StartupCapture>>,
) {
    use std::io::Write;
    let mut buffer = [0u8; 4096];
    loop {
        let n = match stderr.read(&mut buffer).await {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => {
                if let Ok(mut state) = state.lock() {
                    state.failed = true;
                }
                break;
            }
        };
        if let Ok(mut state) = state.lock() {
            let keep = n.min(STARTUP_DIAGNOSTIC_LIMIT.saturating_sub(state.bytes.len()));
            state.bytes.extend_from_slice(&buffer[..keep]);
            state.truncated |= keep < n;
            if keep > 0 && file.write_all(&buffer[..keep]).is_err() {
                state.failed = true;
            }
        }
    }
    let synced = file.sync_all().is_ok();
    if let Ok(mut state) = state.lock() {
        state.complete = true;
        state.failed |= !synced;
    }
}
fn boot_category(bytes: &[u8], signal: Option<i32>) -> BootFailureCategory {
    let text = String::from_utf8_lossy(bytes).to_ascii_lowercase();
    let any = |terms: &[&str]| terms.iter().any(|term| text.contains(term));
    if any(&["keychain", "errsec", "securityd"]) {
        BootFailureCategory::Keychain
    } else if any(&["entitlement", "code signature", "provisioning profile"]) {
        BootFailureCategory::Entitlement
    } else if any(&["softnet", "vmnet"]) {
        BootFailureCategory::NetworkHelper
    } else if any(&[
        "permission denied",
        "operation not permitted",
        "not authorized",
        "authorization",
    ]) {
        BootFailureCategory::Permission
    } else if any(&["no space left", "disk full"]) {
        BootFailureCategory::Storage
    } else if any(&["no such file", "not found"]) {
        BootFailureCategory::MissingDependency
    } else if any(&["resource busy", "already running", "locked"]) {
        BootFailureCategory::ResourceBusy
    } else if any(&[
        "virtualization",
        "vzerrordomain",
        "virtual machine",
        "failed to start",
    ]) {
        BootFailureCategory::Virtualization
    } else if signal.is_some() {
        BootFailureCategory::Terminated
    } else {
        BootFailureCategory::Unknown
    }
}
pub struct RunningVm {
    child: Child,
    startup: Option<Arc<Mutex<StartupCapture>>>,
}
impl RunningVm {
    /// Stop only this retained child and confirm that it has been reaped before
    /// cleanup trusts disk metadata. No PID lookup or process-group signal is used.
    pub async fn terminate_and_reap(&mut self) -> Result<(), TartError> {
        match self.child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(_) => return Err(TartError::TerminationUnconfirmed("terminate owned VM")),
        }
        // A concurrent natural exit can make start_kill fail; wait is still the
        // authority for whether this exact child has ended.
        let _ = self.child.start_kill();
        match timeout(Duration::from_secs(10), self.child.wait()).await {
            Ok(Ok(_)) => Ok(()),
            _ => Err(TartError::TerminationUnconfirmed("terminate owned VM")),
        }
    }
    #[cfg(test)]
    pub(crate) fn from_test_child(child: Child) -> Self {
        Self {
            child,
            startup: None,
        }
    }
    pub fn exited(&mut self) -> Result<bool, TartError> {
        self.child
            .try_wait()
            .map(|s| s.is_some())
            .map_err(|e| io_error("run status", e))
    }
    pub fn process_id(&self) -> Option<u32> {
        self.child.id()
    }
    /// Safe to log: contains categories/status only, never native output bytes.
    pub fn exit_diagnostic(&mut self) -> Result<Option<BootDiagnostic>, TartError> {
        let Some(exit) = self
            .child
            .try_wait()
            .map_err(|e| io_error("run status", e))?
        else {
            return Ok(None);
        };
        let capture = self.startup.as_ref().and_then(|state| state.lock().ok());
        Ok(Some(BootDiagnostic {
            exit_code: exit.code(),
            signal: exit.signal(),
            category: if exit.success() {
                BootFailureCategory::CleanExit
            } else if let Some(capture) = &capture {
                boot_category(&capture.bytes, exit.signal())
            } else {
                BootFailureCategory::DiagnosticsDisabled
            },
            capture_complete: capture.as_ref().is_some_and(|s| s.complete),
            capture_truncated: capture.as_ref().is_some_and(|s| s.truncated),
            capture_failed: self.startup.is_some() && capture.as_ref().is_none_or(|s| s.failed),
        }))
    }
}
pub fn run_arguments(name: &OwnedVmName) -> Vec<String> {
    let mut args = strings(&[
        "run",
        "--no-graphics",
        "--no-clipboard",
        "--no-audio",
        "--no-usb-accessories",
        "--net-softnet",
    ]);
    args.push(format!("--net-softnet-block={SOFTNET_BLOCK}"));
    args.push(name.as_str().into());
    args
}
fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|v| (*v).into()).collect()
}
fn guest_exec_arguments(name: &OwnedVmName, args: &[&str], interactive: bool) -> Vec<String> {
    let mut result = vec!["exec".into()];
    if interactive {
        result.push("-i".into());
    }
    result.push(name.as_str().into());
    result.extend(strings(args));
    result
}
fn read_guest_helper(path: &Path) -> Result<Vec<u8>, TartError> {
    use std::io::Read;
    let file = File::open(path).map_err(|e| io_error("guest helper read", e))?;
    let metadata = file
        .metadata()
        .map_err(|e| io_error("guest helper metadata", e))?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_GUEST_HELPER_BYTES {
        return Err(TartError::Configuration);
    }
    let mut bytes = Vec::new();
    file.take(MAX_GUEST_HELPER_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| io_error("guest helper read", e))?;
    if bytes.is_empty() || bytes.len() as u64 > MAX_GUEST_HELPER_BYTES {
        return Err(TartError::Configuration);
    }
    Ok(bytes)
}
pub use crate::config::valid_image_digest;
async fn read_bounded(mut stream: impl AsyncRead + Unpin) -> std::io::Result<(Vec<u8>, bool)> {
    let mut result = Vec::new();
    let mut oversized = false;
    let mut buffer = [0; 4096];
    loop {
        let n = stream.read(&mut buffer).await?;
        if n == 0 {
            break;
        }
        let keep = n.min(OUTPUT_LIMIT.saturating_sub(result.len()));
        result.extend_from_slice(&buffer[..keep]);
        oversized |= keep < n;
    }
    Ok((result, oversized))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    #[test]
    fn inventory_contract() {
        let valid =
            br#"[{"Source":"local","Name":"base","State":"stopped","Running":false,"Size":12.5}]"#;
        assert_eq!(parse_inventory(valid).unwrap()[0].state, VmState::Stopped);
        for bad in [br#"[{"Source":"local","Name":"base","State":"new","Running":false}]"#.as_slice(),br#"[{"Source":"local","Name":"base","State":"running","Running":false}]"#,br#"[{"Source":"local","Name":"a","State":"stopped","Running":false},{"Source":"local","Name":"a","State":"stopped","Running":false}]"#] { assert!(parse_inventory(bad).is_err()); }
    }
    #[test]
    fn exact_ownership_and_reviewed_arguments() {
        let name = OwnedVmName::parse("homelab-job-0123456789abcdef0123456789abcdef").unwrap();
        assert_eq!(name.attempt_id(), "0123456789abcdef0123456789abcdef");
        for bad in [
            "base",
            "homelab-job-abc",
            "homelab-job-0123456789abcdef0123456789abcdef;id",
        ] {
            assert!(OwnedVmName::parse(bad).is_err());
        }
        let args = run_arguments(&name);
        assert!(args.contains(&"--net-softnet".into()));
        assert!(
            args.iter()
                .all(|a| !a.contains("--dir") && !a.contains("--net-bridged"))
        );
        assert_eq!(args.last().unwrap(), name.as_str());
        assert!(valid_image_digest(&format!(
            "ghcr.io/org/image@sha256:{}",
            "a".repeat(64)
        )));
        assert!(!valid_image_digest("ghcr.io/org/image:latest"));
    }
    #[tokio::test]
    async fn output_is_bounded_but_drained() {
        let bytes = vec![b'x'; OUTPUT_LIMIT + 50];
        let (out, truncated) = read_bounded(bytes.as_slice()).await.unwrap();
        assert_eq!(out.len(), OUTPUT_LIMIT);
        assert!(truncated);
    }
    #[tokio::test]
    async fn explicit_startup_capture_is_bounded_and_typed_diagnostic_never_echoes_bytes() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("startup.log");
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        let state = Arc::new(Mutex::new(StartupCapture::default()));
        let mut bytes = b"Softnet: operation not permitted; PRIVATE_SENTINEL\n".to_vec();
        bytes.resize(STARTUP_DIAGNOSTIC_LIMIT + 4096, b'x');
        capture_startup(bytes.as_slice(), file, Arc::clone(&state)).await;
        {
            let snapshot = state.lock().unwrap();
            assert!(snapshot.complete && snapshot.truncated && !snapshot.failed);
            assert_eq!(snapshot.bytes.len(), STARTUP_DIAGNOSTIC_LIMIT);
        }
        assert_eq!(
            std::fs::metadata(path).unwrap().len(),
            STARTUP_DIAGNOSTIC_LIMIT as u64
        );
        let mut child = Command::new("/usr/bin/false")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child.wait().await.unwrap();
        let mut handle = RunningVm {
            child,
            startup: Some(state),
        };
        let diagnostic = handle.exit_diagnostic().unwrap().unwrap();
        assert_eq!(diagnostic.exit_code, Some(1));
        assert_eq!(diagnostic.category, BootFailureCategory::NetworkHelper);
        assert!(diagnostic.capture_complete && diagnostic.capture_truncated);
        assert!(
            !format!(
                "{diagnostic:?} {}",
                serde_json::to_string(&diagnostic).unwrap()
            )
            .contains("PRIVATE_SENTINEL")
        );
    }
    #[test]
    fn native_startup_error_categories_are_safe_and_specific() {
        assert_eq!(
            boot_category(
                b"failed to open keychain: errSecInteractionNotAllowed",
                None
            ),
            BootFailureCategory::Keychain
        );
        assert_eq!(
            boot_category(b"missing virtualization entitlement", None),
            BootFailureCategory::Entitlement
        );
        assert_eq!(
            boot_category(b"VZErrorDomain: Failed to start virtual machine", None),
            BootFailureCategory::Virtualization
        );
        assert_eq!(
            boot_category(b"arbitrary private native message", Some(9)),
            BootFailureCategory::Terminated
        );
    }
    #[tokio::test]
    async fn terminate_and_reap_only_stops_the_retained_child() {
        let child = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut unrelated = Command::new("/bin/sleep")
            .arg("30")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut owned = RunningVm::from_test_child(child);
        assert!(!owned.exited().unwrap());
        owned.terminate_and_reap().await.unwrap();
        assert!(owned.exited().unwrap());
        assert!(
            unrelated.try_wait().unwrap().is_none(),
            "an unrelated child must remain running"
        );
        unrelated.kill().await.unwrap();
        owned.terminate_and_reap().await.unwrap(); // Already reaped is idempotent.
    }
    #[tokio::test]
    async fn terminate_and_reap_accepts_a_naturally_exited_child() {
        let mut child = Command::new("/usr/bin/true")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        child.wait().await.unwrap();
        let mut owned = RunningVm::from_test_child(child);
        owned.terminate_and_reap().await.unwrap();
        assert_eq!(owned.exit_diagnostic().unwrap().unwrap().exit_code, Some(0));
    }
    fn adapter(binary: &str) -> Tart {
        Tart::new(TartConfig {
            binary: binary.into(),
            home: "/nonexistent/homelab-test-home".into(),
            tart_home: "/nonexistent/homelab-test-tart".into(),
            helper_directory: "/reviewed/helpers".into(),
            guest_helper: "/usr/bin/true".into(),
            runner_archive: "/usr/bin/true".into(),
            runner_version: "2.338.2".into(),
        })
        .unwrap()
    }
    #[tokio::test]
    async fn child_environment_is_explicit_and_failures_do_not_echo_output() {
        let bytes = adapter("/usr/bin/env")
            .execute("test environment", vec![], None, Duration::from_secs(2))
            .await
            .unwrap();
        let output = String::from_utf8(bytes).unwrap();
        assert_eq!(output.lines().count(), 4);
        for line in output.lines() {
            assert!(
                line.starts_with("HOME=")
                    || line.starts_with("TART_HOME=")
                    || line.starts_with("PATH=")
                    || line.starts_with("TART_NO_AUTO_PRUNE=")
            );
        }
        let error = adapter("/usr/bin/false")
            .execute(
                "safe operation",
                vec!["JIT_SENTINEL_MUST_NOT_APPEAR".into()],
                None,
                Duration::from_secs(2),
            )
            .await
            .unwrap_err();
        assert!(!format!("{error:?} {error}").contains("JIT_SENTINEL"));
    }
    #[tokio::test]
    async fn deadline_kills_waiting_process() {
        let start = std::time::Instant::now();
        let error = adapter("/bin/sleep")
            .execute(
                "test sleep",
                vec!["20".into()],
                None,
                Duration::from_millis(20),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, TartError::Timeout("test sleep")));
        assert!(start.elapsed() < Duration::from_secs(2));
    }
    #[test]
    fn exec_arguments_are_literal_and_never_use_shell() {
        let adapter = adapter("/reviewed/tart.app/Contents/MacOS/tart");
        let args = strings(&[
            "exec",
            "-i",
            "homelab-job-0123456789abcdef0123456789abcdef",
            GUEST_HELPER,
            "submit",
            "0123456789abcdef0123456789abcdef",
        ]);
        let command = adapter.command(&args);
        assert_eq!(
            command.as_std().get_program(),
            "/reviewed/tart.app/Contents/MacOS/tart"
        );
        assert_eq!(
            command.as_std().get_args().collect::<Vec<_>>(),
            args.iter().map(std::ffi::OsStr::new).collect::<Vec<_>>()
        );
    }
    #[tokio::test]
    async fn resource_policy_rejects_before_creating_any_vm() {
        let adapter = adapter("/does/not/exist");
        let name = OwnedVmName::parse("homelab-job-0123456789abcdef0123456789abcdef").unwrap();
        let image = format!("ghcr.io/org/image@sha256:{}", "a".repeat(64));
        for (cpu, memory) in [(0, 8192), (9, 8192), (4, 0), (4, 16385)] {
            assert!(matches!(
                adapter.clone_vm(&image, &name, cpu, memory).await,
                Err(TartError::Configuration)
            ));
        }
    }
    #[test]
    fn helper_preflight_refuses_user_owned_or_missing_privilege() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("softnet");
        std::fs::write(&file, "fixture").unwrap();
        assert!(trusted_executable(&file, true).is_err());
        assert!(SOFTNET_BLOCK.ends_with(",in 0.0.0.0/0"));
    }
    #[test]
    fn nix_store_sticky_boundary_preserves_readonly_root_entry_checks() {
        let fixture = [
            ("/nix/store/abc-tart/bin/tart", 0, 0o555, false),
            ("/nix/store/abc-tart/bin", 0, 0o555, true),
            ("/nix/store/abc-tart", 0, 0o555, true),
            ("/nix/store", 0, 0o1775, true),
            ("/nix", 0, 0o755, true),
            ("/", 0, 0o755, true),
        ];
        assert!(
            fixture
                .iter()
                .all(|(path, uid, mode, dir)| protected_executable_component(
                    Path::new(path),
                    *uid,
                    *mode,
                    *dir,
                    false
                ))
        );
        for (path, uid, mode, dir) in [
            ("/nix/store", 0, 0o775, true),
            ("/nix/store", 0, 0o1777, true),
            ("/nix/store", 501, 0o1775, true),
            ("/nix/store", 0, 0o1775, false),
            ("/arbitrary/store", 0, 0o1775, true),
            ("/nix/store/abc-tart", 0, 0o775, true),
            ("/nix/store/abc-tart", 501, 0o555, true),
            ("/var/lib/homelab-runner-helpers", 0, 0o1775, true),
        ] {
            assert!(
                !protected_executable_component(Path::new(path), uid, mode, dir, false),
                "unexpected trust: {path}"
            );
        }
    }
    fn lease_adapter(home: &Path, binary: &Path) -> Tart {
        Tart::new(TartConfig {
            binary: binary.into(),
            home: home.into(),
            tart_home: home.into(),
            helper_directory: "/reviewed/helpers".into(),
            guest_helper: "/usr/bin/true".into(),
            runner_archive: "/usr/bin/true".into(),
            runner_version: "2.338.2".into(),
        })
        .unwrap()
    }
    fn lease_directory() -> tempfile::TempDir {
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        directory
    }
    fn lease_name() -> OwnedVmName {
        OwnedVmName::parse("homelab-job-0123456789abcdef0123456789abcdef").unwrap()
    }
    fn prepare_fixture(directory: &Path) -> Tart {
        let quote = |name: &str| {
            format!(
                "'{}'",
                directory
                    .join(name)
                    .to_string_lossy()
                    .replace('\'', "'\\''")
            )
        };
        let ready = serde_json::to_string(&GuestStatus {
            schema: 1,
            attempt_id: None,
            phase: GuestPhase::Ready,
            updated_at: 1,
            exit_code: None,
            reason: None,
        })
        .unwrap();
        let claimed = serde_json::to_string(&GuestStatus {
            schema: 1,
            attempt_id: Some(lease_name().attempt_id().into()),
            phase: GuestPhase::Accepted,
            updated_at: 1,
            exit_code: None,
            reason: None,
        })
        .unwrap();
        let script = format!(
            r#"#!/bin/sh
printf '%s\n' "$*" >> {events}
if [ "$3" = /usr/bin/id ]; then printf '501\n'; exit 0; fi
if [ "$3" = /usr/local/libexec/homelab-runner-guest ]; then
  if [ -f {ready_file} ]; then printf '%s' '{ready}'; exit 0; fi
  if [ -f {claimed_file} ]; then printf '%s' '{claimed}'; exit 0; fi
  exit 127
fi
if [ "$3" = /usr/bin/sudo ] && [ "$5" = /usr/bin/id ]; then printf '0\n'; exit 0; fi
if [ "$3" = /usr/bin/sudo ] && [ "$5" = /bin/test ]; then
  if [ "$7" = /Users/admin/actions-runner/.runner ] && [ -f {registered} ]; then exit 0; fi
  if [ -f {unreadable} ]; then exit 0; else exit 1; fi
fi
if [ "$3" = /Users/admin/actions-runner/bin/Runner.Listener ]; then
  if [ -f {sdk_ready} ] && [ ! -f {sdk_mismatch} ]; then printf '2.338.2\n'; else printf '2.334.0\n'; fi
  exit 0
fi
if [ "$5" = /usr/sbin/networksetup ] && [ -f {dns_failure} ]; then exit 1; fi
if [ "$2" = -i ] && [ "$4" = /usr/bin/tar ]; then
  /bin/cat > {archive}
  /usr/bin/touch {sdk_ready}
  exit 0
fi
if [ "$2" = -i ]; then
  if [ "$7" = of=/Library/LaunchDaemons/org.homelab.runner-guest.plist ]; then /bin/cat > {plist}; else /bin/cat > {binary}; fi
  exit 0
fi
if [ "$5" = /bin/launchctl ]; then /usr/bin/touch {ready_file}; fi
exit 0
"#,
            events = quote("events"),
            ready_file = quote("ready"),
            claimed_file = quote("claimed"),
            unreadable = quote("unreadable-claim"),
            dns_failure = quote("dns-failure"),
            registered = quote("runner-registered"),
            sdk_ready = quote("sdk-ready"),
            sdk_mismatch = quote("sdk-mismatch"),
            archive = quote("received-runner-archive"),
            plist = quote("received-plist"),
            binary = quote("received-binary")
        );
        let executable = directory.join("tart-fixture");
        std::fs::write(&executable, script).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o700)).unwrap();
        lease_adapter(directory, &executable)
    }
    #[tokio::test]
    async fn linux_preparation_uses_baked_elf_helper_systemd_and_linux_identity() {
        let directory = lease_directory();
        let mut tart = prepare_fixture(directory.path());
        tart.platform = crate::config::Platform::LinuxArm64;
        let script = std::fs::read_to_string(&tart.config.binary).unwrap()
            .replace("printf '501\\n'", "printf '1000\\n'")
            .replace("/Users/admin/actions-runner", "/home/admin/actions-runner")
            .replace("if [ \"$3\" = /usr/bin/id ];", "if [ \"$3\" = /usr/bin/printenv ]; then printf '/home/admin\\n'; exit 0; fi\nif [ \"$3\" = /usr/bin/uname ]; then printf 'aarch64\\n'; exit 0; fi\nif [ \"$3\" = /usr/bin/id ];")
            .replace("if [ \"$3\" = /usr/local/libexec/homelab-runner-guest ]; then", "if [ \"$3\" = /usr/local/libexec/homelab-runner-guest ] && [ \"$4\" = --version ]; then printf 'homelab-runner 0.1.0\\n'; exit 0; fi\nif [ \"$3\" = /usr/local/libexec/homelab-runner-guest ]; then")
            .replace("if [ \"$5\" = /bin/launchctl ];", "if [ \"$5\" = /usr/bin/systemctl ] && [ \"$6\" = start ];");
        std::fs::write(&tart.config.binary, &script).unwrap();
        tart.prepare_guest(&lease_name(), Duration::from_secs(3))
            .await
            .unwrap();
        let events = std::fs::read_to_string(directory.path().join("events")).unwrap();
        assert!(events.contains("/usr/bin/systemctl start homelab-runner-guest.service"));
        assert!(events.contains("/usr/bin/tar -xzf - -C /home/admin/actions-runner"));
        assert!(
            !events.contains("scutil")
                && !events.contains("launchctl")
                && !events.contains("networksetup")
        );
        assert!(!events.contains("of=/usr/local/libexec/homelab-runner-guest"));
        tart.prepare_guest(&lease_name(), Duration::from_secs(3))
            .await
            .unwrap();
        let bad = script.replace("printf '1000\\n'", "printf '1001\\n'");
        std::fs::write(&tart.config.binary, bad).unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                .await,
            Err(TartError::GuestIdentity)
        ));
    }
    #[tokio::test]
    async fn public_guest_preparation_uses_fixed_commands_and_independent_service() {
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        let name = lease_name();
        tart.prepare_guest(&name, Duration::from_secs(3))
            .await
            .unwrap();
        assert_eq!(
            std::fs::read(directory.path().join("received-binary")).unwrap(),
            std::fs::read("/usr/bin/true").unwrap()
        );
        assert_eq!(
            std::fs::read_to_string(directory.path().join("received-plist")).unwrap(),
            GUEST_SERVICE_PLIST
        );
        assert!(GUEST_SERVICE_PLIST.contains(
            "<string>--runner</string><string>/Users/admin/actions-runner/run.sh</string>"
        ));
        assert_eq!(
            std::fs::read(directory.path().join("received-runner-archive")).unwrap(),
            std::fs::read("/usr/bin/true").unwrap()
        );
        let events = std::fs::read_to_string(directory.path().join("events")).unwrap();
        assert!(events.contains("exec -i homelab-job-0123456789abcdef0123456789abcdef /usr/bin/sudo -n /bin/dd of=/usr/local/libexec/homelab-runner-guest"));
        assert!(events.contains("/usr/bin/sudo -n /bin/launchctl bootstrap system /Library/LaunchDaemons/org.homelab.runner-guest.plist"));
        let dns_command = format!(
            "exec {} /usr/bin/sudo -n /usr/sbin/networksetup -setdnsservers Ethernet 1.1.1.1 9.9.9.9",
            name.as_str()
        );
        let dns = events
            .find(&dns_command)
            .expect("fixed native public DNS command");
        assert!(events.find("/usr/bin/sudo -n /usr/bin/id -u").unwrap() < dns);
        assert!(
            dns < events.find("/usr/bin/install -d").unwrap(),
            "DNS must be configured before installing/starting the Ready service"
        );
        let archive_command = format!(
            "exec -i {} /usr/bin/tar -xzf - -C /Users/admin/actions-runner",
            name.as_str()
        );
        let archive = events
            .find(&archive_command)
            .expect("official archive extracted as UID501 without sudo");
        assert!(dns < archive && archive < events.find("/usr/bin/install -d").unwrap());
        assert!(
            !events.contains("/bin/sh")
                && !events.contains(" -c ")
                && !events.contains("JITCONFIG")
        );
        let before = events.lines().count();
        tart.prepare_guest(&name, Duration::from_secs(3))
            .await
            .unwrap();
        let after = std::fs::read_to_string(directory.path().join("events")).unwrap();
        assert_eq!(
            after.lines().count(),
            before + 11,
            "Ready preparation must enforce DNS and verify SDK without rewriting service files"
        );
        assert_eq!(
            after.lines().skip(before).collect::<Vec<_>>(),
            vec![
                format!("exec {} /usr/bin/id -u", name.as_str()),
                format!("exec {} {} status", name.as_str(), GUEST_HELPER),
                format!("exec {} /usr/bin/sudo -n /usr/bin/id -u", name.as_str()),
                format!(
                    "exec {} /usr/bin/sudo -n /bin/test -e /Users/admin/actions-runner/.runner",
                    name.as_str()
                ),
                format!(
                    "exec {} /usr/bin/sudo -n /bin/test -e /Users/admin/actions-runner/.credentials",
                    name.as_str()
                ),
                format!(
                    "exec {} /usr/bin/sudo -n /bin/test -e /Users/admin/actions-runner/.credentials_rsaparams",
                    name.as_str()
                ),
                dns_command,
                format!(
                    "exec {} /usr/bin/sudo -n /usr/sbin/scutil --set ComputerName {}",
                    name.as_str(),
                    name.as_str()
                ),
                format!(
                    "exec {} /usr/bin/sudo -n /usr/sbin/scutil --set LocalHostName {}",
                    name.as_str(),
                    name.as_str()
                ),
                format!(
                    "exec {} /usr/bin/sudo -n /usr/sbin/scutil --set HostName {}",
                    name.as_str(),
                    name.as_str()
                ),
                format!(
                    "exec {} /Users/admin/actions-runner/bin/Runner.Listener --version",
                    name.as_str()
                ),
            ]
        );
    }
    #[tokio::test]
    async fn public_preparation_refuses_claims_wrong_identity_and_expired_deadline() {
        for marker in ["claimed", "unreadable-claim"] {
            let directory = lease_directory();
            let tart = prepare_fixture(directory.path());
            std::fs::write(directory.path().join(marker), b"").unwrap();
            assert!(matches!(
                tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                    .await,
                Err(TartError::GuestAlreadyClaimed)
            ));
            assert!(!directory.path().join("received-binary").exists());
            let events = std::fs::read_to_string(directory.path().join("events")).unwrap();
            assert!(
                !events.contains("/usr/sbin/networksetup"),
                "claimed or unreadable existing state must be rejected before DNS mutation"
            );
        }
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        let fixture = directory.path().join("tart-fixture");
        let source = std::fs::read_to_string(&fixture)
            .unwrap()
            .replace("printf '501\\n'", "printf '502\\n'");
        std::fs::write(&fixture, source).unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                .await,
            Err(TartError::GuestIdentity)
        ));
        assert!(!directory.path().join("received-binary").exists());
        std::fs::remove_file(directory.path().join("events")).unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::ZERO).await,
            Err(TartError::Timeout("prepare guest"))
        ));
        assert!(!directory.path().join("events").exists());
        let tart = lease_adapter(directory.path(), Path::new("/usr/bin/false"));
        let started = std::time::Instant::now();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_millis(20))
                .await,
            Err(TartError::TerminationUnconfirmed("prepare guest"))
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    #[tokio::test]
    async fn guest_dns_failure_blocks_new_and_already_ready_preparation() {
        for already_ready in [false, true] {
            let directory = lease_directory();
            let tart = prepare_fixture(directory.path());
            if already_ready {
                std::fs::write(directory.path().join("ready"), b"").unwrap();
            }
            std::fs::write(directory.path().join("dns-failure"), b"").unwrap();
            assert!(matches!(
                tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                    .await,
                Err(TartError::Failed {
                    operation: "guest public DNS",
                    exit_code: Some(1),
                    ..
                })
            ));
            assert!(!directory.path().join("received-binary").exists());
            assert!(!directory.path().join("received-plist").exists());
        }
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        std::fs::write(directory.path().join("ready"), b"").unwrap();
        let fixture = directory.path().join("tart-fixture");
        let source = std::fs::read_to_string(&fixture)
            .unwrap()
            .replace("printf '0\\n'", "printf '501\\n'");
        std::fs::write(&fixture, source).unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                .await,
            Err(TartError::GuestIdentity)
        ));
        assert!(
            !std::fs::read_to_string(directory.path().join("events"))
                .unwrap()
                .contains("/usr/sbin/networksetup")
        );
    }
    #[tokio::test]
    async fn sdk_upgrade_on_unclaimed_ready_guest_preserves_service_and_checks_final_version() {
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        std::fs::write(directory.path().join("ready"), b"").unwrap();
        tart.prepare_guest(&lease_name(), Duration::from_secs(3))
            .await
            .unwrap();
        assert!(directory.path().join("received-runner-archive").exists());
        assert!(
            !directory.path().join("received-binary").exists()
                && !directory.path().join("received-plist").exists()
        );
        let events = std::fs::read_to_string(directory.path().join("events")).unwrap();
        assert_eq!(events.matches("/usr/bin/tar -xzf - -C").count(), 1);
        assert_eq!(events.matches("Runner.Listener --version").count(), 2);
        assert!(!events.contains("launchctl"));
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        std::fs::write(directory.path().join("sdk-mismatch"), b"").unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                .await,
            Err(TartError::RunnerVersion)
        ));
        assert!(
            !directory.path().join("received-binary").exists()
                && !directory.path().join("received-plist").exists()
        );
    }
    #[tokio::test]
    async fn registered_runner_is_never_updated_or_reconfigured() {
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        std::fs::write(directory.path().join("ready"), b"").unwrap();
        std::fs::write(directory.path().join("runner-registered"), b"").unwrap();
        assert!(matches!(
            tart.prepare_guest(&lease_name(), Duration::from_secs(3))
                .await,
            Err(TartError::GuestAlreadyClaimed)
        ));
        let events = std::fs::read_to_string(directory.path().join("events")).unwrap();
        assert!(
            !events.contains("networksetup")
                && !events.contains("/usr/bin/tar")
                && !events.contains("/bin/dd")
        );
    }
    #[test]
    fn public_helper_upload_rejects_empty_and_oversized_files() {
        let directory = lease_directory();
        let path = directory.path().join("public-helper");
        let file = File::create(&path).unwrap();
        assert!(read_guest_helper(&path).is_err());
        file.set_len(MAX_GUEST_HELPER_BYTES + 1).unwrap();
        assert!(read_guest_helper(&path).is_err());
        drop(file);
        std::fs::write(&path, b"public executable fixture").unwrap();
        assert_eq!(
            read_guest_helper(&path).unwrap(),
            b"public executable fixture"
        );
    }
    #[tokio::test]
    async fn guest_agent_ready_uses_only_positive_exec_identity_without_inventory() {
        let directory = lease_directory();
        let tart = prepare_fixture(directory.path());
        let name = lease_name();
        assert!(tart.guest_agent_ready(&name).await.unwrap());
        assert_eq!(
            std::fs::read_to_string(directory.path().join("events")).unwrap(),
            format!("exec {} /usr/bin/id -u\n", name.as_str())
        );
        let fixture = directory.path().join("tart-fixture");
        let source = std::fs::read_to_string(&fixture)
            .unwrap()
            .replace("printf '501\\n'", "printf '0\\n'");
        let replacement = directory.path().join("tart-fixture-replacement");
        std::fs::write(&replacement, source).unwrap();
        std::fs::set_permissions(&replacement, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::rename(replacement, fixture).unwrap();
        assert!(matches!(
            tart.guest_agent_ready(&name).await,
            Err(TartError::GuestIdentity)
        ));
        assert!(
            lease_adapter(directory.path(), Path::new("/usr/bin/false"))
                .guest_agent_ready(&name)
                .await
                .is_err()
        );
    }
    #[test]
    fn clone_lease_before_spawn_is_recoverable_and_held_operations_block() {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/bin/sleep"));
        let name = lease_name();
        assert!(tart.clone_operation_finished(&name).unwrap());
        let lease = tart.acquire_clone_lease(&name, true).unwrap().unwrap();
        assert!(!tart.clone_operation_finished(&name).unwrap());
        assert!(matches!(
            tart.acquire_clone_lease(&name, true),
            Err(TartError::CloneLeaseBusy)
        ));
        drop(lease); // A controller crash before spawn leaves no child holding fd0.
        // Concurrent test-process fork/exec can briefly duplicate a CLOEXEC fd
        // until exec completes. The production probe conservatively waits too.
        for _ in 0..100 {
            if tart.clone_operation_finished(&name).unwrap() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(tart.clone_operation_finished(&name).unwrap());
        tart.acquire_clone_lease(&name, false)
            .unwrap()
            .unwrap()
            .remove()
            .unwrap();
        assert!(!directory.path().join(clone_lease_filename(&name)).exists());
        assert!(tart.clone_operation_finished(&name).unwrap());
    }
    #[test]
    fn quiescence_probe_unlocks_its_own_description_but_never_a_native_owner() {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/bin/sleep"));
        let name = lease_name();
        let probe = tart.acquire_clone_lease(&name, true).unwrap().unwrap();
        let temporary_fork_copy = probe.file.try_clone().unwrap();
        probe.release_probe().unwrap();
        assert!(
            tart.operation_finished(&name).unwrap(),
            "a probe must release its lock even while an incidental copy remains open"
        );
        let owner = tart.acquire_clone_lease(&name, true).unwrap().unwrap();
        let intended_child_copy = owner.file.try_clone().unwrap();
        drop(owner); // Native-owner parent drop still MUST NOT explicitly unlock.
        assert!(!tart.operation_finished(&name).unwrap());
        drop(temporary_fork_copy);
        assert!(
            !tart.operation_finished(&name).unwrap(),
            "closing an old probe copy must not release a different owner's lock"
        );
        intended_child_copy.unlock().unwrap(); // Test-only simulated child cleanup.
    }
    #[test]
    fn clone_lease_rejects_symlinks_hardlinks_and_shared_permissions() {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/bin/sleep"));
        let name = lease_name();
        let path = directory.path().join(clone_lease_filename(&name));
        let outside = directory.path().join("outside");
        std::fs::write(&outside, b"unchanged").unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();
        assert!(tart.clone_operation_finished(&name).is_err());
        std::fs::remove_file(&path).unwrap();
        let lease = tart.acquire_clone_lease(&name, true).unwrap().unwrap();
        drop(lease);
        let link = directory.path().join("hardlink");
        std::fs::hard_link(&path, &link).unwrap();
        assert!(tart.clone_operation_finished(&name).is_err());
        std::fs::remove_file(link).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        assert!(tart.clone_operation_finished(&name).is_err());
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(tart.clone_operation_finished(&name).unwrap());
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o750)).unwrap();
        assert!(tart.clone_operation_finished(&name).is_err());
        assert_eq!(std::fs::read(outside).unwrap(), b"unchanged");
    }
    #[tokio::test]
    async fn clone_and_set_share_one_parent_lease_and_cleanup_removes_it() {
        let directory = lease_directory();
        let fixture = directory.path().join("tart-fixture");
        let events = directory.path().join("events");
        // Retain stdin briefly after set exits, like a descendant or concurrent
        // fork holding the operation lease until its exec/exit boundary.
        std::fs::write(&fixture,format!("#!/bin/sh\nprintf '%s\\n' \"$1\" >> '{}'\nif [ \"$1\" = list ]; then printf '[]'; else /bin/sleep 0.05; fi\nif [ \"$1\" = set ]; then /bin/sleep 0.1 <&0 >/dev/null 2>&1 & fi\n",events.display())).unwrap();
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o700)).unwrap();
        let tart = lease_adapter(directory.path(), &fixture);
        let name = lease_name();
        let clone_tart = lease_adapter(directory.path(), &fixture);
        let clone_name = name.clone();
        let cloning = tokio::spawn(async move {
            clone_tart
                .clone_vm(
                    &format!("ghcr.io/org/image@sha256:{}", "a".repeat(64)),
                    &clone_name,
                    4,
                    8192,
                )
                .await
        });
        for _ in 0..100 {
            if directory.path().join(clone_lease_filename(&name)).exists() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
        assert!(!tart.clone_operation_finished(&name).unwrap());
        assert!(matches!(
            tart.delete(&name).await,
            Err(TartError::CloneLeaseBusy)
        ));
        cloning.await.unwrap().unwrap();
        let deadline = std::time::Instant::now() + Duration::from_secs(2);
        while !tart.clone_operation_finished(&name).unwrap() {
            assert!(
                std::time::Instant::now() < deadline,
                "Clone/set lease was not released"
            );
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert_eq!(std::fs::read_to_string(&events).unwrap(), "clone\nset\n");
        tart.delete(&name).await.unwrap();
        assert!(!directory.path().join(clone_lease_filename(&name)).exists());
    }
    #[tokio::test]
    async fn absent_vm_cleanup_retires_only_exact_released_lease() {
        let directory = lease_directory();
        let fixture = directory.path().join("tart-fixture");
        std::fs::write(&fixture,"#!/bin/sh\nprintf '%s' '[{\"Source\":\"local\",\"Name\":\"base\",\"State\":\"stopped\",\"Running\":false}]'\n").unwrap();
        std::fs::set_permissions(&fixture, std::fs::Permissions::from_mode(0o700)).unwrap();
        let tart = lease_adapter(directory.path(), &fixture);
        let name = lease_name();
        let other = OwnedVmName::parse("homelab-job-abcdef0123456789abcdef0123456789").unwrap();
        let lease = tart.acquire_clone_lease(&name, true).unwrap().unwrap();
        let other_lease = tart.acquire_clone_lease(&other, true).unwrap().unwrap();
        assert!(matches!(
            tart.cleanup_clone_operation(&name).await,
            Err(TartError::CloneLeaseBusy)
        ));
        drop(lease);
        for _ in 0..100 {
            if tart.clone_operation_finished(&name).unwrap() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        tart.cleanup_clone_operation(&name).await.unwrap();
        assert!(!directory.path().join(clone_lease_filename(&name)).exists());
        assert!(directory.path().join(clone_lease_filename(&other)).exists());
        drop(other_lease);
    }
    #[tokio::test]
    async fn boot_spawn_holds_operation_lease_until_exact_child_is_reaped() {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/bin/sleep"));
        let name = lease_name();
        let mut command = Command::new("/bin/sleep");
        command.arg("30");
        let mut owner = tart.spawn_boot_owner(&name, command, None).unwrap();
        assert!(!tart.operation_finished(&name).unwrap());
        assert!(matches!(
            tart.acquire_clone_lease(&name, true),
            Err(TartError::CloneLeaseBusy)
        ));
        owner.terminate_and_reap().await.unwrap();
        for _ in 0..100 {
            if tart.operation_finished(&name).unwrap() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(tart.operation_finished(&name).unwrap());
        assert!(
            directory.path().join(clone_lease_filename(&name)).exists(),
            "lease is retained until confirmed attempt cleanup"
        );
    }
    #[tokio::test]
    async fn boot_spawn_failure_leaves_no_lease_holder() {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/does/not/exist"));
        let name = lease_name();
        assert!(
            tart.spawn_boot_owner(&name, Command::new("/does/not/exist"), None)
                .is_err()
        );
        // Other concurrent fork/exec test fixtures may briefly retain a CLOEXEC
        // descriptor before their exec boundary closes it.
        for _ in 0..100 {
            if tart.operation_finished(&name).unwrap() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(tart.operation_finished(&name).unwrap());
    }
    #[tokio::test]
    async fn boot_lease_process_fixture() {
        let Some(home) = std::env::var_os("HOMELAB_RUNNER_TEST_LEASE_HOME") else {
            return;
        };
        let home = PathBuf::from(home);
        let tart = lease_adapter(&home, Path::new("/bin/sleep"));
        let global = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(home.join("global.lock"))
            .unwrap();
        global.try_lock().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "tart::tests::clone_lease_process_fixture",
                "--nocapture",
            ])
            .env("HOMELAB_RUNNER_TEST_LEASE_HOME", &home)
            .env("HOMELAB_RUNNER_TEST_LEASE_ROLE", "child");
        // This is the production run-spawn path: parent lease handles are gone
        // when it returns, so only the child can retain the operation lock.
        let mut owner = tart.spawn_boot_owner(&lease_name(), command, None).unwrap();
        std::fs::write(
            home.join("child-ready"),
            owner.process_id().unwrap().to_string(),
        )
        .unwrap();
        tokio::time::sleep(Duration::from_secs(10)).await;
        owner.terminate_and_reap().await.unwrap();
        drop(global);
    }
    #[test]
    fn clone_lease_process_fixture() {
        let Some(home) = std::env::var_os("HOMELAB_RUNNER_TEST_LEASE_HOME") else {
            return;
        };
        let home = PathBuf::from(home);
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        if std::env::var_os("HOMELAB_RUNNER_TEST_LEASE_ROLE").as_deref()
            == Some(std::ffi::OsStr::new("child"))
        {
            while !home.join("release-child").exists() && std::time::Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            return;
        }
        let tart = lease_adapter(&home, Path::new("/bin/sleep"));
        let lease = tart
            .acquire_clone_lease(&lease_name(), true)
            .unwrap()
            .unwrap();
        let global = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .mode(0o600)
            .open(home.join("global.lock"))
            .unwrap();
        global.try_lock().unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "tart::tests::clone_lease_process_fixture",
                "--nocapture",
            ])
            .env("HOMELAB_RUNNER_TEST_LEASE_HOME", &home)
            .env("HOMELAB_RUNNER_TEST_LEASE_ROLE", "child")
            .stdin(Stdio::from(lease.file.try_clone().unwrap()))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        std::fs::write(home.join("child-ready"), child.id().to_string()).unwrap();
        while std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        let _ = child.wait();
        drop(global);
        drop(lease);
    }
    #[test]
    fn inherited_clone_stdin_lease_survives_parent_sigkill_without_global_lock() {
        inherited_lease_survives_parent_sigkill("tart::tests::clone_lease_process_fixture");
    }
    #[test]
    fn inherited_boot_stdin_lease_survives_parent_sigkill_without_global_lock() {
        inherited_lease_survives_parent_sigkill("tart::tests::boot_lease_process_fixture");
    }
    fn inherited_lease_survives_parent_sigkill(fixture: &str) {
        let directory = lease_directory();
        let tart = lease_adapter(directory.path(), Path::new("/bin/sleep"));
        let name = lease_name();
        struct Cleanup {
            parent: std::process::Child,
            home: PathBuf,
        }
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.parent.kill();
                let _ = self.parent.wait();
                let _ = std::fs::write(self.home.join("release-child"), b"");
            }
        }
        let parent = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", fixture, "--nocapture"])
            .env("HOMELAB_RUNNER_TEST_LEASE_HOME", directory.path())
            .env("HOMELAB_RUNNER_TEST_LEASE_ROLE", "parent")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut cleanup = Cleanup {
            parent,
            home: directory.path().into(),
        };
        for _ in 0..200 {
            if directory.path().join("child-ready").exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(directory.path().join("child-ready").exists());
        assert!(!tart.clone_operation_finished(&name).unwrap());
        cleanup.parent.kill().unwrap();
        cleanup.parent.wait().unwrap();
        assert!(
            !tart.clone_operation_finished(&name).unwrap(),
            "surviving child must hold inherited fd0 lease"
        );
        let global = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(directory.path().join("global.lock"))
            .unwrap();
        global
            .try_lock()
            .expect("global controller lock must not be inherited");
        std::fs::write(directory.path().join("release-child"), b"").unwrap();
        for _ in 0..200 {
            if tart.clone_operation_finished(&name).unwrap() {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(tart.clone_operation_finished(&name).unwrap());
    }
}
