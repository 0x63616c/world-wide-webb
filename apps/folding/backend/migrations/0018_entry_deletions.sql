-- Keep participant-owned tombstones even when the corresponding upload arrives later.
-- Immutable observations remain causal input. Only their scored contribution is suppressed.
CREATE TABLE deleted_observations (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  deleted_at_ms INTEGER NOT NULL CHECK (deleted_at_ms BETWEEN 0 AND 9007199254740991),
  PRIMARY KEY (participant_id, event_id)
);
