use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::process::ExitCode;
#[derive(Parser)]
#[command(
    name = "homelab-services",
    about = "Private service health and restore operations"
)]
struct Arguments {
    #[command(subcommand)]
    operation: Operation,
}
#[derive(Subcommand)]
enum Operation {
    /// Restore a dump into fresh storage inside an isolated pinned Hindsight container.
    RehearseHindsightRestore {
        #[arg(long)]
        dump: PathBuf,
    },
    /// Verify assigned service readiness before accepting an update.
    Health {
        #[arg(long)]
        config: PathBuf,
    },
}
fn main() -> ExitCode {
    match Arguments::parse().operation {
        Operation::RehearseHindsightRestore { dump } => {
            match homelab_host_ops::hindsight_restore::restore(&dump) {
                Ok(()) => {
                    println!(
                        "Dump restored and database stopped. Application readiness remains unverified."
                    );
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!("Hindsight restore rehearsal incomplete: {error}");
                    ExitCode::FAILURE
                }
            }
        }
        Operation::Health { config } => {
            let settings = rustix::fs::open(
                &config,
                rustix::fs::OFlags::RDONLY
                    | rustix::fs::OFlags::NONBLOCK
                    | rustix::fs::OFlags::CLOEXEC,
                rustix::fs::Mode::empty(),
            )
            .map(std::fs::File::from)
            .map_err(std::io::Error::from)
            .and_then(|file| {
                use std::io::Read;
                if !file.metadata()?.is_file() {
                    return Err(std::io::Error::other("configuration is not a regular file"));
                }
                let mut bytes = Vec::new();
                file.take(65_537).read_to_end(&mut bytes)?;
                if bytes.len() > 65_536 {
                    return Err(std::io::Error::other("oversized configuration"));
                }
                serde_json::from_slice::<homelab_host_ops::health::Config>(&bytes)
                    .map_err(|_| std::io::Error::other("invalid configuration"))
            });
            let Ok(settings) = settings else {
                eprintln!(
                    "Health configuration could not be read. Use the generated homelab-health command."
                );
                return ExitCode::FAILURE;
            };
            match homelab_host_ops::health::wait_healthy(
                &settings,
                std::time::Duration::from_secs(120),
            ) {
                Ok(()) => {
                    if settings.services.is_empty() {
                        println!(
                            "No services are assigned; no service readiness checks were needed."
                        );
                    } else {
                        println!("Assigned service readiness checks passed.");
                    }
                    ExitCode::SUCCESS
                }
                Err(error) => {
                    eprintln!(
                        "Service readiness was not verified [{}]: {error}",
                        error.code()
                    );
                    ExitCode::FAILURE
                }
            }
        }
    }
}
