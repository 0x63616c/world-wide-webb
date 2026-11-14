# Leaderboard bot simulation

The simulation is disabled by default. Migration `0024_bot_simulation.sql` adds a server-only
`bot_profiles` marker (including pause, avatar style, and revision), a resumable watermark with
cursor, `participant_roles`, `bot_simulation_audit`, and
`administrative_configuration.bot_simulation_enabled` with a database default of `0`. Leave the flag
off until Calum reviews this change and explicitly opts in. The audited Operations page exposes the
flag; every change is revision-fenced and recorded in the existing operations audit.

Enabling the flag makes the existing jobs cron pick up a `bot_simulation` category and run
`bot_simulation_runtime::tick`. The tick is a no-op while the flag is off. A dry-run from the admin
Bots page returns the current active roster size and does not write observations, roster rows, or
watermark updates.

## Roster, personas, and avatars

Versioned personas live in `backend/crates/worker/personas-v1.json`. The runtime cycles the
templates across the roster and stores each bot's concrete persona id, version, and seed. Add a new
persona version instead of changing an existing version's meaning; keep old definitions until bots
using that version have been migrated or retired.

Launch policy: 50 bots at first enable, two additional joins per week, cap of 150. Names come from
the approved lists in `backend/crates/worker/policies/names-v1.json`. Avatars are generated
(`none`, `initials`, `illustrated`, `solid`, `black`). Photo-style avatars are a pluggable manifest
at `backend/crates/worker/policies/photo-avatars.manifest.json` and ship empty. Do not add
photographs of real people. Attach only explicitly licensed or illustrated assets later.

Synthetic `subject_hmac` values use a domain-separated, server-generated namespace and are checked
for uniqueness before creation.

## Ranking caps

Caps are applied before event writes. Public scores still come from ordinary observation replay:

- A bot is never #1 and is strictly below the top real score on week, month, and all-time boards.
- A tie with the human leader is rejected.
- An empty human board permits only a zero score.
- Recheck the live real-player leader before each observation batch so an inactive leader makes
  bots throttle.

## Admin surfaces

Public `/v1` DTOs must remain free of bot and persona fields so builds 13–32 stay compatible.
`/v1/me` may include `is_admin` (unknown keys are ignored by older clients). The bot marker is
server-only.

App-admin access uses `participant_roles` (`role = 'admin'`) and an optional
`ADMIN_PARTICIPANT_IDS` binding: a comma-separated list of participant UUIDs. If the binding is
missing, the list is empty and only the roles table grants access. Do not invent or hard-code a
guessed UUID. After confirming the production identifier (Calum's participant id starts with
`230abb54`), grant the role or add that verified id to the binding.

`GET /v1/admin/participants/{id}` is admin-only and returns 404 for everyone else, including
authenticated non-admins. The payload may include `is_bot` and persona fields. The iOS client
fetches `is_admin` from `/v1/me` and, only then, may show a subtle marker on leaderboard rows and
an admin details section on a profile. The web Bots page lists, pauses, resumes, and retires bots
and can run a dry tick.

## Rollback and purge

The purge script below targets only rows marked in `bot_profiles`; it does not touch human
participants, epochs, observations, scores, profiles, avatars, or accounts. It removes each bot’s
avatar rows after queuing the corresponding R2 object keys. Review its target count first. It
queues both R2 avatar keys before deleting bot participants (cascades remove their D1 observations,
scores, profiles, milestones, and bot metadata). Process `avatar_purge_jobs` to remove those R2
objects before clearing the queue. Finally reset the single simulation watermark.

```sh
# Review target count first, then run against the intended D1 database.
npx wrangler d1 execute folding-production --remote --command \
  "SELECT COUNT(*) AS bot_count FROM bot_profiles;"
npx wrangler d1 execute folding-production --remote --file \
  projects/folding/backend/scripts/purge-bots.sql
```

The script leaves the administrative flag off and preserves the audit trail. It never deletes human
rows. Take the normal approved database backup before using it.
