CREATE TABLE epochs (
  epoch_id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  issued_at_ms INTEGER NOT NULL,
  closed_at_ms INTEGER
);

CREATE TABLE competition_operations (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  route TEXT NOT NULL,
  normalized_hash BLOB NOT NULL CHECK (length (normalized_hash) = 32),
  response_json TEXT NOT NULL,
  PRIMARY KEY (participant_id, operation_id)
);

CREATE TABLE observations (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  disposition TEXT NOT NULL CHECK (
    disposition IN ('accepted', 'quarantined', 'rejected')
  ),
  reason_code TEXT,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (participant_id, event_id),
  UNIQUE (participant_id, device_id, sequence)
);

CREATE TABLE live_scores (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  folds INTEGER NOT NULL CHECK (folds >= 0),
  revision INTEGER NOT NULL,
  PRIMARY KEY (participant_id, period_id)
);

CREATE TABLE score_jobs (
  participant_id TEXT PRIMARY KEY REFERENCES participants (participant_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed'))
);

CREATE TABLE nickname_requests (
  participant_id TEXT PRIMARY KEY REFERENCES participants (participant_id) ON DELETE CASCADE,
  requested_nickname TEXT NOT NULL,
  requested_at_ms INTEGER NOT NULL
);
