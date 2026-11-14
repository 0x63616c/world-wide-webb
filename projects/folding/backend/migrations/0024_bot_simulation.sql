ALTER TABLE administrative_configuration
 ADD COLUMN bot_simulation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(bot_simulation_enabled IN(0,1));

-- Bot identity is private operational metadata. Public DTO queries continue to select profiles only.
CREATE TABLE bot_profiles (
 participant_id TEXT PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
 persona_id TEXT NOT NULL,
 persona_version INTEGER NOT NULL CHECK(persona_version > 0),
 seed BLOB NOT NULL CHECK(length(seed)=32),
 joined_at_ms INTEGER NOT NULL,
 retired_at_ms INTEGER,
 paused_at_ms INTEGER,
 avatar_style TEXT NOT NULL DEFAULT 'none',
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX bot_profiles_active ON bot_profiles(retired_at_ms,joined_at_ms);

CREATE TABLE bot_simulation_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 watermark_ms INTEGER NOT NULL DEFAULT 0 CHECK(watermark_ms>=0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 cursor_participant_id TEXT,
 launch_started_at_ms INTEGER
);
INSERT INTO bot_simulation_state(singleton,watermark_ms,revision) VALUES(1,0,0);

-- Roles are private server authorization data. Populate only after an operator verifies the
-- participant UUID from the authenticated account record.
CREATE TABLE participant_roles (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('admin')),
 granted_at_ms INTEGER NOT NULL,
 granted_by TEXT NOT NULL,
 PRIMARY KEY(participant_id,role)
);
CREATE TABLE bot_simulation_audit (
 audit_id TEXT PRIMARY KEY,
 actor TEXT NOT NULL,
 operation TEXT NOT NULL CHECK(operation IN ('pause','resume','retire','dry_run')),
 participant_id TEXT,
 reason TEXT NOT NULL,
 created_at_ms INTEGER NOT NULL
);
