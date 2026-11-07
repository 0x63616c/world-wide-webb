//! Worker authentication and domain integrations. Community writes remain unavailable until complete App Attest enrollment.
pub mod apple_client;
pub mod apple_identity;
#[cfg(target_arch = "wasm32")]
pub mod apple_transport;
pub mod assertion;
pub mod attestation;
#[cfg(target_arch = "wasm32")]
mod attestation_runtime;
#[cfg(target_arch = "wasm32")]
mod auth_maintenance;
#[cfg(target_arch = "wasm32")]
mod auth_runtime;
#[cfg(target_arch = "wasm32")]
mod auth_signin;
pub mod auth_wire;
pub mod avatar;
pub mod certificate;
#[cfg(target_arch = "wasm32")]
mod community_reads;
#[cfg(target_arch = "wasm32")]
mod competition_runtime;
#[cfg(target_arch = "wasm32")]
mod enrollment_runtime;
pub mod ingestion;
pub mod mutation;
pub mod presentation;
#[cfg(target_arch = "wasm32")]
mod protected_request;
pub mod receipt;
pub mod secrets;
pub mod session;

#[cfg(target_arch = "wasm32")]
mod runtime;
