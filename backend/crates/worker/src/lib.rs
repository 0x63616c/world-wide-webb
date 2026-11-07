//! Runtime foundation. No public operation is enabled until full authentication/enrollment exists.
pub mod apple_identity;
pub mod assertion;
pub mod attestation;
pub mod auth_wire;
pub mod avatar;
pub mod certificate;
pub mod ingestion;
pub mod mutation;
pub mod presentation;
pub mod session;

#[cfg(target_arch = "wasm32")]
mod runtime;
