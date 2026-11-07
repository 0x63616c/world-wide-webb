//! Operations shared by interactive management and scheduled host execution.

pub mod bootstrap;
pub mod bootstrap_privileged;
pub mod bootstrap_state;
pub mod enrollment_credentials;
pub mod enrollment_reservation;
pub mod first_access;
pub mod git_ssh;
pub mod host_key;
pub mod inspect;
pub mod inventory;
pub mod power;
#[doc(hidden)]
pub mod process;
pub mod provisioning;
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
pub mod updater_gate;

mod comin;
pub mod config;
pub mod configuration_pr;
pub mod deploy_identity;
pub mod deploy_keys;
pub mod package;

pub mod developer_tools;
