CREATE TABLE settings (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid (value)),
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE device_settings (
  device_id TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid (value)),
  updated_at_utc TEXT NOT NULL
);

CREATE TABLE walk (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  source TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  CHECK (
    ended_at IS NULL
    OR ended_at >= started_at
  ),
  CHECK (
    source IN ('iphone', 'ipad', 'mac', 'web', 'unknown')
  )
);

CREATE UNIQUE INDEX walk_one_active_idx ON walk ((1))
WHERE
  ended_at IS NULL
  AND deleted_at IS NULL;

CREATE INDEX walk_history_idx ON walk (started_at DESC, id DESC)
WHERE
  ended_at IS NOT NULL
  AND deleted_at IS NULL;

CREATE TABLE notification_revision (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);

INSERT INTO
  notification_revision
VALUES
  (1, 0);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  source_module TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  deep_link TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  read_at TEXT,
  dismissed_at TEXT,
  revision INTEGER NOT NULL UNIQUE
);

CREATE UNIQUE INDEX notifications_active_dedupe ON notifications (source_module, dedupe_key)
WHERE
  dismissed_at IS NULL;

CREATE INDEX notifications_revision_idx ON notifications (revision);

CREATE TABLE booth_photo (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('photo', 'burst', 'four_frame', 'gif')),
  group_id TEXT NOT NULL,
  frame_idx INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  filter TEXT,
  device_id TEXT,
  source_only INTEGER NOT NULL DEFAULT 0 CHECK (source_only IN (0, 1)),
  soft_deleted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX booth_photo_group_idx ON booth_photo (group_id);

CREATE INDEX booth_photo_captured_at_idx ON booth_photo (captured_at);
