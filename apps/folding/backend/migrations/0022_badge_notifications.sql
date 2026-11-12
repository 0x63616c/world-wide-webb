CREATE TABLE badge_notification_preferences (
  participant_id TEXT PRIMARY KEY REFERENCES participants (participant_id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
);

CREATE TABLE badge_notification_jobs (
  participant_id TEXT NOT NULL REFERENCES participants (participant_id) ON DELETE CASCADE,
  generation_revision INTEGER NOT NULL,
  generation_id TEXT NOT NULL,
  badge_id TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('pending', 'sent', 'suppressed', 'failed')
  ),
  delivery_id TEXT,
  lease_until_ms INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_ms INTEGER NOT NULL DEFAULT 0,
  sent_at_ms INTEGER,
  last_error TEXT,
  PRIMARY KEY (
    participant_id,
    generation_revision,
    generation_id,
    badge_id
  )
);

CREATE INDEX badge_notifications_due ON badge_notification_jobs (state, next_attempt_ms, lease_until_ms);
