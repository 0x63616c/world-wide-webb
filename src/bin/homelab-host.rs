use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use homelab_client::power::configure_ac_power;

#[derive(Parser)]
#[command(
    name = "homelab-host",
    version,
    about = "Local operations invoked by host configuration and bootstrap"
)]
struct Arguments {
    #[command(subcommand)]
    operation: Operation,
}

#[derive(clap::Args)]
struct SetupCheck {
    #[arg(long)]
    request_id: String,
    #[arg(long)]
    repository: String,
    #[arg(long)]
    revision: String,
    #[arg(long)]
    system: PathBuf,
    #[arg(long)]
    binding: String,
    #[arg(long)]
    host: String,
    #[arg(long)]
    tag: String,
}

impl SetupCheck {
    fn matches_binding(&self) -> bool {
        homelab_client::config::setup_binding(&self.repository, &self.host, &self.revision)
            .is_some_and(|binding| binding == self.binding)
    }
}

#[derive(Subcommand)]
enum Operation {
    #[command(hide = true)]
    InstallDeveloperTools,
    #[command(hide = true)]
    RunUpdater {
        #[arg(long)]
        executable: PathBuf,
        #[arg(long)]
        config: PathBuf,
    },
    #[command(hide = true)]
    CurrentSystem,
    #[command(hide = true)]
    ReadSetupCompletion {
        #[arg(long)]
        binding: String,
    },
    #[command(hide = true)]
    ReadSetupReport {
        #[arg(long)]
        binding: String,
        #[arg(long)]
        request_id: String,
    },
    #[command(hide = true)]
    VerifySetup(SetupCheck),
    #[command(hide = true)]
    RequestSetupReboot(SetupCheck),
    #[command(hide = true)]
    CompleteSetup(SetupCheck),
    #[command(hide = true)]
    ReleaseEnrollment {
        #[arg(long)]
        repository: String,
        #[arg(long)]
        host: String,
        #[arg(long)]
        attempt: String,
    },
    #[command(hide = true)]
    PrepareDeployKey {
        #[arg(long)]
        repository: String,
        #[arg(long)]
        host: String,
        #[arg(long)]
        attempt: String,
    },
    #[command(hide = true)]
    InstallDeployKey {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        public_key: String,
        #[arg(long)]
        reuse_matching: bool,
    },
    #[command(hide = true)]
    DeployKeyStatus,
    /// Publish reviewed public SSH keys as a root-owned regular file.
    InstallSshKeys {
        #[arg(long)]
        user: String,
        #[arg(long)]
        source: PathBuf,
    },
    /// Set up this target from an explicitly approved, exact reviewed commit.
    Bootstrap {
        #[arg(long)]
        attempt: String,
        #[arg(long)]
        repository: String,
        #[arg(long)]
        manifest: PathBuf,
        host: String,
        revision: String,
        age_key: PathBuf,
        deploy_key: PathBuf,
        #[arg(long)]
        resume: bool,
    },
    #[command(hide = true)]
    BootstrapInstallNix {
        #[arg(long)]
        installer: PathBuf,
        #[arg(long)]
        sha256: String,
        #[arg(long)]
        source_uid: u32,
    },
    #[command(hide = true)]
    BootstrapActivate {
        #[arg(long)]
        system: PathBuf,
        #[arg(long)]
        binding: String,
    },
    #[command(hide = true)]
    BootstrapActivationStatus {
        #[arg(long)]
        system: PathBuf,
        #[arg(long)]
        binding: String,
    },
    #[command(hide = true)]
    BootstrapKeyStatus,
    /// Apply and verify the AC power policy, preserving battery settings.
    Power,
    /// Verify decryption using only the supplied host age identity.
    VerifyHostSecrets {
        #[arg(long)]
        key: PathBuf,
        #[arg(long)]
        ciphertext: PathBuf,
        #[arg(long)]
        sops: PathBuf,
    },
    /// Install a host age identity without replacing any existing key.
    InstallHostKey {
        #[arg(long)]
        source: PathBuf,
        #[arg(long)]
        source_uid: u32,
        #[arg(long)]
        reuse_matching: bool,
    },
    /// Enroll or reconcile the host's Tailscale settings.
    Tailscale {
        #[arg(long)]
        executable: PathBuf,
        #[arg(long)]
        hostname: String,
        #[arg(long)]
        tag: String,
    },
}

fn root_bootstrap_operation() -> bool {
    if rustix::process::geteuid().is_root() {
        true
    } else {
        eprintln!("This bootstrap operation requires administrator elevation.");
        false
    }
}

