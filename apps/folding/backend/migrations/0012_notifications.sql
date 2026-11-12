CREATE TABLE notification_preferences (
  participant_id TEXT PRIMARY KEY REFERENCES participants (participant_id) ON DELETE CASCADE,
  weekly TEXT NOT NULL CHECK (weekly IN ('off', 'all', 'podium')),
  monthly TEXT NOT NULL CHECK (monthly IN ('off', 'all', 'podium')),
  home_timezone TEXT NOT NULL,
  locale TEXT NOT NULL
);

ALTER TABLE push_installations
ADD COLUMN token_hash BLOB CHECK (
  token_hash IS NULL
  OR length (token_hash) = 32
);

CREATE UNIQUE INDEX one_push_token_owner ON push_installations (topic, environment, token_hash);

ALTER TABLE award_jobs
ADD COLUMN lease_until_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE award_jobs
ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;

ALTER TABLE award_jobs
ADD COLUMN next_attempt_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE award_jobs
ADD COLUMN last_error TEXT;

ALTER TABLE award_jobs
ADD COLUMN sent_at_ms INTEGER;

ALTER TABLE push_installations
ADD COLUMN registered_at_ms INTEGER NOT NULL DEFAULT 0;

CREATE TABLE apns_provider_tokens (
  cache_key TEXT PRIMARY KEY,
  issued_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  key_version TEXT NOT NULL
);
