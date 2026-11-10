//! Guard statement shared by concrete mutation operations. A stale condition deliberately violates
//! CHECK(valid=1), rather than treating a zero-row UPDATE as a transactional failure.
pub const SCHEMA: &str = include_str!("../../../migrations/0001_mutation_fences.sql");
pub const GUARD_SQL: &str = r#"
INSERT INTO mutation_guards(guard_id,valid)
VALUES (?1, CASE WHEN EXISTS (
 SELECT 1 FROM participants p
 JOIN participant_revisions r ON r.participant_id=p.participant_id
 JOIN attestation_keys k ON k.participant_id=p.participant_id
 JOIN challenges c ON c.participant_id=p.participant_id AND c.key_id=k.key_id
 JOIN sessions s ON s.participant_id=p.participant_id AND s.session_id=c.session_id
 JOIN access_tokens a ON a.session_id=s.session_id
 WHERE p.participant_id=?2 AND r.revision=?3
 AND p.membership='joined' AND p.restriction='none'
 AND p.epoch_id=?4 AND p.generation_revision=?5 AND p.generation_id=?6
 AND p.active_device_id=?7 AND k.device_id=?7 AND c.device_id=?7
 AND k.key_id=?8 AND k.deployment=?9 AND c.deployment=?9 AND k.revoked=0
 AND k.counter=?10 AND ?11>?10 AND ?11<=4294967295
 AND s.session_id=?16 AND s.device_id=?7 AND s.deployment=?9 AND s.revoked=0
 AND s.absolute_expires_at_ms>?14 AND s.idle_expires_at_ms>?14
 AND a.token_hash=?17 AND a.expires_at_ms>?14
 AND c.challenge_id=?12 AND c.purpose=?13 AND c.used=0 AND c.expires_at_ms>?14 AND c.nonce_hash=?15
) THEN 1 ELSE 0 END)
"#;
pub const CONSUME_CHALLENGE: &str = "UPDATE challenges SET used=1 WHERE challenge_id=?1";
pub const ADVANCE_COUNTER: &str = "UPDATE attestation_keys SET counter=?1 WHERE key_id=?2";
pub const ADVANCE_REVISION: &str =
    "UPDATE participant_revisions SET revision=revision+1 WHERE participant_id=?1";
pub const DELETE_GUARD: &str = "DELETE FROM mutation_guards WHERE guard_id=?1";

/// All fields come from authenticated server state and the verified assertion, never a claimed role.
/// Operation code supplies its concrete writes between the fence and cleanup in one D1 batch.
#[cfg(target_arch = "wasm32")]
pub async fn execute_guarded_batch(
    db: &worker::D1Database,
    guard: worker::D1PreparedStatement,
    mutation_statements: Vec<worker::D1PreparedStatement>,
    cleanup: worker::D1PreparedStatement,
) -> worker::Result<Vec<worker::D1Result>> {
    let mut statements = Vec::with_capacity(mutation_statements.len() + 2);
    statements.push(guard);
    statements.extend(mutation_statements);
    statements.push(cleanup);
    db.batch(statements).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::{Connection, params};
    fn database() -> Connection {
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch(SCHEMA).unwrap();
        db.execute_batch(crate::session::SCHEMA).unwrap();
        db.execute_batch("INSERT INTO participants VALUES ('p','subject','joined','none',0,'g','e','d'); INSERT INTO participant_revisions VALUES ('p',0); INSERT INTO attestation_keys VALUES ('k','p','d','production',x'01',0,0); INSERT INTO sessions VALUES ('s','p','d','production',0,0,1000,1000,0); INSERT INTO access_tokens VALUES (zeroblob(32),'s',1000); INSERT INTO challenges VALUES ('c','p','d','k','production','submit_events',x'02',100,0,'s'); CREATE TABLE test_receipts (operation_id TEXT PRIMARY KEY); CREATE TABLE test_jobs (job_id TEXT PRIMARY KEY);").unwrap();
        db
    }
    fn guard(db: &Connection, revision: i64, now: i64) -> rusqlite::Result<usize> {
        db.execute(
            GUARD_SQL,
            params![
                "guard",
                "p",
                revision,
                "e",
                0,
                "g",
                "d",
                "k",
                "production",
                0,
                1,
                "c",
                "submit_events",
                now,
                vec![2u8],
                "s",
                vec![0u8; 32]
            ],
        )
    }
    #[test]
    fn revocation_and_challenge_session_binding_are_rechecked_at_commit() {
        let db = database();
        db.execute("UPDATE sessions SET revoked=1 WHERE session_id='s'", [])
            .unwrap();
        assert!(guard(&db, 0, 1).is_err());
        db.execute("UPDATE sessions SET revoked=0 WHERE session_id='s'", [])
            .unwrap();
        db.execute(
            "UPDATE challenges SET session_id=NULL WHERE challenge_id='c'",
            [],
        )
        .unwrap();
        assert!(guard(&db, 0, 1).is_err());
        assert_eq!(
            db.query_row("SELECT count(*) FROM mutation_guards", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn stale_guard_is_an_error_not_zero_rows_and_rolls_back() {
        let mut db = database();
        let tx = db.transaction().unwrap();
        tx.execute("INSERT INTO test_jobs VALUES ('before')", [])
            .unwrap();
        assert!(guard(&tx, 1, 1).is_err());
        tx.rollback().unwrap();
        assert_eq!(
            db.query_row("SELECT count(*) FROM test_jobs", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn failure_after_challenge_counter_receipt_rolls_back_everything() {
        let mut db = database();
        let tx = db.transaction().unwrap();
        guard(&tx, 0, 1).unwrap();
        tx.execute(CONSUME_CHALLENGE, ["c"]).unwrap();
        tx.execute(ADVANCE_COUNTER, params![1, "k"]).unwrap();
        tx.execute("INSERT INTO test_receipts VALUES ('op')", [])
            .unwrap();
        tx.execute("INSERT INTO test_jobs VALUES ('job')", [])
            .unwrap();
        assert!(
            tx.execute("INSERT INTO test_receipts VALUES ('op')", [])
                .is_err()
        );
        tx.rollback().unwrap();
        for table in ["mutation_guards", "test_receipts", "test_jobs"] {
            assert_eq!(
                db.query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r
                    .get::<_, i64>(0))
                    .unwrap(),
                0
            );
        }
        assert_eq!(
            db.query_row("SELECT used FROM challenges", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            db.query_row("SELECT counter FROM attestation_keys", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[test]
    fn committed_counter_challenge_revision_prevent_replay_and_expiry_is_exclusive() {
        let mut db = database();
        assert!(guard(&db, 0, 100).is_err());
        let tx = db.transaction().unwrap();
        guard(&tx, 0, 99).unwrap();
        tx.execute(CONSUME_CHALLENGE, ["c"]).unwrap();
        tx.execute(ADVANCE_COUNTER, params![1, "k"]).unwrap();
        tx.execute(ADVANCE_REVISION, ["p"]).unwrap();
        tx.execute(DELETE_GUARD, ["guard"]).unwrap();
        tx.commit().unwrap();
        assert!(guard(&db, 0, 99).is_err());
    }
}
