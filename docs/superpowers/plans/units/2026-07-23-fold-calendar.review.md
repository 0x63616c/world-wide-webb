# Plan review — Fold calendar (event+clock) into features/events

Reviewer: independent plan-reviewer (did not author the plan). Verified against real
code at working HEAD. Read: the plan, features/weather/ (reference fold),
app-kit/define-app.ts + scripts/apps-gen/{validate,collect}.ts, and the real calendar
source (tile-registry, events router/service/schema/zod-schemas/seed, detail/registry,
the 47-file web subtree, biome boundary rule, knip.jsonc, drizzle.config).

## Verdict: APPROVE-WITH-FIXES

The structure is sound and mirrors the landed weather fold correctly: coords copied
verbatim, single-home invariant handled, boundary-safe, worker/enforcer correctly
left as nil (pure CRUD), cross-feature peek satisfied structurally. Two MAJOR snippet
bugs would turn the build red if copied literally, plus one PLACEHOLDER to resolve and
one wording nit. Fix the two MAJORs and ship.

Counts: 0 BLOCKER, 2 MAJOR, 2 MINOR.

---

## Verified correct (evidence)

- **Coords verbatim.** Registry `tile_clock` (26,27,5,3, `home:true`) lines 66-76 and
  `tile_event` ("Upcoming", 30,30,4,2) lines 98-106. Manifest snippet reproduces both
  exactly. Intra-app overlap: clock rows 27-29 vs event rows 30-31 disjoint →
  `overlaps()` false (row test `30 > 30` is false). No overlap.
- **Single global home.** No `features/*/manifest.ts` sets `home:` (grep empty).
  collect.ts:235 reads `home: Boolean(t.home)` off the manifest TileSpec; validate.ts:176
  throws on `!== 1`. Moving `home:true` onto the clock TileSpec keeps count at exactly 1.
  `HOME_TILE` resolves via `manifestToEntries` (tile-registry.ts:221) → `TILE_REGISTRY.find(t=>t.home)`.
- **guestExposed.** Neither tile is exposed; `GUEST_EXPOSED=["tile_guestwifi"]` untouched.
  validate.ts:149 parity holds (both feature and allowlist omit `tile_events`).
- **App id `tile_events` unused** (grep across apps/features/scripts empty).
- **Web closure = 47.** Name-scoped enumeration finds 54 calendar-ish source files;
  minus `detail/__tests__/clock-entry.test.ts` (stays) minus 6 `lib/time-suite/*`
  (shared substrate, stays) = 47. Matches the plan's Groups A–K exactly.
- **Closure is self-contained.** Only external importers of any moved path are
  `lib/tile-registry.ts` (4 direct component imports, lines 22-27) and
  `detail/registry.ts` (`../views/wiring/events`, `./wiring/clock`). `world-clocks`
  imported only by `detail/wiring/clock.tsx`. No non-calendar tile imports the subtree.
- **Peek is structural.** `trpc.events.list` is used inside `detail/wiring/clock.tsx:48`
  and reaches the feature procedure through the merged generated router — no apps/api
  import, no edit needed. Confirmed.
- **Boundary safe.** biome.json bans only `features/** → apps/api`; `apps/api → @features`
  is NOT banned (relevant to seed). Weather api.ts already uses `@app-kit/server` +
  `./service` + own `./db` — the exact pattern the plan mirrors.
- **No worker/cron/purge/enforcer.** grep of apps/worker/src, infra/src/crons.ts,
  apps/api/src/{purge,cron-run}.ts for `events` is empty. No `jobs.ts` facet correct.
- **Storybook glob** already `../../../features/**/*.stories.@(ts|tsx)` — covers
  features/events/web/**. No edit. **tile-title-sync** globs `features/*/web/*.tsx`
  (one level) + carries `tile_clock` in `NO_STATIC_TITLE`; EventsTileView renders
  `title="Upcoming"` (line 116) matching the label. Requires the two tile view files at
  `web/` top level — plan mandates this.
- **No migration churn.** drizzle.config `schema: features/_generated/schema.gen.ts`
  (the union) — moving the table between members of the union leaves the table SET
  identical, so `db:generate` emits nothing. Plan correct.

---

## Findings

### [MAJOR-1] Clock barrel line references an export that does not exist
`web.tsx` snippet (plan lines 147 & 157):
```ts
export { ClockGreeting as ClockTile, ClockGreetingView as ClockTileView } from "./web/ClockGreeting";
```
`ClockGreeting.tsx` exports ONLY `ClockGreeting` (verified: it *imports* `ClockGreetingView`
from `./ClockGreetingView` but never re-exports it). `ClockGreetingView` lives in its own
file. As written the barrel fails to resolve `ClockGreetingView` → red build. This is the
identical split the plan already caught for `EventsTile`/`EventsTileView` but missed for
the clock pair.
**Fix:** split it, mirroring the Events fix:
```ts
export { ClockGreeting as ClockTile } from "./web/ClockGreeting";
export { ClockGreetingView as ClockTileView } from "./web/ClockGreetingView";
```

### [MAJOR-2] Inlined `EventSelectSchema` must be EXPORTED from api.ts (moved test imports it)
The plan inlines the zod schemas as non-exported `const` in `features/events/api.ts`
(snippet lines 182-183) and deletes `apps/api/src/db/zod-schemas.ts`. But the moved test
(`apps/api/src/__tests__/events.test.ts:5,78-87`) does
`import { EventSelectSchema } from "../db/zod-schemas"` and calls
`EventSelectSchema.parse(row)` in a dedicated `describe("EventSelectSchema")` block. After
the move it must import that symbol from the feature. If it stays a private `const` the
repointed `features/events/api.test.ts` has nothing to import → red.
**Fix:** `export const EventSelectSchema = …` (and, harmlessly, `EventInputSchema`) from
`features/events/api.ts`; repoint the moved test to `import { EventSelectSchema } from "./api"`.
Knip is satisfied (the test consumes it). The `EventInputSchema` is not used by the test,
so exporting it is optional.

### [MINOR-1] PLACEHOLDER-SEED — resolve to the low-risk repoint
Endorse the plan's default: KEEP `apps/api/src/db/seed.ts` in place and repoint only its
table import `./schema` → `@features/events/schema`. Confirmed safe: `apps/api → @features`
is not biome-banned; the existing knip entry (`knip.jsonc:104` lists `src/db/seed.ts`)
stays valid with zero knip-config churn; `db.insert(events)`/`db.delete(events)` type-check
against the feature's pgTable regardless of the apps/api `db` schema generic (drizzle's
insert/delete take the table directly). Do NOT move the seed into the feature (would need a
new knip entry for a workspace-less folder). Mark this PLACEHOLDER closed → repoint.

### [MINOR-2] Test description "router+service" is inaccurate
Plan §Tests calls `events.test.ts` a "router+service" test. It never imports `eventsRouter`
or builds a caller — it exercises the pure `service` functions plus `EventSelectSchema`.
No behavioural impact; just don't chase a router import that isn't there when repointing.
The three import repoints are: `../db/schema`→`./schema`, `../services/events-service`→
`./service`, `../db/zod-schemas`→`./api` (per MAJOR-2). It mocks the db (`vi`), so no
feature `./db` construction is needed — simpler than the weather test wiring the plan cites.

---

## Sign-off conditions
Apply MAJOR-1 and MAJOR-2 before implementing; take the MINOR-1 repoint path. Everything
else in the plan (deletions list, one atomic commit, verify chain, gotchas) is accurate
against real code.
