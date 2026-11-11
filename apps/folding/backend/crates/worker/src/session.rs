//! Session policy and atomic fences. Secret generation/encryption are runtime responsibilities.
//! Rotated-token hashes stay until the family expires, even after its recovery receipt is purged.
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use sha2::{Digest, Sha256};

pub const ACCESS_LIFETIME_MS: i64 = 15 * 60 * 1000;
pub const IDLE_LIFETIME_MS: i64 = 30 * 24 * 60 * 60 * 1000;
pub const MAX_LIFETIME_MS: i64 = 90 * 24 * 60 * 60 * 1000;
pub const RETRY_LIFETIME_MS: i64 = IDLE_LIFETIME_MS;
pub const SCHEMA: &str = include_str!("../../../migrations/0002_sessions.sql");

/// Hash only cryptographically random, canonical 32-byte bearer material. Never log input.
pub fn token_hash(token: &str) -> Option<[u8; 32]> {
    let bytes = URL_SAFE_NO_PAD.decode(token).ok()?;
    if bytes.len() != 32 {
        return None;
    }
    Some(Sha256::digest(bytes).into())
}
#[derive(Debug, PartialEq, Eq)]
pub enum RefreshDecision {
    Rotate,
    ReturnEncryptedReceipt,
    RevokeFamily,
    AuthenticationRequired,
}
pub struct RefreshState<'a> {
    pub revoked: bool,
    pub deployment: &'a str,
    pub absolute_expires_at_ms: i64,
    pub idle_expires_at_ms: i64,
    pub rotated_operation_id: Option<&'a str>,
    pub rotated_at_ms: Option<i64>,
    pub receipt_operation_id: Option<&'a str>,
    pub receipt_expires_at_ms: Option<i64>,
}
pub fn decide_refresh(
    state: &RefreshState<'_>,
    deployment: &str,
    operation_id: &str,
    now_ms: i64,
) -> RefreshDecision {
    if now_ms < 0
        || state.revoked
        || state.deployment != deployment
        || state.absolute_expires_at_ms <= now_ms
        || state.idle_expires_at_ms <= now_ms
    {
        return RefreshDecision::AuthenticationRequired;
    }
    match (state.rotated_operation_id, state.rotated_at_ms) {
        (None, None) => RefreshDecision::Rotate,
        (Some(previous), Some(rotated))
            if previous == operation_id
                && state.receipt_operation_id == Some(operation_id)
                && rotated <= now_ms
                && now_ms < rotated.saturating_add(RETRY_LIFETIME_MS)
                && state
                    .receipt_expires_at_ms
                    .is_some_and(|expiry| now_ms < expiry) =>
        {
            RefreshDecision::ReturnEncryptedReceipt
        }
        (Some(previous), Some(_)) if previous == operation_id => {
            RefreshDecision::AuthenticationRequired
        }
        _ => RefreshDecision::RevokeFamily,
    }
}
/// Include in every authenticated write's single batch, including idempotent receipt retrieval.
/// Params: guard, session, participant, installation, deployment, now, access-token hash.
pub const SESSION_GUARD_SQL: &str = r#"
INSERT INTO mutation_guards(guard_id,valid) VALUES (?1, CASE WHEN EXISTS (
 SELECT 1 FROM sessions s JOIN access_tokens a ON a.session_id=s.session_id
 WHERE s.session_id=?2 AND s.participant_id=?3 AND s.device_id=?4 AND s.deployment=?5
 AND s.revoked=0 AND s.absolute_expires_at_ms>?6 AND s.idle_expires_at_ms>?6
 AND a.token_hash=?7 AND a.expires_at_ms>?6
) THEN 1 ELSE 0 END)
"#;
/// First write of rotation. Subsequent writes rotate old hash, add new hashes, encrypted receipt,
/// update idle expiry and remove guard in this same batch. No out-of-transaction read is authority.
pub const REFRESH_GUARD_SQL: &str = r#"
INSERT INTO mutation_guards(guard_id,valid) VALUES (?1, CASE WHEN EXISTS (
 SELECT 1 FROM sessions s JOIN refresh_tokens t ON t.session_id=s.session_id
 WHERE s.session_id=?2 AND s.deployment=?3 AND s.revoked=0
 AND s.absolute_expires_at_ms>?4 AND s.idle_expires_at_ms>?4
 AND t.token_hash=?5 AND t.rotated_operation_id IS NULL
) AND NOT EXISTS (SELECT 1 FROM refresh_receipts WHERE session_id=?2 AND operation_id=?6)
THEN 1 ELSE 0 END)
"#;
pub const REVOKE_FAMILY_SQL: &str = "UPDATE sessions SET revoked=1 WHERE session_id=?1";

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lost_refresh_response_can_be_recovered_after_offline_period() {
        let state = RefreshState {
            revoked: false,
            deployment: "production",
            absolute_expires_at_ms: 4_000_000_000,
            idle_expires_at_ms: 4_000_000_000,
            rotated_operation_id: Some("op"),
            rotated_at_ms: Some(100),
            receipt_operation_id: Some("op"),
            receipt_expires_at_ms: Some(4_000_000_000),
        };
        assert_eq!(
            decide_refresh(&state, "production", "op", 120_100),
            RefreshDecision::ReturnEncryptedReceipt
        );
    }
    #[test]
    fn refresh_recovery_is_short_scoped_and_reuse_revokes() {
        let mut state = RefreshState {
            revoked: false,
            deployment: "production",
            absolute_expires_at_ms: 1000000,
            idle_expires_at_ms: 1000000,
            rotated_operation_id: None,
            rotated_at_ms: None,
            receipt_operation_id: None,
            receipt_expires_at_ms: None,
        };
        assert_eq!(
            decide_refresh(&state, "production", "op", 100),
            RefreshDecision::Rotate
        );
        state.rotated_operation_id = Some("op");
        state.rotated_at_ms = Some(100);
        state.receipt_operation_id = Some("op");
        state.receipt_expires_at_ms = Some(1000000);
        assert_eq!(
            decide_refresh(&state, "production", "op", 60099),
            RefreshDecision::ReturnEncryptedReceipt
        );
        assert_eq!(
            decide_refresh(&state, "production", "op", 1000000),
            RefreshDecision::AuthenticationRequired
        );
        assert_eq!(
            decide_refresh(&state, "production", "other", 101),
            RefreshDecision::RevokeFamily
        );
        assert_eq!(
            decide_refresh(&state, "other", "op", 101),
            RefreshDecision::AuthenticationRequired
        );
        state.revoked = true;
        assert_eq!(
            decide_refresh(&state, "other", "op", 101),
            RefreshDecision::AuthenticationRequired
        );
        assert!(token_hash(&URL_SAFE_NO_PAD.encode([1u8; 32])).is_some());
        assert!(token_hash("short").is_none());
    }
}
