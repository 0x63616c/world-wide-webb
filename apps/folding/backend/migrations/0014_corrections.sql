CREATE TABLE period_corrections (
 correction_id TEXT PRIMARY KEY,
 period_id TEXT NOT NULL REFERENCES periods(period_id),
 base_version INTEGER NOT NULL,
 version INTEGER NOT NULL,
 actor TEXT NOT NULL,
 reason TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 state TEXT NOT NULL CHECK(state IN('building','ready','published','expired')),
 created_at_ms INTEGER NOT NULL,
 expires_at_ms INTEGER NOT NULL,
 decision_watermark INTEGER NOT NULL,
 preview_hash TEXT,
 publish_operation_id TEXT UNIQUE,
 published_at_ms INTEGER,
 UNIQUE(period_id,version)
);
CREATE UNIQUE INDEX one_active_correction ON period_corrections(period_id) WHERE state IN('building','ready');
