-- Unenrolled key IDs cannot use challenges.key_id's foreign key yet.
ALTER TABLE challenges
ADD COLUMN enrollment_key_id TEXT;

ALTER TABLE challenges
ADD COLUMN nonce_ciphertext BLOB;

ALTER TABLE challenges
ADD COLUMN nonce_key_version TEXT;

ALTER TABLE attestation_keys
ADD COLUMN attestation_environment TEXT CHECK (
  attestation_environment IN ('development', 'production')
);

CREATE TABLE attestation_receipts (
  key_id TEXT PRIMARY KEY REFERENCES attestation_keys (key_id) ON DELETE CASCADE,
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL
);

CREATE TABLE attestation_operations (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  key_id TEXT NOT NULL REFERENCES attestation_keys (key_id) ON DELETE CASCADE,
  normalized_hash BLOB NOT NULL CHECK (length (normalized_hash) = 32),
  response_json TEXT NOT NULL,
  PRIMARY KEY (participant_id, operation_id)
);
