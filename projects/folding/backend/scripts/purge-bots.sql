-- Purge only bot identities. Run only after reviewing the bot count and taking an approved backup.
PRAGMA foreign_keys = ON;

BEGIN IMMEDIATE;

INSERT INTO
  avatar_purge_jobs (object_key, participant_id)
SELECT
  a.original_key,
  a.participant_id
FROM
  avatar_objects a
  JOIN bot_profiles b USING (participant_id)
UNION
SELECT
  a.derivative_key,
  a.participant_id
FROM
  avatar_objects a
  JOIN bot_profiles b USING (participant_id) ON CONFLICT (object_key) DO NOTHING;

UPDATE avatar_objects
SET
  state = 'removed',
  reason_code = 'bot_purge',
  revision = revision + 1
WHERE
  participant_id IN (
    SELECT
      participant_id
    FROM
      bot_profiles
  );

UPDATE profiles
SET
  avatar_id = NULL,
  avatar_status = 'none'
WHERE
  participant_id IN (
    SELECT
      participant_id
    FROM
      bot_profiles
  );

DELETE FROM participants
WHERE
  participant_id IN (
    SELECT
      participant_id
    FROM
      bot_profiles
  );

UPDATE bot_simulation_state
SET
  watermark_ms = 0,
  revision = revision + 1
WHERE
  singleton = 1;

COMMIT;
