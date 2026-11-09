use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{CommandFactory, Parser, Subcommand};
use homelab_client::{inventory, tui};

#[derive(Parser)]
#[command(
    name = "homelab",
    version = homelab_client::VERSION,
    about = "Set up a Mac from your Git configuration"
)]
struct Arguments {
    /// Use separate local state; omit for your existing default profile.
    #[arg(long, global = true, value_parser = homelab_client::operator_profile::parse_name)]
    profile: Option<String>,
    #[arg(long, global = true, hide = true, conflicts_with = "profile")]
    inventory: Option<PathBuf>,
    #[command(subcommand)]
    operation: Option<Operation>,
}

#[derive(Subcommand)]
enum Operation {
    /// Inspect configuration offline; no home directory or terminal is required.
    Config {
        #[command(subcommand)]
        operation: ConfigOperation,
    },
    /// Start or resume setup of a host from your GitHub repository.
    Setup {
        #[arg(long)]
        host: String,
        /// Save or verify this Mac's administrator credential without reinstalling or rebooting.
        #[arg(long)]
        authorize_only: bool,
    },
    /// Explore synthetic UI screens without accounts, saved state or a target Mac.
    Preview {
        #[arg(long, value_enum, default_value_t = homelab_client::preview::Screen::Input)]
        screen: homelab_client::preview::Screen,
        /// Print a plain-text rendering instead of opening the interactive preview.
        #[arg(long)]
        dump: bool,
        #[arg(long, default_value_t = 100, value_parser = clap::value_parser!(u16).range(1..=300))]
        width: u16,
        #[arg(long, default_value_t = 30, value_parser = clap::value_parser!(u16).range(1..=120))]
        height: u16,
    },
}

#[derive(Subcommand)]
enum ConfigOperation {
    /// Validate a local homelab.json without contacting any service.
    Validate { file: PathBuf },
    /// Print the current JSON Schema for editors and validation tools.
    Schema,
}

struct Failure {
    code: &'static str,
    message: String,
    next_action: &'static str,
}

impl Failure {
    fn new(code: &'static str, message: impl Into<String>, next_action: &'static str) -> Self {
        Self {
            code,
            message: message.into(),
            next_action,
        }
    }
}

impl From<inventory::InventoryError> for Failure {
    fn from(error: inventory::InventoryError) -> Self {
        Self::new(error.code(), error.to_string(), error.next_action())
    }
}

fn menu_failure(error: tui::MenuError) -> Failure {
    match error {
        tui::MenuError::Inventory(error) => Failure::from(error),
        tui::MenuError::Terminal => Failure::new(
            "terminal-unavailable",
            error.to_string(),
            "Open an interactive terminal and retry. Saved connection details are retained.",
        ),
        tui::MenuError::Cancelled => Failure::new(
            "setup-cancelled",
            error.to_string(),
            "Reopen homelab when ready; existing setup state is preserved.",
        ),
        _ => Failure::new(
            "setup-unavailable",
            error.to_string(),
            "Reopen homelab to choose a repository host or resume its saved setup.",
        ),
    }
}

fn execute(arguments: Arguments) -> Result<(), Failure> {
    homelab_client::operator_profile::select(arguments.profile).map_err(|message| {
        Failure::new(
            "profile-unavailable",
            message,
            "Restart homelab with a valid --profile name.",
        )
    })?;
    if let Some(Operation::Preview {
        screen,
        dump,
        width,
        height,
    }) = &arguments.operation
    {
        let result = if *dump {
            homelab_client::preview::dump(*screen, *width, *height)
                .and_then(|text| writeln!(io::stdout().lock(), "{text}"))
        } else {
            homelab_client::preview::launch(*screen)
        };
        return result.map_err(|_| {
            Failure::new(
                "preview-unavailable",
                "Could not display the local preview.",
                "Open an interactive terminal and run homelab preview again.",
            )
        });
    }
    if let Some(Operation::Config { operation }) = &arguments.operation {
        let output = match operation {
            ConfigOperation::Schema => {
                serde_json::to_string_pretty(&homelab_client::config::schema()).unwrap()
            }
            ConfigOperation::Validate { file } => {
                let manifest = homelab_client::config::validate_file(file).map_err(|error| {
                    Failure::new(
                        "invalid-configuration",
                        error.to_string(),
                        "See docs/configuration.md; no local or remote state was changed.",
                    )
                })?;
                if manifest.schema == 1 {
                    "Valid historical schema 1 configuration. New enrollment requires schema 2 and onePassword.backupVault.".into()
                } else {
                    "Configuration is valid (schema 2).".into()
                }
            }
        };
        return writeln!(io::stdout().lock(), "{output}").map_err(|_| {
            Failure::new(
                "output-unavailable",
                "Could not write configuration result.",
                "Check standard output and retry.",
            )
        });
    }
    if let Some(home) = std::env::var_os("HOME") {
        homelab_client::local_storage::migrate(std::path::Path::new(&home)).map_err(|error| {
            Failure::new("state-migration", error.to_string(), "Close other homelab sessions and retry. Existing saved files have not been overwritten.")
        })?;
    }
    let path = arguments
        .inventory
        .or_else(homelab_client::operator_profile::inventory_path)
        .ok_or_else(|| {
            Failure::new(
                "inventory-unavailable",
                "The home directory could not be determined.",
                "Restore your HOME environment so the CLI can locate its connection and recovery state.",
            )
        })?;

    match arguments.operation {
        Some(Operation::Config { .. }) => unreachable!("configuration handled before inventory"),
        Some(Operation::Preview { .. }) => unreachable!("preview handled before inventory"),
        None => {
            tui::launch(&path).map_err(menu_failure)?;
            Ok(())
        }
        Some(Operation::Setup {
            host,
            authorize_only,
        }) => {
            if authorize_only {
                tui::authorize_selected(&path, &host).map_err(menu_failure)?;
            } else {
                tui::launch_selected(&path, Some(&host)).map_err(menu_failure)?;
            }
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    if let Some(status) = homelab_client::terminal_process::dispatch_bridge() {
        return status;
    }
    let arguments = Arguments::parse();

    if !matches!(
        &arguments.operation,
        Some(Operation::Config { .. } | Operation::Preview { dump: true, .. })
    ) && (!io::stdin().is_terminal() || !io::stdout().is_terminal())
    {
        Arguments::command()
            .error(
                clap::error::ErrorKind::InvalidValue,
                if matches!(&arguments.operation, Some(Operation::Preview { .. })) {
                    "Preview needs an interactive terminal. Open Terminal and run homelab preview."
                } else {
                    "Setup needs an interactive terminal. Open Terminal and run homelab to start or resume setup."
                },
            )
            .exit();
    }
    match execute(arguments) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!(
                "{} [{}]\nNext: {}",
                error.message, error.code, error.next_action
            );
            ExitCode::FAILURE
        }
    }
}
