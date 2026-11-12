CREATE TABLE decision_clock (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  version INTEGER NOT NULL
);

INSERT INTO
  decision_clock
VALUES
  (1, 0);

ALTER TABLE observations
ADD COLUMN decision_version INTEGER NOT NULL DEFAULT 0;

CREATE TABLE periods (
  period_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('week', 'month')),
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  cutoff_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('open', 'grace', 'finalizing', 'finalized')
  ),
  target_version INTEGER NOT NULL DEFAULT 1,
  published_version INTEGER NOT NULL DEFAULT 0,
  freeze_ms INTEGER,
  decision_watermark INTEGER,
  finalized_at_ms INTEGER,
  population INTEGER NOT NULL DEFAULT 0,
  UNIQUE (kind, start_ms)
);

CREATE TABLE period_roster (
  period_id TEXT NOT NULL REFERENCES periods (period_id),
  version INTEGER NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'completed', 'removed')),
  PRIMARY KEY (period_id, version, participant_id)
);

CREATE TABLE finalization_inputs (
  period_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  participant_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_json TEXT NOT NULL,
  decision_version INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (period_id, version, participant_id, event_id),
  FOREIGN KEY (period_id, version, participant_id) REFERENCES period_roster (period_id, version, participant_id) ON DELETE CASCADE
);

CREATE TABLE staged_results (
  period_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  participant_id TEXT NOT NULL,
  folds INTEGER NOT NULL CHECK (folds >= 0),
  PRIMARY KEY (period_id, version, participant_id),
  FOREIGN KEY (period_id, version, participant_id) REFERENCES period_roster (period_id, version, participant_id) ON DELETE CASCADE
);

CREATE TABLE results (
  period_id TEXT NOT NULL REFERENCES periods (period_id),
  version INTEGER NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  folds INTEGER NOT NULL,
  rank INTEGER NOT NULL,
  population INTEGER NOT NULL,
  percentile INTEGER,
  medal TEXT CHECK (medal IN ('gold', 'silver', 'bronze')),
  PRIMARY KEY (period_id, version, participant_id)
);

CREATE TABLE award_jobs (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  period_id TEXT NOT NULL REFERENCES periods (period_id),
  kind TEXT NOT NULL DEFAULT 'original_award' CHECK (kind = 'original_award'),
  result_version INTEGER NOT NULL,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  joined_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'suppressed', 'sent', 'failed')
  ),
  due_ms INTEGER,
  PRIMARY KEY (participant_id, period_id, kind)
);
