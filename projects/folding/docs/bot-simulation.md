# Leaderboard bot simulation

The simulation is always on. There is no enable flag or admin switch. Migration
`0024_bot_simulation.sql` adds a server-only `bot_profiles` marker (including pause, avatar style,
and revision), a resumable watermark with cursor, `participant_roles` and `bot_simulation_audit`.
Migration `0025_bot_simulation_always_on.sql` drops the launch-era
`administrative_configuration.bot_simulation_enabled` flag.

The existing jobs cron schedules the `bot_simulation` category on every run and calls
`bot_simulation_runtime::tick`. The first tick creates the launch roster. Bot join dates are backdated for display only. Simulated
folds start on the launch day (`launch_started_at_ms`), never earlier. The tick then replays one UTC day at a time
and stops at today. Today's slice records only folds whose close time has passed, and later ticks add
the rest. A dry-run from the admin
Bots page returns the current active roster size and does not write observations, roster rows, or
watermark updates. Use the Bots page to pause, resume, or retire individual bots.

## Roster, personas, and avatars

New bots use the `seeded` persona (version 2). Each bot's activity is derived from its own stored
seed in `bot_simulation::seeded_persona`, not from a shared template. That covers usage tier,
weekday and weekend fold counts, the UTC waking window (spread across the day, so bots read as many
time zones), skipped days, and a display-only join date. Bots on the older
`backend/crates/worker/personas-v1.json` templates keep replaying with them until purged.

Launch policy: 50 bots on the first tick, two additional joins per week, cap of 150.

Names are hand-written and hard-coded in `backend/crates/worker/policies/bot-names-v2.json`. Each
bot takes the entry at its roster ordinal, so no two bots share a name. Keep the styles mixed
(gamer tags, handles, nicknames, full names, phrases, non-Latin names, rare emoji). Never generate
them. A unit test checks that the list covers the cap and that every name passes the real name
policy.

About 45% of bots get a distinct photo avatar; the rest keep the default avatar, like most real
players. Photos live in `backend/crates/worker/assets/bot-photos/`, and each one is listed in
`backend/crates/worker/policies/photo-avatars.manifest.json` with its subject, CC0 or Public Domain
Mark licence, creator and source. Every photo was reviewed by eye: no people, text, logos or
brands. `src/bot_photos.rs` embeds the files in manifest order, and a unit test keeps the two in
sync. Do not add photographs of people.

Synthetic `subject_hmac` values use a domain-separated, server-generated namespace and are checked
for uniqueness before creation.

## Ranking caps

Caps are applied before event writes. Public scores still come from ordinary observation replay:

- A bot is never #1 and is strictly below the top real score on week, month, and all-time boards.
- Each bot also has its own ceiling, 35–97% of the top real score (`ceiling_permille`), so bots
  settle at different points instead of tying at one cap.
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

The simulation recreates its roster on the next cron run, so deploy a revert of the simulation
before purging. The script preserves the audit trail. It never deletes human
rows. Take the normal approved database backup before using it.
