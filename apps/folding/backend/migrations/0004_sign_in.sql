ALTER TABLE participants
ADD COLUMN account_state TEXT NOT NULL DEFAULT 'active' CHECK (
  account_state IN ('active', 'deleting', 'deleted')
);

CREATE TABLE profiles (
  participant_id TEXT PRIMARY KEY REFERENCES participants (participant_id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  avatar_id TEXT,
  nickname_status TEXT NOT NULL CHECK (nickname_status IN ('approved', 'pending')),
  avatar_status TEXT NOT NULL CHECK (
    avatar_status IN ('none', 'pending', 'approved', 'rejected')
  )
);

CREATE TABLE sign_in_receipts (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  session_id TEXT NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges (challenge_id),
  normalized_hash BLOB NOT NULL CHECK (length (normalized_hash) = 32),
  participant_revision INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (participant_id, operation_id)
);

CREATE INDEX sign_in_receipt_expiry ON sign_in_receipts (expires_at_ms);

-- Operation IDs are participant/route scoped, including across different session families.
CREATE TABLE refresh_receipts_v2 (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  original_token_hash BLOB NOT NULL REFERENCES refresh_tokens (token_hash),
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (participant_id, operation_id),
  UNIQUE (session_id, operation_id)
);

INSERT INTO
  refresh_receipts_v2
SELECT
  s.participant_id,
  r.session_id,
  r.operation_id,
  r.original_token_hash,
  r.ciphertext,
  r.key_version,
  r.expires_at_ms
FROM
  refresh_receipts r
  JOIN sessions s ON s.session_id = r.session_id;

DROP TABLE refresh_receipts;

ALTER TABLE refresh_receipts_v2
RENAME TO refresh_receipts;

CREATE INDEX refresh_receipt_expiry ON refresh_receipts (expires_at_ms);

CREATE TABLE session_operations_v2 (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions (session_id) ON DELETE CASCADE,
  family TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  normalized_hash BLOB NOT NULL CHECK (length (normalized_hash) = 32),
  response_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (participant_id, family, operation_id)
);

INSERT INTO
  session_operations_v2
SELECT
  s.participant_id,
  o.session_id,
  o.family,
  o.operation_id,
  o.normalized_hash,
  o.response_json,
  o.created_at_ms
FROM
  session_operations o
  JOIN sessions s ON s.session_id = o.session_id;

DROP TABLE session_operations;

ALTER TABLE session_operations_v2
RENAME TO session_operations;

-- Keep non-secret operation tombstones after short-lived encrypted receipts expire.
CREATE TABLE auth_operation_claims (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  family TEXT NOT NULL CHECK (family IN ('sign_in', 'refresh', 'logout')),
  operation_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  PRIMARY KEY (participant_id, family, operation_id)
);

INSERT INTO
  auth_operation_claims
SELECT
  participant_id,
  'refresh',
  operation_id,
  session_id,
  expires_at_ms -60000
FROM
  refresh_receipts;

INSERT INTO
  auth_operation_claims
SELECT
  participant_id,
  family,
  operation_id,
  session_id,
  created_at_ms
FROM
  session_operations;
