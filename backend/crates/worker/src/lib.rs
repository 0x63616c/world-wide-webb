//! Runtime foundation. No public operation is enabled until full authentication/enrollment exists.
pub mod assertion;
pub mod avatar;
pub mod mutation;
pub mod presentation;

#[cfg(target_arch = "wasm32")]
mod runtime;
