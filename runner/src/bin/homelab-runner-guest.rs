use clap::{Parser, Subcommand};
use homelab_runner::guest::{self, ServiceConfig};
use std::path::PathBuf;

#[derive(Parser)]
#[command(about = "Fixed one-shot guest service; never pass credentials as arguments")]
struct Args {
    #[arg(long,default_value=guest::DEFAULT_DIRECTORY)]
    directory: PathBuf,
    #[command(subcommand)]
    command: Action,
}
#[derive(Subcommand)]
enum Action {
    /// Installed image launchd service, independently supervised from Tart exec.
    Serve {
        /// Pinned official run.sh wrapper, which owns listener retries/updates.
        #[arg(long)]
        runner: PathBuf,
        #[arg(long)]
        home: PathBuf,
    },
    /// Read one bounded JIT blob from stdin and hand it to the existing service.
    Submit { attempt_id: String },
    /// Return only the small safe status schema; no runner logs or credentials.
    Status,
}
#[tokio::main]
async fn main() {
    let args = Args::parse();
    let result = match args.command {
        Action::Serve { runner, home } => {
            guest::serve(ServiceConfig {
                directory: args.directory,
                runner,
                home,
            })
            .await
        }
        Action::Submit { attempt_id } => {
            guest::submit(&args.directory, &attempt_id, tokio::io::stdin()).await
        }
        Action::Status => guest::read_status(&args.directory).and_then(|status| {
            let bytes = serde_json::to_vec(&status).map_err(|_| guest::GuestError::Status)?;
            use std::io::Write;
            std::io::stdout()
                .write_all(&bytes)
                .map_err(|_| guest::GuestError::Io)
        }),
    };
    if let Err(error) = result {
        eprintln!("{error}");
        std::process::exit(1);
    }
}
