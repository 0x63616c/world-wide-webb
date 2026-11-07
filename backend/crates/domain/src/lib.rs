//! Deterministic tracking/competition rules. No HTTP, database, or Worker runtime dependencies.
pub mod competition;
pub mod reducer;
pub mod wire;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DomainError {
    InvalidEnvelope,
    IdentityConflict,
    SequenceConflict,
    Overflow,
}
