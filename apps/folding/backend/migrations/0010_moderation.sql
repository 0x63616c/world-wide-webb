ALTER TABLE nickname_requests
ADD COLUMN policy_version TEXT NOT NULL DEFAULT '2026-11-07-v1';

ALTER TABLE participants
ADD COLUMN suspended_until_ms INTEGER;

CREATE TABLE rate_limits (
  key_hash BLOB NOT NULL,
  window_ms INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (key_hash, window_ms)
);

CREATE TABLE reports (
  report_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  subject_participant_id TEXT NOT NULL,
  content_id TEXT,
  reason TEXT NOT NULL,
  comment TEXT,
  created_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'closed'))
);

CREATE TABLE moderation_actions (
  actor TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  normalized_hash BLOB NOT NULL,
  created_at_ms INTEGER NOT NULL,
  expires_at_ms INTEGER NOT NULL,
  PRIMARY KEY (actor, operation_id)
);

ALTER TABLE observations
ADD COLUMN submission_id TEXT;

CREATE INDEX observations_submission ON observations (participant_id, submission_id);

ALTER TABLE reports
ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

ALTER TABLE reports
ADD COLUMN closed_at_ms INTEGER;
