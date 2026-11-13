CREATE TABLE moderation_cases (
 case_id TEXT PRIMARY KEY,
 participant_id TEXT NOT NULL,
 opened_at_ms INTEGER NOT NULL,
 closed_at_ms INTEGER
);
CREATE UNIQUE INDEX one_open_case ON moderation_cases(participant_id) WHERE closed_at_ms IS NULL;
CREATE TABLE moderation_action_cases (
 actor TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 case_id TEXT NOT NULL REFERENCES moderation_cases(case_id) ON DELETE CASCADE,
 PRIMARY KEY(actor,operation_id),
 FOREIGN KEY(actor,operation_id) REFERENCES moderation_actions(actor,operation_id) ON DELETE CASCADE
);
CREATE TABLE ban_reviews (
 participant_id TEXT PRIMARY KEY REFERENCES participants(participant_id) ON DELETE CASCADE,
 reviewed_at_ms INTEGER NOT NULL,
 next_review_at_ms INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN('imposed','upheld'))
);
INSERT INTO ban_reviews SELECT participant_id,CAST(strftime('%s','now') AS INTEGER)*1000,CAST(strftime('%s','now') AS INTEGER)*1000+31536000000,'imposed' FROM participants WHERE restriction='banned';
