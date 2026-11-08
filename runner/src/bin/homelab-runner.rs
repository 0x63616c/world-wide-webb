use clap::{Parser, Subcommand};
use homelab_runner::{
    gate::Gate,
    service::{self, RuntimeConfig},
    state::Journal,
};
use std::{
    fs::OpenOptions,
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    time::Duration,
};
#[derive(Parser)]
#[command(about = "One-slot disposable Tart runner controller")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Run {
        #[arg(long)]
        config: PathBuf,
    },
    CheckConfig {
        #[arg(long)]
        config: PathBuf,
    },
    Status {
        #[arg(long)]
        state_directory: PathBuf,
    },
    /// Request a root-owned hold and wait for service acknowledgement of no owned resources.
    Drain {
        #[arg(long)]
        state_directory: PathBuf,
        #[arg(long)]
        control_directory: PathBuf,
        #[arg(long, default_value_t = 7800)]
        timeout_seconds: u64,
        /// Activation while the daemon is proven unloaded; require exclusive, idle journal.
        #[arg(long)]
        offline: bool,
    },
    /// Initial installation only: establish a hold when no controller has been installed.
    Hold {
        #[arg(long)]
        state_directory: PathBuf,
        #[arg(long)]
        control_directory: PathBuf,
    },
    Release {
        #[arg(long)]
        state_directory: PathBuf,
        #[arg(long)]
        control_directory: PathBuf,
    },
    Provision {
        #[arg(long)]
        softnet_source: PathBuf,
        #[arg(long)]
        helper_directory: PathBuf,
    },
    KeychainCheck {
        #[arg(long)]
        config: PathBuf,
    },
}
fn root() -> Result<(), Box<dyn std::error::Error>> {
    if rustix::process::geteuid().is_root() {
        Ok(())
    } else {
        Err("activation hold changes require root".into())
    }
}
fn read_journal(directory: &Path) -> Result<Journal, Box<dyn std::error::Error>> {
    read_journal_as(directory, None)
}
fn read_journal_as(
    directory: &Path,
    expected_uid: Option<u32>,
) -> Result<Journal, Box<dyn std::error::Error>> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags((rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32)
        .open(directory.join("journal.json"))?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.mode() & 0o077 != 0
        || expected_uid.is_some_and(|uid| uid != metadata.uid())
    {
        return Err("journal permissions invalid".into());
    }
    let mut bytes = Vec::new();
    file.take(1024 * 1024 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > 1024 * 1024 {
        return Err("journal exceeds bound".into());
    }
    let journal: Journal = serde_json::from_slice(&bytes).map_err(|_| "journal invalid")?;
    journal.validate()?;
    Ok(journal)
}
async fn verify_unloaded() -> Result<(), Box<dyn std::error::Error>> {
    let mut command = tokio::process::Command::new("/bin/launchctl");
    command
        .args(["print", "system/org.nixos.homelab-runner"])
        .env_clear()
        .stdin(std::process::Stdio::null())
        .kill_on_drop(true);
    let output = tokio::time::timeout(Duration::from_secs(10), command.output())
        .await
        .map_err(|_| "offline drain could not prove daemon unloaded")?
        .map_err(|_| "offline drain could not inspect launchd")?;
    if output.status.success() {
        return Err("offline drain refused: daemon is loaded; use normal drain".into());
    }
    if output.status.code() != Some(113)
        || !String::from_utf8_lossy(&output.stderr).contains("Could not find service")
    {
        return Err("offline drain could not prove daemon unloaded".into());
    }
    Ok(())
}
fn verify_offline_idle(directory: &Path) -> Result<(), Box<dyn std::error::Error>> {
    verify_offline_idle_for_owner(directory, 451)
}
fn verify_offline_idle_for_owner(
    directory: &Path,
    owner: u32,
) -> Result<(), Box<dyn std::error::Error>> {
    let metadata = std::fs::symlink_metadata(directory)?;
    if !metadata.is_dir() || metadata.uid() != owner || metadata.mode() & 0o7777 != 0o700 {
        return Err(
            "offline drain refused: state directory must be private and owned by UID 451".into(),
        );
    }
    let store = homelab_runner::store::Store::open_for_owner(directory, owner).map_err(
        |_| "offline drain refused: journal lock is unsafe or another controller owns it",
    )?;
    let journal=store.load().map_err(|_|"offline drain refused: journal is invalid; preserve it and restart the existing controller for reconciliation")?;
    if journal.active.is_some() {
        return Err("offline drain refused: active attempt requires restarting the existing controller to reconcile and clean its resources".into());
    }
    Ok(())
}
fn main() {
    // Set once before starting worker threads or creating logs/credential-adjacent files.
    rustix::process::umask(rustix::fs::Mode::from_bits_truncate(0o077));
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("runtime initialization failed");
    runtime.block_on(async_main());
}
fn initialize_logging(
    cli: &Cli,
) -> Result<Option<tracing_appender::non_blocking::WorkerGuard>, Box<dyn std::error::Error>> {
    if let Command::Run { config } = &cli.command {
        let config = RuntimeConfig::load(config)?;
        drop(homelab_runner::store::Store::open(&config.state_directory)?);
        let appender = tracing_appender::rolling::Builder::new()
            .rotation(tracing_appender::rolling::Rotation::DAILY)
            .filename_prefix("controller")
            .filename_suffix("jsonl")
            .max_log_files(7)
            .build(&config.state_directory)
            .map_err(|_| "controller log initialization failed")?;
        let (writer, guard) = tracing_appender::non_blocking(appender);
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(writer)
            .with_env_filter(tracing_subscriber::EnvFilter::new("homelab_runner=info"))
            .finish();
        tracing::subscriber::set_global_default(subscriber)
            .map_err(|_| "controller logging already initialized")?;
        Ok(Some(guard))
    } else {
        let subscriber = tracing_subscriber::fmt()
            .json()
            .with_writer(std::io::stderr)
            .with_env_filter(tracing_subscriber::EnvFilter::new("homelab_runner=info"))
            .finish();
        tracing::subscriber::set_global_default(subscriber)
            .map_err(|_| "controller logging already initialized")?;
        Ok(None)
    }
}
async fn async_main() {
    let cli = Cli::parse();
    let result = match initialize_logging(&cli) {
        Ok(guard) => {
            let result = execute(cli).await;
            if let Err(error) = &result {
                tracing::error!(category=%error,"controller command failed");
            }
            drop(guard);
            result
        }
        Err(error) => Err(error),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
async fn execute(cli: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match cli.command {
        Command::Run { config } => service::run(&config).await?,
        Command::CheckConfig { config } => {
            RuntimeConfig::load(&config)?;
            println!("configuration valid");
        }
        Command::Status { state_directory } => println!(
            "{}",
            serde_json::to_string_pretty(&read_journal(&state_directory)?)?
        ),
        Command::Drain {
            state_directory,
            control_directory,
            timeout_seconds,
            offline,
        } => {
            root()?;
            let gate = Gate::new(control_directory, &state_directory);
            let request = gate.request_hold()?;
            if offline {
                verify_unloaded().await?;
                verify_offline_idle(&state_directory)?;
                println!(
                    "admission held; unloaded controller journal is idle (resource inventory will be reconciled on startup)"
                );
                return Ok(());
            }
            gate.wait_until_idle(&request, Duration::from_secs(timeout_seconds))
                .await?;
            println!("admission held; controller confirmed idle");
        }
        Command::Hold {
            state_directory,
            control_directory,
        } => {
            root()?;
            Gate::new(control_directory, state_directory).request_hold()?;
            println!("initial activation hold established");
        }
        Command::Release {
            state_directory,
            control_directory,
        } => {
            root()?;
            let gate = Gate::new(control_directory, state_directory);
            if let Some(request) = gate.read_hold()? {
                gate.release(&request)?;
            }
            println!("activation hold released");
        }
        Command::Provision {
            softnet_source,
            helper_directory,
        } => {
            root()?;
            homelab_runner::provision::provision(&softnet_source, &helper_directory)?;
            println!("runner service directories and privileged helper provisioned");
        }
        Command::KeychainCheck { config } => {
            let config = RuntimeConfig::load(&config)?;
            let keychain = config
                .keychain
                .ok_or("no dedicated service keychain configured")?;
            let proof = homelab_runner::keychain::prepare(&keychain).await?;
            println!(
                "dedicated keychain prepared: created={}, login_selected={}; real cold-boot Tart proof remains required",
                proof.created, proof.login_selected
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn offline_journal_inspection_requires_exclusive_idle_valid_state() {
        let root = tempfile::tempdir().unwrap();
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let owner = rustix::process::geteuid().as_raw();
        let store = homelab_runner::store::Store::open(root.path()).unwrap();
        store.save(&Journal::default()).unwrap();
        assert!(verify_offline_idle_for_owner(root.path(), owner).is_err());
        drop(store);
        assert!(verify_offline_idle_for_owner(root.path(), owner).is_ok());
        std::fs::write(root.path().join("journal.json"), b"{truncated").unwrap();
        assert!(verify_offline_idle_for_owner(root.path(), owner).is_err());
        assert_eq!(
            std::fs::read(root.path().join("journal.json")).unwrap(),
            b"{truncated"
        );
        assert!(verify_offline_idle_for_owner(root.path(), owner + 1).is_err());
    }
}
