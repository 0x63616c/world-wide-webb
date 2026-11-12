CREATE TABLE external_retry_state (
  retry_id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  work_key TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'failed', 'paused')),
  attempts INTEGER NOT NULL,
  next_attempt_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  last_error TEXT,
  PRIMARY KEY (kind, work_key)
);
