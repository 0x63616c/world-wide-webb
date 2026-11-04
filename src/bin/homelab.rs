use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{CommandFactory, Parser, Subcommand};
use homelab_client::{inspect, inventory, tui};
use serde::Serialize;

#[derive(Parser)]
#[command(name = "homelab", version, about = "Guided remote homelab management")]
struct Arguments {
    #[arg(long, global = true)]
    inventory: Option<PathBuf>,
    #[command(subcommand)]
    operation: Option<Operation>,
}

#[derive(Subcommand)]
enum Operation {
    /// Guide setup of a selected host from a reviewed artifact.
    Setup {
        #[arg(long)]
        host: String,
    },
    /// Inspect a host through verified SSH without changing its settings.
    Inspect {
        #[arg(long)]
        host: String,
        #[arg(long)]
        json: bool,
    },
}

#[derive(Serialize)]
struct Failure {
    schema: u8,
    state: &'static str,
    code: &'static str,
    message: String,
    #[serde(rename = "nextAction")]
    next_action: &'static str,
}

impl Failure {
    fn new(code: &'static str, message: impl Into<String>, next_action: &'static str) -> Self {
        Self {
            schema: 1,
            state: "blocked",
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

impl From<inspect::InspectionError> for Failure {
    fn from(error: inspect::InspectionError) -> Self {
        Self::new(error.code(), error.to_string(), error.next_action())
    }
}

fn execute(arguments: Arguments, ssh: &Path) -> Result<Option<inspect::Inspection>, Failure> {
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
        None => {
            tui::launch(&path).map_err(|error| match error {
                tui::MenuError::Inventory(error) => Failure::from(error),
                tui::MenuError::Terminal => Failure::new(
                    "terminal-unavailable",
                    error.to_string(),
                    "Open an interactive terminal and retry. Saved host profiles are retained.",
                ),
            })?;
            Ok(None)
        }
        Some(operation) => {
            let host = match &operation {
                Operation::Inspect { host, .. } | Operation::Setup { host } => host,
            };
            let hosts = inventory::load(&path)?;
            let profile = hosts
                .iter()
                .find(|profile| profile.name == *host)
                .ok_or_else(|| {
                    Failure::new(
                        "unknown-host",
                        "That host is not in your private inventory.",
                        "Choose a host listed in the menu; do not guess an address.",
                    )
                })?;
            match operation {
                Operation::Inspect { .. } => Ok(Some(inspect::inspect(profile, ssh)?)),
                Operation::Setup { .. } => {
                    let outcome =
                        homelab_client::setup_wizard::launch(profile, &path).map_err(|_| {
                            Failure::new(
                                "terminal-unavailable",
                                "Setup could not continue in this terminal.",
                                "Preserve setup evidence and inspect the target before retrying.",
                            )
                        })?;
                    writeln!(io::stdout().lock(), "{}", outcome.lines.join("\n")).map_err(
                        |_| {
                            Failure::new(
                                "output-unavailable",
                                "The setup result could not be displayed.",
                                "Inspect the target before attempting setup again.",
                            )
                        },
                    )?;
                    if !outcome.completed {
                        return Err(Failure::new(
                            "setup-incomplete",
                            "Setup did not complete.",
                            "Review the result above before retrying.",
                        ));
                    }
                    Ok(None)
                }
            }
        }
    }
}

fn write_json(value: &impl Serialize) -> io::Result<()> {
    let mut output = io::stdout().lock();
    serde_json::to_writer(&mut output, value)?;
    writeln!(output)
}

fn main() -> ExitCode {
    let arguments = Arguments::parse();
    if (arguments.operation.is_none()
        || matches!(arguments.operation, Some(Operation::Setup { .. })))
        && (!io::stdin().is_terminal() || !io::stdout().is_terminal())
    {
        Arguments::command()
            .error(
                clap::error::ErrorKind::InvalidValue,
                "The menu needs a terminal. Use inspect --host NAME --json for automation.",
            )
            .exit();
    }
    let json = matches!(
        arguments.operation,
        Some(Operation::Inspect { json: true, .. })
    );
    match execute(arguments, Path::new("/usr/bin/ssh")) {
        Ok(None) => ExitCode::SUCCESS,
        Ok(Some(report)) => {
            let output = if json {
                write_json(&report)
            } else {
                writeln!(io::stdout().lock(), "{}", report.lines().join("\n"))
            };
            if output.is_ok() && report.is_ready() {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            if json {
                let _ = write_json(&error);
            } else {
                eprintln!("{}\nNext: {}", error.message, error.next_action);
            }
            ExitCode::FAILURE
        }
    }
}
