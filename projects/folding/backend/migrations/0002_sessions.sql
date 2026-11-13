-- No plaintext bearer, refresh, Apple authorization, or retry secrets belong in D1.
CREATE TABLE sessions (
  session_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  deployment TEXT NOT NULL CHECK(deployment IN ('staging','production')),
  created_at_ms INTEGER NOT NULL CHECK(created_at_ms >= 0),
  authenticated_at_ms INTEGER NOT NULL CHECK(authenticated_at_ms >= created_at_ms),
  absolute_expires_at_ms INTEGER NOT NULL CHECK(absolute_expires_at_ms > created_at_ms),
  idle_expires_at_ms INTEGER NOT NULL CHECK(idle_expires_at_ms <= absolute_expires_at_ms),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
CREATE INDEX sessions_owner ON sessions(participant_id);
CREATE INDEX sessions_expiry ON sessions(idle_expires_at_ms);
CREATE TABLE access_tokens (
  token_hash BLOB PRIMARY KEY CHECK(length(token_hash)=32),
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX access_expiry ON access_tokens(expires_at_ms);
CREATE TABLE refresh_tokens (
  token_hash BLOB PRIMARY KEY CHECK(length(token_hash)=32),
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  issued_at_ms INTEGER NOT NULL,
  rotated_operation_id TEXT,
  rotated_at_ms INTEGER,
  CHECK((rotated_operation_id IS NULL)=(rotated_at_ms IS NULL))
);
CREATE INDEX refresh_family ON refresh_tokens(session_id);
CREATE TABLE refresh_receipts (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  original_token_hash BLOB NOT NULL REFERENCES refresh_tokens(token_hash),
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY(session_id,operation_id)
);
ALTER TABLE challenges ADD COLUMN session_id TEXT REFERENCES sessions(session_id) ON DELETE CASCADE;
CREATE INDEX challenges_session ON challenges(session_id);
