CREATE TABLE blocks (
 participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 subject_participant_id TEXT NOT NULL REFERENCES participants(participant_id) ON DELETE CASCADE,
 PRIMARY KEY(participant_id,subject_participant_id),
 CHECK(participant_id<>subject_participant_id)
);