fn bootstrap(request: homelab_client::bootstrap::Request, attempt: String) -> ExitCode {
    let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    else {
        eprintln!("Bootstrap needs an absolute home directory for its private setup journal.");
        return ExitCode::FAILURE;
    };
    if rustix::process::geteuid().as_raw() == 0
        || request.approved_host.as_deref() != Some(request.host.as_str())
    {
        eprintln!("Bootstrap requires approval for this host from its non-root administrator.");
        return ExitCode::FAILURE;
    }
    let reservation = homelab_client::enrollment_reservation::Reservation::open(&home);
    let claim = reservation.and_then(|reservation| {
        reservation.claim_bootstrap(
            &homelab_client::enrollment_reservation::Attempt {
                id: attempt,
                repository: request.repository.clone(),
                host: request.host.clone(),
            },
            &request.revision,
        )
    });
    if let Err(error) = claim {
        eprintln!("Setup reservation could not be confirmed: {error}");
        return ExitCode::FAILURE;
    }
    let Ok(helper) = std::env::current_exe() else {
        eprintln!("The bootstrap helper location could not be determined.");
        return ExitCode::FAILURE;
    };
    let tools = homelab_client::bootstrap::Tools {
        git: "/usr/bin/git".into(),
        xcode_select: "/usr/bin/xcode-select".into(),
        uname: "/usr/bin/uname".into(),
        id: "/usr/bin/id".into(),
        dseditgroup: "/usr/sbin/dseditgroup".into(),
        sudo: "/usr/bin/sudo".into(),
        curl: "/usr/bin/curl".into(),
        helper,
        nix: std::env::var_os("PATH").and_then(|path| {
            std::env::split_paths(&path)
                .filter(|directory| directory.is_absolute())
                .map(|directory| directory.join("nix"))
                .find(|path| {
                    path.metadata().is_ok_and(|metadata| {
                        metadata.is_file() && metadata.permissions().mode() & 0o111 != 0
                    })
                })
        }),
        installed_nix: "/nix/var/nix/profiles/default/bin/nix".into(),
    };
    match homelab_client::bootstrap::run_with_progress(
        &request,
        &tools,
        &home.join(".local/state/homelab/bootstrap"),
        |phase| eprintln!("{}", phase.message()),
    ) {
        Ok(report) => {
            println!("{} at {}: {}", report.host, report.revision, report.message);
            ExitCode::SUCCESS
        }
        Err(error) => {
            eprintln!(
                "Bootstrap incomplete [{}]: {error}\nNext: {}",
                error.code(),
                error.next_action()
            );
            ExitCode::FAILURE
        }
    }
}

fn reviewed_host(
    path: &Path,
    repository: &str,
    revision: &str,
    host: &str,
) -> Result<homelab_client::config::Host, ()> {
    use std::io::Read;
    #[derive(serde::Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Plan {
        schema: u8,
        repository: String,
        revision: String,
        hosts: std::collections::BTreeMap<String, homelab_client::config::Host>,
    }
    let file = rustix::fs::open(
        path,
        rustix::fs::OFlags::RDONLY
            | rustix::fs::OFlags::NOFOLLOW
            | rustix::fs::OFlags::NONBLOCK
            | rustix::fs::OFlags::CLOEXEC,
        rustix::fs::Mode::empty(),
    )
    .map(std::fs::File::from)
    .map_err(|_| ())?;
    if !file.metadata().map_err(|_| ())?.is_file() {
        return Err(());
    }
    let mut bytes = Vec::new();
    file.take(65_537).read_to_end(&mut bytes).map_err(|_| ())?;
    if bytes.len() > 65_536 {
        return Err(());
    }
    let mut plan: Plan = serde_json::from_slice(&bytes).map_err(|_| ())?;
    if plan.schema != 2 || plan.repository != repository || plan.revision != revision {
        return Err(());
    }
    plan.hosts.remove(host).ok_or(())
}

