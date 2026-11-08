-- Derived competition projection. Backfill publishes only a complete, revision-fenced
-- participant generation; new/invalidated projections are not public awards.
CREATE TABLE milestone_state (
 participant_id TEXT PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
 generation_revision INTEGER NOT NULL CHECK(generation_revision>=0),
 generation_id TEXT NOT NULL,
 source_revision INTEGER NOT NULL CHECK(source_revision>=0),
 state TEXT NOT NULL CHECK(state IN ('building','ready')),
 folds INTEGER NOT NULL DEFAULT 0 CHECK(folds>=0),
 days_used INTEGER NOT NULL DEFAULT 0 CHECK(days_used>=0 AND days_used<=folds),
 cursor_device_id TEXT,
 cursor_sequence INTEGER,
 cursor_transition TEXT CHECK(cursor_transition IN ('open','close')),
 CHECK((cursor_device_id IS NULL)=(cursor_sequence IS NULL))
);
CREATE TABLE milestone_counted_events (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 event_id TEXT NOT NULL,
 observed_at_ms INTEGER NOT NULL CHECK(observed_at_ms>=0),
 PRIMARY KEY(participant_id,event_id)
);
CREATE INDEX milestone_counted_time ON milestone_counted_events(participant_id,observed_at_ms,event_id);
CREATE TABLE milestone_days (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 utc_day INTEGER NOT NULL CHECK(utc_day>=0),
 folds INTEGER NOT NULL CHECK(folds>=0),
 PRIMARY KEY(participant_id,utc_day)
);
CREATE TABLE milestone_grants (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 badge_id TEXT NOT NULL CHECK(badge_id IN ('folds_1','folds_100','folds_1000','folds_10000','days_7','days_30')),
 earned_at_ms INTEGER CHECK(earned_at_ms>=0),
 PRIMARY KEY(participant_id,badge_id)
);
CREATE TABLE milestone_featured (
 participant_id TEXT PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
 badge_id TEXT NOT NULL,
 FOREIGN KEY(participant_id,badge_id) REFERENCES milestone_grants(participant_id,badge_id) ON DELETE CASCADE
);
-- Acknowledgments survive revocation/re-earning within a generation, so a correction
-- cannot replay original celebrations. Reset purges this participant-owned state.
CREATE TABLE milestone_acknowledgments (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 badge_id TEXT NOT NULL CHECK(badge_id IN ('folds_1','folds_100','folds_1000','folds_10000','days_7','days_30')),
 PRIMARY KEY(participant_id,badge_id)
);
