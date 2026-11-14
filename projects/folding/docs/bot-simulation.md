# Leaderboard simulation groundwork

The bot simulation is not active. Migration `0024_bot_simulation.sql` adds a server-only
`bot_profiles` marker, a resumable watermark row, and `administrative_configuration.bot_simulation_enabled`
with a database default of `0`. Leave the flag disabled until Calum reviews and explicitly opts in.
The audited Operations page exposes the flag; every change is revision-fenced and recorded in the
existing operations audit.

`backend/crates/worker/personas-v1.json` defines versioned behavior. The Rust `Persona` type and
`day_plan` function keep per-day event planning deterministic when seeded from a bot seed and local
date. The launch policy is 50 roster slots, two additional slots per week, and a documented cap of
150. The current data file is a small set of persona templates; a runtime must cycle templates and
store each bot's concrete persona id, version, and seed. Add a new persona version instead of changing
an existing version's meaning. Keep old definitions available until all bots using that version have
been migrated or retired. Names must be drawn from the approved word lists in
`backend/crates/worker/policies/names-v1.json`; photo avatars are not bundled, and future photo assets
must use an explicitly licensed manifest.

The score policy is intentionally conservative. A bot's next score must be at most one below the
current highest real score on each week, month, and all-time board. A tie with the human leader is
rejected. An empty human board permits only zero. Recheck the live real-player leader before each
observation batch so an inactive leader makes bots throttle. This cap must be applied before event
writes, then all public scores must still come from ordinary observation replay.

The current worker does not yet create bot participants or observations, replay bot events, expose an
admin-only participant detail API, or provide bot list/retire/dry-run controls. The flag is therefore
an inert safety control in this checkpoint; enabling it does not start a simulation. Those runtime
paths must be implemented and tested before any production opt-in. Public `/v1` DTOs must remain free
of bot/persona fields. Synthetic bot `subject_hmac` values must use a separate, domain-separated
server-generated namespace and be checked for uniqueness against all participant values before
creation.

## Rollback and purge

The purge script below targets only rows marked in `bot_profiles`; it does not touch human
participants, epochs, observations, scores, profiles, avatars, or accounts. It removes each bot’s avatar rows after queuing the corresponding R2 object keys. Review its target count
first. It queues both R2 avatar keys before deleting bot participants (cascades remove their D1
observations, scores, profiles, milestones, and bot metadata). Process `avatar_purge_jobs` to remove
those R2 objects before clearing the queue. Finally reset the single simulation watermark.

```sh
# Review target count first, then run against the intended D1 database.
npx wrangler d1 execute folding-production --remote --command \
  "SELECT COUNT(*) AS bot_count FROM bot_profiles;"
npx wrangler d1 execute folding-production --remote --file \
  projects/folding/backend/scripts/purge-bots.sql
```

The script leaves the administrative flag off and preserves the audit trail. It never deletes human
rows. Take the normal approved database backup before using it.
