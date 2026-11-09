-- Secrets remain encrypted with keys stored in Worker bindings, never D1.
CREATE TABLE auth_rate_windows (
  key_hash BLOB NOT NULL CHECK(length(key_hash)=32),
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count>=0),
  PRIMARY KEY(key_hash,window_ms)
);
CREATE INDEX auth_rate_expiry ON auth_rate_windows(window_ms);
CREATE TABLE apple_authorizations (
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  deployment TEXT NOT NULL CHECK(deployment IN ('staging','production')),
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  PRIMARY KEY(participant_id,deployment)
);
CREATE TABLE session_operations (
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  normalized_hash BLOB NOT NULL CHECK(length(normalized_hash)=32),
  response_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY(session_id,family,operation_id)
);
CREATE TABLE push_installations (
  device_id TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  deployment TEXT NOT NULL CHECK(deployment IN ('staging','production')),
  environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
  token_ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  topic TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  PRIMARY KEY(participant_id,device_id,deployment)
);

CREATE INDEX refresh_receipt_expiry ON refresh_receipts(expires_at_ms);
