//! Finish an activated installation through its existing trusted SSH identity.
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::bootstrap_privileged::VerifiedSetup;
use crate::inventory::HostProfile;
use crate::process;

const HELPER: &str = "/run/current-system/sw/bin/homelab-host";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Progress {
    JoiningTailscale,
    CheckingAccess,
    Rebooting,
    VerifyingReboot,
    EnablingUpdates,
}

impl Progress {
    pub fn message(self) -> &'static str {
        match self {
            Self::JoiningTailscale => "Joining Tailscale…",
            Self::CheckingAccess => "Checking services, Tailscale and Git access",
            Self::Rebooting => "Restarting the Mac and waiting for it to return",
            Self::VerifyingReboot => "Verifying the Mac after reboot",
            Self::EnablingUpdates => "Building and applying Git main",
        }
    }
}

impl std::fmt::Display for Progress {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.message())
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("The saved installation selection is invalid. Preserve this setup attempt.")]
    Selection,
    #[error("Setup verification could not be confirmed. Resume this attempt; do not reinstall.")]
    Verification,
    #[error(
        "Setup verification failed [{0}]. The installation and update hold are preserved; no reinstall is needed."
    )]
    CheckFailed(&'static str),
    #[error(
        "Tailscale SSH could not reach this Mac. Check this client's Tailscale connection, SSH access policy and any browser approval request, then resume setup."
    )]
    Tailnet,
    #[error(
        "The Mac has not returned from reboot yet. Leave it powered on; FileVault may require a local unlock, then resume setup."
    )]
    Reboot,
    #[error(
        "Restart was not confirmed. Check administrator authentication and resume this setup attempt."
    )]
    RebootRequest,
    #[error(
        "Install the standalone Tailscale client with its CLI on this Mac, connect to your tailnet, then resume setup."
    )]
    TailscaleClient,
}

pub struct Installation<'a> {
    pub repository: &'a str,
    pub host: &'a str,
    pub revision: &'a str,
    pub tag: &'a str,
}

struct Connection<'a> {
    profile: &'a HostProfile,
    ssh: &'a Path,
    address: String,
    tailscale: Option<&'a Path>,
}

