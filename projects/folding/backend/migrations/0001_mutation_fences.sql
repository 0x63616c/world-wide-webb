-- Initial authentication/scoring fence schema. Further route-specific tables are additive migrations.
PRAGMA foreign_keys = ON;
CREATE TABLE participants (
  participant_id TEXT PRIMARY KEY,
  subject_hmac TEXT NOT NULL UNIQUE,
  membership TEXT NOT NULL CHECK (membership IN ('not_joined','joined','left')),
  restriction TEXT NOT NULL CHECK (restriction IN ('none','suspended','banned')),
  generation_revision INTEGER NOT NULL CHECK (generation_revision BETWEEN 0 AND 9007199254740991),
  generation_id TEXT NOT NULL,
  epoch_id TEXT,
  active_device_id TEXT
);
CREATE TABLE participant_revisions (
  participant_id TEXT PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL CHECK (revision BETWEEN 0 AND 9007199254740991)
);
CREATE TABLE attestation_keys (
  key_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  deployment TEXT NOT NULL CHECK (deployment IN ('staging','production')),
  public_key_sec1 BLOB NOT NULL,
  counter INTEGER NOT NULL CHECK (counter BETWEEN 0 AND 4294967295),
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1))
);
CREATE TABLE challenges (
  challenge_id TEXT PRIMARY KEY,
  participant_id TEXT REFERENCES participants(participant_id) ON DELETE CASCADE,
  device_id TEXT,
  key_id TEXT REFERENCES attestation_keys(key_id) ON DELETE CASCADE,
  deployment TEXT NOT NULL CHECK (deployment IN ('staging','production')),
  purpose TEXT NOT NULL,
  nonce_hash BLOB NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms BETWEEN 0 AND 9007199254740991),
  used INTEGER NOT NULL DEFAULT 0 CHECK (used IN (0,1))
);
CREATE INDEX challenge_expiry ON challenges(expires_at_ms);
CREATE TABLE mutation_guards (
  guard_id TEXT PRIMARY KEY,
  valid INTEGER NOT NULL CHECK (valid = 1)
);
