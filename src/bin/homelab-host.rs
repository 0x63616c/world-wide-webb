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

#[derive(Subcommand)]
enum Operation {
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
        repository: String,
        #[arg(long)]
        manifest: PathBuf,
        host: String,
        revision: String,
        age_key: PathBuf,
        github_token: PathBuf,
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
    },
    #[command(hide = true)]
    BootstrapKeyStatus,
    #[command(hide = true)]
    CredentialAskpass { prompt: String },
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

fn bootstrap(request: homelab_client::bootstrap::Request) -> ExitCode {
    let Some(home) = std::env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    else {
        eprintln!("Bootstrap needs an absolute home directory for its private setup journal.");
        return ExitCode::FAILURE;
    };
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
    match homelab_client::bootstrap::run(
        &request,
        &tools,
        &home.join(".local/state/homelab/bootstrap"),
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
        Operation::Bootstrap {
            repository,
            manifest,
            host,
            revision,
            age_key,
            github_token,
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
            bootstrap(homelab_client::bootstrap::Request {
                repository,
                expected_host,
                host,
                revision,
                age_key,
                github_token,
                resume,
                approved_host: std::env::var("HOMELAB_BOOTSTRAP_APPROVED").ok(),
            })
        }
        Operation::CredentialAskpass { prompt } => {
            match homelab_client::git_credentials::respond(&prompt) {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("Git credential request failed: {error}");
                    ExitCode::FAILURE
                }
            }
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
        Operation::BootstrapActivate { system } => {
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
            match homelab_client::bootstrap_privileged::activate(&system) {
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
        Operation::InstallHostKey { source, source_uid } => {
            if !rustix::process::geteuid().is_root() {
                eprintln!(
                    "Host key installation requires administrator elevation through bootstrap."
                );
                return ExitCode::FAILURE;
            }
            match homelab_client::host_key::install(
                &source,
                Path::new("/var/lib/sops-nix"),
                source_uid,
            ) {
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
