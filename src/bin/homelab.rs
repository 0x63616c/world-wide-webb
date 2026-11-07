use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{CommandFactory, Parser, Subcommand};
use homelab_client::{inventory, tui};

#[derive(Parser)]
#[command(
    name = "homelab",
    version,
    about = "Set up a Mac from your Git configuration"
)]
struct Arguments {
    #[arg(long, global = true)]
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
    /// Start or resume setup of a saved Mac.
    Setup {
        #[arg(long)]
        host: String,
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

fn execute(arguments: Arguments) -> Result<(), Failure> {
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
    let path = arguments
        .inventory
        .or_else(|| {
            std::env::var_os("HOME")
                .map(|home| PathBuf::from(home).join(".config/homelab/inventory.json"))
        })
        .ok_or_else(|| {
            Failure::new(
                "inventory-unavailable",
                "The home directory could not be determined.",
                "Select your private host list with --inventory PATH.",
            )
        })?;

    match arguments.operation {
        Some(Operation::Config { .. }) => unreachable!("configuration handled before inventory"),
        None => {
            tui::launch(&path).map_err(|error| match error {
                tui::MenuError::Inventory(error) => Failure::from(error),
                tui::MenuError::Terminal => Failure::new(
                    "terminal-unavailable",
                    error.to_string(),
                    "Open an interactive terminal and retry. Saved host profiles are retained.",
                ),
            })?;
            Ok(())
        }
        Some(Operation::Setup { host }) => {
            let hosts = inventory::load(&path)?;
            let profile = hosts
                .iter()
                .find(|profile| profile.name == host)
                .ok_or_else(|| {
                    Failure::new(
                        "unknown-host",
                        "That host is not in your private inventory.",
                        "Run homelab to choose or add the Mac you want to set up.",
                    )
                })?;
            let outcome = homelab_client::setup_wizard::launch(profile, &path).map_err(|_| {
                Failure::new(
                    "terminal-unavailable",
                    "Setup could not continue in this terminal.",
                    "Preserve setup evidence and inspect the target before retrying.",
                )
            })?;
            writeln!(io::stdout().lock(), "{}", outcome.lines.join("\n")).map_err(|_| {
                Failure::new(
                    "output-unavailable",
                    "The setup result could not be displayed.",
                    "Inspect the target before attempting setup again.",
                )
            })?;
            if !outcome.completed {
                return Err(Failure::new(
                    "setup-incomplete",
                    "Setup did not complete.",
                    "Review the result above before retrying.",
                ));
            }
            Ok(())
        }
    }
}

fn main() -> ExitCode {
    let arguments = Arguments::parse();
    if !matches!(&arguments.operation, Some(Operation::Config { .. }))
        && (!io::stdin().is_terminal() || !io::stdout().is_terminal())
    {
        Arguments::command()
            .error(
                clap::error::ErrorKind::InvalidValue,
                "Setup needs an interactive terminal. Open Terminal and run homelab to start or resume setup.",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_reports_missing_inventory_without_starting_the_wizard() {
        let directory = tempfile::tempdir().unwrap();
        let error = execute(Arguments {
            inventory: Some(directory.path().join("missing.json")),
            operation: Some(Operation::Setup {
                host: "missing".into(),
            }),
        })
        .unwrap_err();
        assert_eq!(error.code, "inventory-missing");
        assert!(error.next_action.contains("profile"));
    }

    #[test]
    fn unknown_profile_never_becomes_an_ssh_address() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("private/inventory.json");
        inventory::add(
            &path,
            inventory::HostProfile {
                name: "saved".into(),
                address: "example.invalid".into(),
                user: "operator".into(),
                identity: None,
                configuration_host: None,
            },
        )
        .unwrap();
        let original = std::fs::read(&path).unwrap();
        let error = execute(Arguments {
            inventory: Some(path.clone()),
            operation: Some(Operation::Setup {
                host: "arbitrary".into(),
            }),
        })
        .unwrap_err();
        assert_eq!(error.code, "unknown-host");
        assert_eq!(std::fs::read(path).unwrap(), original);
    }
}
