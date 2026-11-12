CREATE TABLE alarm (
  id TEXT PRIMARY KEY,
  definition TEXT NOT NULL CHECK (json_valid (definition)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  next_fire_at TEXT,
  request_key TEXT UNIQUE,
  request_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX alarm_due_idx ON alarm (enabled, next_fire_at);

CREATE TABLE alarm_ring (
  id TEXT PRIMARY KEY,
  alarm_id TEXT NOT NULL REFERENCES alarm (id) ON DELETE CASCADE,
  scheduled_at TEXT NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (
    status IN ('ringing', 'snoozed', 'stopped', 'missed')
  ),
  version INTEGER NOT NULL DEFAULT 0,
  ring_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  snooze_minutes INTEGER NOT NULL,
  light_target TEXT NOT NULL,
  lights_delivered_at TEXT,
  lights_retry_at TEXT NOT NULL,
  lights_attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (alarm_id, scheduled_at)
);

CREATE INDEX alarm_ring_pending_idx ON alarm_ring (status, ring_at);

CREATE TABLE device_state (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  label TEXT NOT NULL,
  reported_state TEXT CHECK (
    reported_state IS NULL
    OR json_valid (reported_state)
  ),
  reported_at_utc TEXT,
  reported_changed_at_utc TEXT,
  desired_state TEXT CHECK (
    desired_state IS NULL
    OR json_valid (desired_state)
  ),
  desired_at_utc TEXT,
  desired_until_utc TEXT,
  available INTEGER NOT NULL DEFAULT 0 CHECK (available IN (0, 1)),
  created_at_utc TEXT NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE INDEX device_state_kind_idx ON device_state (kind);

CREATE TABLE input_checkpoint (
  entity_id TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid (value))
);

CREATE TABLE integration_sync_status (
  integration_id TEXT PRIMARY KEY,
  last_polled_at_utc TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE lamp_mode (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT 'none',
  speed TEXT,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE latest_release (
  app TEXT PRIMARY KEY,
  build INTEGER NOT NULL CHECK (build > 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE sound_calibration (
  room_id TEXT PRIMARY KEY,
  baseline INTEGER NOT NULL,
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE weather_reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  target_hour TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  temp_f INTEGER NOT NULL,
  feels_f INTEGER NOT NULL,
  humidity INTEGER,
  weather_code INTEGER NOT NULL,
  wind_mph INTEGER,
  is_day INTEGER NOT NULL CHECK (is_day IN (0, 1)),
  precip_probability INTEGER,
  uv_index INTEGER
);

CREATE INDEX weather_reading_kind_target_recorded_idx ON weather_reading (kind, target_hour, recorded_at);

CREATE INDEX weather_reading_recorded_at_idx ON weather_reading (recorded_at);

CREATE TABLE weather_daily_reading (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  hi_f INTEGER NOT NULL,
  lo_f INTEGER NOT NULL,
  weather_code INTEGER NOT NULL,
  precip_probability INTEGER,
  sunrise_iso TEXT,
  sunset_iso TEXT
);

CREATE INDEX weather_daily_target_recorded_idx ON weather_daily_reading (target_date, recorded_at);

CREATE INDEX weather_daily_recorded_at_idx ON weather_daily_reading (recorded_at);