fn main() -> ExitCode {
    let arguments = Arguments::parse();
    match arguments.operation {
        Operation::InstallDeveloperTools => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match homelab_client::developer_tools::ensure_installed(|message| {
                eprintln!("{message}")
            }) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Command Line Tools setup stopped: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::RunUpdater { executable, config } => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match homelab_client::updater_gate::run(&executable, &config) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Updater startup could not be verified: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::CurrentSystem => match Path::new("/run/current-system").canonicalize() {
            Ok(system) if system.parent() == Some(Path::new("/nix/store")) => {
                println!(
                    "{}",
                    serde_json::to_string(&system).expect("path serializes")
                );
                ExitCode::SUCCESS
            }
            _ => ExitCode::FAILURE,
        },
        Operation::ReadSetupCompletion { binding } => {
            match homelab_client::setup_report::completion(&binding) {
                Ok(report) => {
                    println!(
                        "{}",
                        serde_json::to_string(&report).expect("report serializes")
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Setup completion receipt unavailable: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::ReadSetupReport {
            binding,
            request_id,
        } => match homelab_client::setup_report::read(&binding, &request_id) {
            Ok(report) => {
                println!(
                    "{}",
                    serde_json::to_string(&report).expect("verification report serializes")
                );
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Verified setup report unavailable: {error}");
                ExitCode::FAILURE
            }
        },
        Operation::CompleteSetup(check) => {
            if !root_bootstrap_operation() || !check.matches_binding() {
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::complete_setup(
                &check.system,
                &check.binding,
                &check.repository,
                &check.host,
                &check.tag,
                &check.request_id,
            ) {
                Ok(_) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Setup completion unconfirmed; resume this attempt: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::VerifySetup(check) => {
            if !root_bootstrap_operation() || !check.matches_binding() {
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::verify_setup(
                &check.system,
                &check.binding,
                &check.repository,
                &check.host,
                &check.tag,
                &check.request_id,
            ) {
                Ok(report) => {
                    if let Err(error) = homelab_client::setup_report::publish(&report) {
                        eprintln!("Verification result could not be saved: {error}");
                        return ExitCode::FAILURE;
                    }
                    println!(
                        "{}",
                        serde_json::to_string(&report).expect("verification report serializes")
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Setup verification incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::RequestSetupReboot(check) => {
            if !root_bootstrap_operation() || !check.matches_binding() {
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::request_reboot(
                &check.system,
                &check.binding,
                &check.repository,
                &check.host,
                &check.tag,
                &check.request_id,
            ) {
                Ok(result) => {
                    println!(
                        "{}",
                        serde_json::to_string(&result).expect("reboot result serializes")
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Reboot outcome unconfirmed; preserve this setup attempt: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::ReleaseEnrollment {
            repository,
            host,
            attempt,
        } => {
            if rustix::process::geteuid().as_raw() == 0 {
                return ExitCode::FAILURE;
            }
            let Some(home) = std::env::var_os("HOME") else {
                return ExitCode::FAILURE;
            };
            let result =
                homelab_client::enrollment_reservation::Reservation::open(Path::new(&home))
                    .and_then(|reservation| {
                        reservation.release_preparation(
                            &homelab_client::enrollment_reservation::Attempt {
                                id: attempt,
                                repository,
                                host,
                            },
                        )
                    });
            match result {
                Ok(()) => {
                    println!("released");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Setup reservation retained: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::PrepareDeployKey {
            repository,
            host,
            attempt,
        } => {
            if rustix::process::geteuid().as_raw() == 0 {
                eprintln!(
                    "Prepare the repository identity as the SSH administrator, without sudo."
                );
                return ExitCode::FAILURE;
            }
            let Some(home) = std::env::var_os("HOME") else {
                eprintln!("The administrator home directory is unavailable.");
                return ExitCode::FAILURE;
            };
            let reservation =
                match homelab_client::enrollment_reservation::Reservation::open(Path::new(&home)) {
                    Ok(reservation) => reservation,
                    Err(error) => {
                        eprintln!("Setup reservation failed: {error}");
                        return ExitCode::FAILURE;
                    }
                };
            let attempt = homelab_client::enrollment_reservation::Attempt {
                id: attempt,
                repository: repository.clone(),
                host,
            };
            let phase = match reservation.acquire(&attempt) {
                Ok(phase) => phase,
                Err(error) => {
                    eprintln!("Setup reservation failed: {error}");
                    return ExitCode::FAILURE;
                }
            };
            if phase == homelab_client::enrollment_reservation::Phase::Preparing
                && let Err(error) = reservation.renewal_allowed(&attempt)
            {
                eprintln!("Setup preparation is not available: {error}");
                return ExitCode::FAILURE;
            }
            match homelab_client::deploy_identity::prepare_for_repository(
                Path::new(&home),
                &repository,
                Path::new("/usr/bin/ssh-keygen"),
            ) {
                Ok(mut identity) => {
                    identity.bootstrap_started =
                        phase != homelab_client::enrollment_reservation::Phase::Preparing;
                    if let homelab_client::enrollment_reservation::Phase::BootstrapClaimed {
                        revision,
                    } = &phase
                    {
                        match homelab_client::bootstrap_state::activation_candidate(
                            Path::new(&home),
                            &repository,
                            &attempt.host,
                            revision,
                        ) {
                            Ok(true) => identity.activated_revision = Some(revision.clone()),
                            Ok(false) => {}
                            Err(error) => {
                                eprintln!("Saved bootstrap progress could not be read: {error}");
                                return ExitCode::FAILURE;
                            }
                        }
                    }
                    println!(
                        "{}",
                        serde_json::to_string(&identity).expect("public identity serializes")
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Git identity preparation failed: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::InstallDeployKey {
            source,
            public_key,
            reuse_matching,
        } => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            let Some(source_uid) = std::env::var("SUDO_UID")
                .ok()
                .and_then(|value| value.parse::<u32>().ok())
                .filter(|uid| *uid != 0)
            else {
                eprintln!(
                    "Git identity installation must be elevated by the target administrator."
                );
                return ExitCode::FAILURE;
            };
            let publish = if reuse_matching {
                homelab_client::deploy_identity::ensure
            } else {
                homelab_client::deploy_identity::install
            };
            match publish(
                &source,
                source_uid,
                Path::new("/var/lib/homelab-git"),
                &public_key,
                Path::new("/usr/bin/ssh-keygen"),
            ) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Git identity installation incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::DeployKeyStatus => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match homelab_client::deploy_identity::public_key(
                Path::new("/var/lib/homelab-git/key.txt"),
                0,
                Path::new("/usr/bin/ssh-keygen"),
            ) {
                Ok(public_key) => {
                    println!("{public_key}");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Git identity could not be verified: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::Bootstrap {
            attempt,
            repository,
            manifest,
            host,
            revision,
            age_key,
            deploy_key,
            resume,
        } => {
            let expected_host = match reviewed_host(&manifest, &repository, &revision, &host) {
                Ok(host) => host,
                Err(()) => {
                    eprintln!(
                        "The reviewed setup manifest is invalid or does not match this request."
                    );
                    return ExitCode::FAILURE;
                }
            };
            bootstrap(
                homelab_client::bootstrap::Request {
                    repository,
                    expected_host,
                    host,
                    revision,
                    age_key,
                    deploy_key,
                    resume,
                    approved_host: std::env::var("HOMELAB_BOOTSTRAP_APPROVED").ok(),
                },
                attempt,
            )
        }
        Operation::BootstrapKeyStatus => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match std::fs::symlink_metadata("/var/lib/sops-nix/key.txt") {
                Ok(_) => ExitCode::SUCCESS,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => ExitCode::from(3),
                Err(_) => {
                    eprintln!("The installed host identity could not be checked.");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::BootstrapInstallNix {
            installer,
            sha256,
            source_uid,
        } => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::install_nix(&installer, &sha256, source_uid)
            {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Nix installation incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::BootstrapActivationStatus { system, binding } => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::activation_status(&system, &binding) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Activation completion is not verified: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::BootstrapActivate { system, binding } => {
            if !root_bootstrap_operation() {
                return ExitCode::FAILURE;
            }
            let Ok(system) = system.canonicalize() else {
                eprintln!("Activation requires a built system in the Nix store.");
                return ExitCode::FAILURE;
            };
            if system == Path::new("/nix/store") || !system.starts_with("/nix/store") {
                eprintln!("Activation requires a built system in the Nix store.");
                return ExitCode::FAILURE;
            }
            match homelab_client::bootstrap_privileged::activate_recorded(&system, &binding) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("System activation incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::VerifyHostSecrets {
            key,
            ciphertext,
            sops,
        } => match homelab_client::secrets::verify_host_identity(&key, &ciphertext, &sops) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("Host identity verification failed: {error}");
                ExitCode::FAILURE
            }
        },
        Operation::InstallSshKeys { user, source } => {
            match homelab_client::ssh_keys::install(&user, &source) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("SSH key installation incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::InstallHostKey {
            source,
            source_uid,
            reuse_matching,
        } => {
            if !rustix::process::geteuid().is_root() {
                eprintln!(
                    "Host key installation requires administrator elevation through bootstrap."
                );
                return ExitCode::FAILURE;
            }
            let publish = if reuse_matching {
                homelab_client::host_key::ensure
            } else {
                homelab_client::host_key::install
            };
            match publish(&source, Path::new("/var/lib/sops-nix"), source_uid) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Host key installation incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::Tailscale {
            executable,
            hostname,
            tag,
        } => {
            match homelab_client::tailscale::reconcile(
                &executable,
                &hostname,
                &tag,
                Path::new("/run/secrets/tailscale-auth-key"),
            ) {
                Ok(()) => {
                    println!("Tailscale settings applied; daemon is Running.");
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Tailscale enrollment incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::Power => match configure_ac_power(Path::new("/usr/bin/pmset")) {
            Ok(report) => {
                println!(
                    "{}",
                    serde_json::to_string(&report).expect("power report is serializable")
                );
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Power policy not verified: {error}");
                ExitCode::FAILURE
            }
        },
    }
}
