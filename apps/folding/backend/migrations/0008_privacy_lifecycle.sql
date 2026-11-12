CREATE TABLE reauthentications (
 token_hash BLOB PRIMARY KEY CHECK(length(token_hash)=32),
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 challenge_id TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 ciphertext BLOB NOT NULL,
 key_version TEXT NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 used INTEGER NOT NULL CHECK(used IN (0,1)),
 UNIQUE(participant_id,operation_id)
);
CREATE TABLE deletion_operations (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','completed','failed')),
 created_at_ms INTEGER NOT NULL,
 completed_at_ms INTEGER,
 recover_until_ms INTEGER,
 lease_until_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(participant_id,operation_id)
);
CREATE TABLE deletion_polling_tokens (
 token_hash BLOB PRIMARY KEY CHECK(length(token_hash)=32),
 participant_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 FOREIGN KEY(participant_id,operation_id) REFERENCES deletion_operations(participant_id,operation_id) ON DELETE CASCADE
);
CREATE TABLE apple_revocation_jobs (
 job_id TEXT PRIMARY KEY,
 deployment TEXT NOT NULL,
 ciphertext BLOB NOT NULL,
 key_version TEXT NOT NULL,
 lease_until_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE reauthentication_claims (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 PRIMARY KEY(participant_id,operation_id)
);
CREATE TABLE deletion_recovery_claims (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 PRIMARY KEY(participant_id,operation_id)
);
CREATE TABLE deletion_recovery_receipts (
 participant_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 deletion_operation_id TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 ciphertext BLOB NOT NULL,
 key_version TEXT NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 PRIMARY KEY(participant_id,operation_id),
 FOREIGN KEY(participant_id,operation_id) REFERENCES deletion_recovery_claims(participant_id,operation_id) ON DELETE CASCADE
);
