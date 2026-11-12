CREATE TABLE monitor (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  last_slot INTEGER NOT NULL DEFAULT -1,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures BETWEEN 0 AND 5),
  incident TEXT,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);

INSERT INTO
  monitor (singleton)
VALUES
  (1);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  incident TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('down', 'recovery')),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 12),
  not_before INTEGER NOT NULL DEFAULT 0,
  lease TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  UNIQUE (incident, category)
);

CREATE INDEX notifications_due ON notifications (status, not_before, created_at);
