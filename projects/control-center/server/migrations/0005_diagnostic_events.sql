CREATE TABLE diagnostic_event (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    received_at TEXT NOT NULL,
    data_json TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    UNIQUE (device_id, event_id)
);
CREATE INDEX diagnostic_event_device_seq ON diagnostic_event(device_id, seq DESC);
