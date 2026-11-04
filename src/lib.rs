//! Operations shared by interactive management and scheduled host execution.

pub mod bootstrap;
pub mod bootstrap_privileged;
pub mod bootstrap_state;
pub mod first_access;
pub mod git_credentials;
pub mod host_key;
pub mod inspect;
pub mod inventory;
pub mod power;
#[doc(hidden)]
pub mod process;
pub mod provision_wizard;
pub mod provisioning;
pub mod remote_setup;
pub mod secrets;
pub mod setup_wizard;
mod ssh;
mod ssh_identity;
pub mod tailscale;
pub mod tailscale_oauth;
pub mod tui;
mod ui;

pub mod config;
pub mod package;