impl Connection<'_> {
    fn command(
        &self,
        interactive: bool,
    ) -> Result<(Command, Option<tempfile::NamedTempFile>), Error> {
        if let Some(executable) = self.tailscale {
            let mut command = Command::new(executable);
            command
                .arg("ssh")
                .arg(format!("{}@{}", self.profile.user, self.address))
                .args([
                    "-T",
                    "-F",
                    "/dev/null",
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ForwardAgent=no",
                    "-o",
                    "ClearAllForwardings=yes",
                    "-o",
                    "ControlMaster=no",
                    "-o",
                    "ControlPath=none",
                    "-o",
                    "ControlPersist=no",
                    "-o",
                    "ConnectTimeout=8",
                ]);
            return Ok((command, None));
        }
        let mut command = Command::new(self.ssh);
        crate::setup_auth::pin(&mut command, self.profile);
        let identity = crate::ssh_identity::configure(&mut command, self.profile.identity.as_ref())
            .map_err(|_| Error::Selection)?;
        command
            .arg(if interactive { "-tt" } else { "-T" })
            .args(crate::ssh::OPTIONS)
            .args([
                "-o",
                "ControlMaster=no",
                "-o",
                "ControlPath=none",
                "-o",
                "ControlPersist=no",
            ])
            // Changing routes must not silently establish a different host identity.
            .arg("-o")
            .arg(format!("HostKeyAlias={}", self.profile.address))
            .arg("-l")
            .arg(&self.profile.user)
            .arg(&self.address);
        Ok((command, identity))
    }

    fn read(&self, remote: &str) -> Result<Vec<u8>, Error> {
        let (mut command, _identity) = self.command(false)?;
        command.arg(remote).stdin(Stdio::null());
        let output = if self.tailscale.is_some() {
            crate::terminal_process::capture(&mut command, Duration::from_secs(180))
        } else {
            process::capture(&mut command, Duration::from_secs(45))
        }
        .map_err(|_| Error::Verification)?;
        if !output.status.success() {
            return Err(Error::Verification);
        }
        Ok(output.stdout)
    }

    fn root(&self, remote: &str) -> Result<std::process::ExitStatus, Error> {
        if remote.starts_with(HELPER) && crate::setup_auth::active() {
            let helper = std::env::current_exe()
                .map_err(|_| Error::Verification)?
                .canonicalize()
                .map_err(|_| Error::Verification)?
                .parent()
                .ok_or(Error::Verification)?
                .join("homelab-host");
            let tools = crate::remote_setup::Tools {
                ssh: self.ssh.to_owned(),
                scp: "/usr/bin/scp".into(),
            };
            let (stage, digest) = crate::remote_setup::stage_helper(self.profile, &helper, &tools)
                .map_err(|_| Error::Verification)?;
            let action = remote.replacen(HELPER, &format!("{stage}/homelab-host"), 1);
            let body = format!(
                r#"actual=$(/usr/bin/shasum -a 256 '{stage}/homelab-host'); test "${{actual%% *}}" = '{digest}' && exec {action}"#
            );
            let result = self.root_run(
                &format!("/bin/sh -c '{}'", body.replace('\'', "'\\''")),
                None,
            );
            if let Ok((status, _)) = &result
                && status.code().is_some_and(|code| code < 128)
                && !remote.contains("request-setup-reboot")
                && !crate::remote_setup::cleanup(self.profile, &tools, &stage)
            {
                return Err(Error::CheckFailed("helper-cleanup"));
            }
            return result.map(|(status, _)| status);
        }
        self.root_run(remote, None).map(|(status, _)| status)
    }

    fn root_run(
        &self,
        remote: &str,
        diagnostic: Option<(&str, &str, &'static str)>,
    ) -> Result<(std::process::ExitStatus, Vec<u8>), Error> {
        let (mut command, _identity) = self.command(true)?;
        let redirected = if diagnostic.is_some() {
            remote.to_owned()
        } else {
            format!("{remote} > /dev/null")
        };
        let prepared = if self.tailscale.is_none() {
            crate::setup_auth::Exchange::prepare(
                self.profile,
                &format!("/usr/bin/sudo -n {redirected}"),
            )
            .map_err(|_| Error::Verification)?
        } else {
            None
        };
        let (remote, exchange) = match prepared {
            Some((remote, exchange)) => (remote, Some(exchange)),
            None => (format!("/usr/bin/sudo {redirected}"), None),
        };
        command
            // Hide helper JSON on the target; keep the PTY for sudo prompts.
            .arg(remote)
            .stdin(Stdio::inherit())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit());
        if let Some((start, end, code)) = diagnostic {
            crate::terminal_process::diagnostic_status(&mut command, exchange, start, end, code)
                .map_err(|_| Error::Verification)
        } else {
            crate::terminal_process::authenticated_status_continuing(&mut command, exchange)
                .map(|status| (status, Vec::new()))
                .map_err(|_| Error::Verification)
        }
    }
}

fn nonce() -> Result<String, Error> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")
        .and_then(|mut file| file.read_exact(&mut bytes))
        .map_err(|_| Error::Verification)?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn diagnostic_script(probe: &str, start: &str, end: &str) -> String {
    let body = format!(
        r#"printf '%s\n' '{start}'; {probe}; result=$?; printf '\n%s\n' '{end}'; exit "$result""#
    );
    format!("/bin/sh -c '{}'", body.replace('\'', "'\\''"))
}

