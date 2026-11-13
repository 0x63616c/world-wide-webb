CREATE TABLE ingestion_metrics (
 minute_ms INTEGER PRIMARY KEY,
 requests INTEGER NOT NULL,
 failures INTEGER NOT NULL
);
CREATE TABLE operational_alerts (
 code TEXT PRIMARY KEY,
 active INTEGER NOT NULL CHECK(active IN(0,1)),
 value INTEGER NOT NULL,
 updated_at_ms INTEGER NOT NULL
);
