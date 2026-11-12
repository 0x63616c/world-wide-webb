CREATE TABLE administrative_configuration (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  revision INTEGER NOT NULL,
  competition_ingestion_enabled INTEGER NOT NULL CHECK (competition_ingestion_enabled IN (0, 1)),
  result_notifications_enabled INTEGER NOT NULL CHECK (result_notifications_enabled IN (0, 1)),
  avatar_uploads_enabled INTEGER NOT NULL CHECK (avatar_uploads_enabled IN (0, 1)),
  notification_failure TEXT
);

INSERT INTO
  administrative_configuration
VALUES
  (1, 0, 1, 1, 1, NULL);

CREATE TABLE operational_audit (
  operation_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  normalized_hash BLOB NOT NULL,
  reason TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  logical_key TEXT NOT NULL,
  version INTEGER NOT NULL,
  due_ms INTEGER NOT NULL,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  published_at_ms INTEGER,
  last_error TEXT,
  UNIQUE (kind, logical_key, version)
);

CREATE INDEX jobs_due ON jobs (state, due_ms, lease_until_ms);
