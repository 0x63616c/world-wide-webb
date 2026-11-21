-- Anonymous usage analytics. Rows are keyed by a random per-install analytics ID that is
-- never joined to participants, sessions or network addresses. Raw events are kept indefinitely.
CREATE TABLE analytics_installs (
  analytics_id TEXT PRIMARY KEY,
  app_version TEXT NOT NULL,
  build INTEGER NOT NULL,
  channel TEXT NOT NULL,
  os_version TEXT NOT NULL,
  device_model TEXT NOT NULL,
  region TEXT,
  locale TEXT NOT NULL,
  competition INTEGER NOT NULL,
  first_seen_ms INTEGER NOT NULL,
  last_received_ms INTEGER NOT NULL
);
CREATE INDEX analytics_installs_received ON analytics_installs(last_received_ms);
CREATE TABLE analytics_events (
  analytics_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  timezone_id TEXT NOT NULL,
  local_day TEXT NOT NULL,
  local_hour INTEGER NOT NULL,
  local_weekday INTEGER NOT NULL,
  backfill INTEGER NOT NULL,
  detail TEXT,
  received_at_ms INTEGER NOT NULL,
  PRIMARY KEY (analytics_id, event_id)
);
CREATE INDEX analytics_events_at ON analytics_events(at_ms);
CREATE INDEX analytics_events_install_at ON analytics_events(analytics_id, at_ms);
CREATE INDEX analytics_events_resets ON analytics_events(analytics_id, at_ms) WHERE kind = 'reset';
CREATE TABLE analytics_removed_events (
  analytics_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  PRIMARY KEY (analytics_id, event_id)
);
