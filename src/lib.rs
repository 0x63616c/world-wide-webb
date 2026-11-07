//! Operations shared by interactive management and scheduled host execution.

/// Version shared by the CLI, its bundled helper and terminal presentation.
pub const VERSION: &str = env!("HOMELAB_BUILD_VERSION");

pub mod bootstrap;
pub mod bootstrap_privileged;
pub mod bootstrap_state;
pub mod enrollment_credentials;
pub mod enrollment_reservation;
pub mod first_access;
pub mod git_ssh;
pub mod host_key;
mod host_status;
pub mod inspect;
pub mod inventory;
pub mod operator_profile;
pub mod power;
pub mod preview;
#[doc(hidden)]
pub mod process;
pub mod provisioning;
mod quit;
pub mod remote_completion;
pub mod remote_setup;
pub mod secret_store;
pub mod secrets;
pub mod setup_report;
pub mod setup_wizard;
mod ssh;
mod ssh_identity;
pub mod ssh_keys;
pub mod tailscale;
pub mod tailscale_oauth;
pub mod tui;
mod ui;
mod update_check;
pub mod updater_gate;

mod comin;
pub mod config;
pub mod configuration_pr;
pub mod deploy_identity;
pub mod deploy_keys;
pub mod package;

pub mod developer_tools;

pub mod repository_hosts;

pub mod local_storage;

pub mod nix_installation;

pub mod terminal_process;

mod bootstrap_diagnostics;

mod setup_auth;
pub mod setup_repair;
mod sudo_session;
