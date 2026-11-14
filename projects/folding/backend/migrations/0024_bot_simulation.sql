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
 created_at_ms INTEGER NOT NULL
);
CREATE INDEX bot_profiles_active ON bot_profiles(retired_at_ms,joined_at_ms);

CREATE TABLE bot_simulation_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 watermark_ms INTEGER NOT NULL DEFAULT 0 CHECK(watermark_ms>=0),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);
INSERT INTO bot_simulation_state(singleton,watermark_ms,revision) VALUES(1,0,0);
