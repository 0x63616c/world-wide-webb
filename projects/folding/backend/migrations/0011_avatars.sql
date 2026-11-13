CREATE TABLE avatar_objects (
 avatar_id TEXT PRIMARY KEY,
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 operation_id TEXT NOT NULL,
 normalized_hash BLOB NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('uploading','pending','approved','rejected','removed')),
 original_key TEXT NOT NULL UNIQUE,
 derivative_key TEXT NOT NULL UNIQUE,
 created_at_ms INTEGER NOT NULL,
 reason_code TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(participant_id,operation_id)
);
CREATE UNIQUE INDEX one_pending_avatar ON avatar_objects(participant_id) WHERE state='pending';
CREATE TABLE avatar_purge_jobs (
 object_key TEXT PRIMARY KEY,
 participant_id TEXT NOT NULL,
 lease_until_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE avatar_alerts (
 avatar_id TEXT PRIMARY KEY REFERENCES avatar_objects(avatar_id) ON DELETE CASCADE,
 state TEXT NOT NULL CHECK(state IN ('pending','sent','reviewed','failed')),
 lease_until_ms INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0
);