fn wait_for_enrollment(
    connection: &Connection<'_>,
    progress: &mut impl FnMut(Progress),
) -> Result<(), Error> {
    #[derive(serde::Deserialize)]
    struct Status {
        #[serde(rename = "BackendState")]
        state: String,
    }
    // Enrollment is a separate launchd job which retries every five minutes.
    let deadline = Instant::now() + Duration::from_secs(330);
    loop {
        let status: Status = serde_json::from_slice(
            &connection.read("/run/current-system/sw/bin/tailscale status --json --peers=false")?,
        )
        .map_err(|_| Error::Verification)?;
        if status.state == "Running" {
            return Ok(());
        }
        if !matches!(
            status.state.as_str(),
            "NeedsLogin" | "Starting" | "NoState" | "NeedsMachineAuth"
        ) || Instant::now() >= deadline
        {
            return Err(Error::Verification);
        }
        progress(Progress::JoiningTailscale);
        crate::terminal_process::pause(Duration::from_secs(5)).map_err(|_| Error::Verification)?;
    }
}

fn safe_system(system: &Path) -> bool {
    system.parent() == Some(Path::new("/nix/store"))
        && system
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| {
                !name.is_empty()
                    && name
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"-._+".contains(&byte))
            })
}

fn check_command(
    action: &str,
    selection: &Installation<'_>,
    system: &Path,
    binding: &str,
    request: &str,
) -> String {
    format!(
        "{HELPER} {action} --repository '{}' --host '{}' --revision '{}' --tag '{}' --system '{}' --binding '{}' --request-id '{}'",
        selection.repository,
        selection.host,
        selection.revision,
        selection.tag,
        system.display(),
        binding,
        request
    )
}

fn read_report(
    connection: &Connection<'_>,
    system: &Path,
    binding: &str,
    request: &str,
) -> Result<VerifiedSetup, Error> {
    let bytes = connection.read(&format!(
        "{HELPER} read-setup-report --binding '{binding}' --request-id '{request}'"
    ))?;
    let report: VerifiedSetup = serde_json::from_slice(&bytes).map_err(|_| Error::Verification)?;
    if report.schema != 1
        || report.binding != binding
        || report.request_id != request
        || report.system != system
    {
        return Err(Error::Verification);
    }
    Ok(report)
}

/// The caller has already approved installation and reboot for this exact commit.
pub fn finish(
    profile: &HostProfile,
    ssh: &Path,
    selection: Installation<'_>,
    progress: impl FnMut(Progress),
) -> Result<VerifiedSetup, Error> {
    let tailscale = discover_tailscale()?;
    finish_with_tools(profile, ssh, &tailscale, selection, progress)
}

pub fn discover_tailscale() -> Result<PathBuf, Error> {
    use std::os::unix::fs::PermissionsExt;
    let mut candidates: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .map(|directory| directory.join("tailscale"))
                .collect()
        })
        .unwrap_or_default();
    candidates.extend(
        [
            "/opt/homebrew/bin/tailscale",
            "/usr/local/bin/tailscale",
            "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        ]
        .map(PathBuf::from),
    );
    candidates
        .into_iter()
        .find(|path| {
            path.is_absolute()
                && path.metadata().is_ok_and(|metadata| {
                    metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                })
        })
        .ok_or(Error::TailscaleClient)
}

pub fn finish_with_tools(
    profile: &HostProfile,
    ssh: &Path,
    tailscale: &Path,
    selection: Installation<'_>,
    mut progress: impl FnMut(Progress),
) -> Result<VerifiedSetup, Error> {
    let binding =
        crate::config::setup_binding(selection.repository, selection.host, selection.revision)
            .ok_or(Error::Selection)?;
    if !selection
        .tag
        .strip_prefix("tag:")
        .is_some_and(crate::config::valid_host)
        || crate::inventory::validate_profile(profile).is_err()
    {
        return Err(Error::Selection);
    }
    let connection = Connection {
        profile,
        ssh,
        address: profile.address.clone(),
        tailscale: None,
    };
    let completed: Option<VerifiedSetup> = serde_json::from_slice(&connection.read(&format!(
        "{HELPER} read-setup-completion --binding '{binding}'"
    ))?)
    .map_err(|_| Error::Verification)?;
    let system: PathBuf = match &completed {
        Some(report) if report.completed && report.rebooted && report.binding == binding => {
            report.system.clone()
        }
        Some(_) => return Err(Error::Verification),
        None => serde_json::from_slice(&connection.read(&format!("{HELPER} current-system"))?)
            .map_err(|_| Error::Verification)?,
    };
    if !safe_system(&system) {
        return Err(Error::Verification);
    }
    if completed.is_none() {
        wait_for_enrollment(&connection, &mut progress)?;
        progress(Progress::CheckingAccess);
        let request = nonce()?;
        if !connection
            .root(&check_command(
                "verify-setup",
                &selection,
                &system,
                &binding,
                &request,
            ))?
            .success()
        {
            // Read-only probes give actionable errors even with an older installed helper.
            for (code, probe) in [
                (
                    "service-health",
                    "/run/current-system/sw/bin/homelab-health >/dev/null".to_owned(),
                ),
                (
                    "updater-service",
                    "/bin/launchctl print system/com.github.nlewo.comin >/dev/null 2>&1".to_owned(),
                ),
                (
                    "repository-access",
                    format!(
                        "/usr/bin/env GIT_SSH_COMMAND=\"/usr/bin/ssh -F /dev/null -i /var/lib/homelab-git/key.txt -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/homelab/github_known_hosts -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=10\" /usr/bin/git ls-remote --exit-code git@github.com:{}.git refs/heads/main >/dev/null 2>&1",
                        selection.repository
                    ),
                ),
                (
                    "activation-state",
                    format!(
                        "{HELPER} bootstrap-activation-status --system '{}' --binding '{binding}'",
                        system.display()
                    ),
                ),
                ("update-hold", "/bin/cat /var/lib/homelab/hold".to_owned()),
            ] {
                // The complete probe runs under sudo; shell redirection stays in that scope.
                let token = nonce()?;
                let start = format!("HL-{token}-diagnostic-start");
                let end = format!("HL-{token}-diagnostic-end");
                let probe = probe
                    .replace(" >/dev/null 2>&1", " 2>&1")
                    .replace(" >/dev/null", " 2>&1");
                let script = diagnostic_script(&probe, &start, &end);
                let (status, output) = connection.root_run(&script, Some((&start, &end, code)))?;
                if let Some(root) = crate::enrollment_credentials::state_directory() {
                    crate::bootstrap_diagnostics::record_output(
                        &root,
                        code,
                        status.code(),
                        &output,
                    );
                }
                if !status.success() {
                    if let Some(root) = crate::enrollment_credentials::state_directory() {
                        crate::bootstrap_diagnostics::record(&root, None, code);
                    }
                    return Err(Error::CheckFailed(code));
                }
            }
            let helper = std::env::current_exe()
                .map_err(|_| Error::Verification)?
                .canonicalize()
                .map_err(|_| Error::Verification)?
                .parent()
                .ok_or(Error::Verification)?
                .join("homelab-host");
            let tools = crate::remote_setup::Tools {
                ssh: ssh.to_owned(),
                scp: "/usr/bin/scp".into(),
            };
            let (stage, digest) = crate::remote_setup::stage_helper(profile, &helper, &tools)
                .map_err(|_| Error::Verification)?;
            let request = nonce()?;
            let check = check_command("verify-setup", &selection, &system, &binding, &request)
                .replacen(HELPER, &format!("{stage}/homelab-host"), 1);
            let probe = format!(
                r#"actual=$(/usr/bin/shasum -a 256 '{stage}/homelab-host'); test "${{actual%% *}}" = '{digest}' && {check} 2>&1"#
            );
            let start = format!("HL-{request}-diagnostic-start");
            let end = format!("HL-{request}-diagnostic-end");
            let result = connection.root_run(
                &diagnostic_script(&probe, &start, &end),
                Some((&start, &end, "strict-verifier")),
            );
            let cleaned = crate::remote_setup::cleanup(profile, &tools, &stage);
            if let Ok((status, output)) = &result
                && let Some(root) = crate::enrollment_credentials::state_directory()
            {
                crate::bootstrap_diagnostics::record_output(
                    &root,
                    "strict-verifier",
                    status.code(),
                    output,
                );
            }
            if !cleaned {
                return Err(Error::CheckFailed("diagnostic-cleanup"));
            }
            result?;
            return Err(Error::Verification);
        }
        let report = read_report(&connection, &system, &binding, &request)?;
        let mut tailnet = None;
        for address in &report.tailscale.addresses {
            let candidate = Connection {
                profile,
                ssh,
                address: address.to_string(),
                tailscale: Some(tailscale),
            };
            if read_report(&candidate, &system, &binding, &request).is_ok() {
                tailnet = Some(candidate);
                break;
            }
        }
        let tailnet = tailnet.ok_or(Error::Tailnet)?;
        if !report.rebooted {
            progress(Progress::Rebooting);
            let request = nonce()?;
            // Shutdown can close SSH before its acknowledgement arrives. Only a
            // changed boot session permits the next step; never replay shutdown.
            let status = connection.root(&check_command(
                "request-setup-reboot",
                &selection,
                &system,
                &binding,
                &request,
            ))?;
            if !status.success() && status.code().is_some_and(|code| code < 128) {
                return Err(Error::RebootRequest);
            }
            let deadline = Instant::now() + Duration::from_secs(600);
            loop {
                if Instant::now() >= deadline {
                    return Err(Error::Reboot);
                }
                if let Ok(bytes) = tailnet.read("/usr/sbin/sysctl -n kern.bootsessionuuid")
                    && let Ok(boot) = std::str::from_utf8(&bytes)
                    && crate::bootstrap_privileged::valid_boot_session(boot.trim())
                    && !boot.trim().eq_ignore_ascii_case(&report.boot_session)
                {
                    break;
                }
                crate::terminal_process::pause(Duration::from_secs(2))
                    .map_err(|_| Error::Reboot)?;
            }
        }
        progress(Progress::VerifyingReboot);
        let request = nonce()?;
        if !connection
            .root(&check_command(
                "verify-setup",
                &selection,
                &system,
                &binding,
                &request,
            ))?
            .success()
        {
            return Err(Error::Verification);
        }
        if !read_report(&tailnet, &system, &binding, &request)?.rebooted {
            return Err(Error::Verification);
        }
    }
    progress(Progress::EnablingUpdates);
    let request = nonce()?;
    if !connection
        .root(&check_command(
            "complete-setup",
            &selection,
            &system,
            &binding,
            &request,
        ))?
        .success()
    {
        return Err(Error::Verification);
    }
    let report = read_report(&connection, &system, &binding, &request)?;
    if !report.completed
        || !report.rebooted
        || report
            .reconciled_revision
            .as_ref()
            .is_none_or(|revision| !crate::config::valid_revision(revision))
    {
        return Err(Error::Verification);
    }
    Ok(report)
}

#[cfg(test)]
mod diagnostic_script_tests {
    use super::*;
    #[test]
    fn real_shell_preserves_output_and_the_actual_probe_exit_status() {
        for code in [0, 7] {
            let script = diagnostic_script(
                &format!("(printf 'health detail'; exit {code})"),
                "BEGIN",
                "END",
            );
            let output = Command::new("/bin/sh")
                .args(["-c", &script])
                .output()
                .unwrap();
            assert_eq!(output.status.code(), Some(code));
            assert_eq!(output.stdout, b"BEGIN\nhealth detail\nEND\n");
        }
    }
}
