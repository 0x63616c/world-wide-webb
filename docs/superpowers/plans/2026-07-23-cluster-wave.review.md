# Track C — Cluster-fold Wave: Wave-boundary Review

Reviewer: wave-boundary code reviewer. HEAD at review: `abf934233`. main = prod.
Scope: fold calendar/ac/ctrl/felogs/wakes into `features/`, verify ground truth
after heavy fix-forward churn + shared-tree races.

## PART A — Verify (git + gh + gates)

| Unit | Landing sha(s) | On origin/main | CI | Landed correct |
|------|----------------|----------------|-----|----------------|
| calendar → features/events (multi-tile) | `2bf359ea4` | yes | green (30044153492) | yes |
| ac / climate | `ffbdb485a` → fix `65c6985be` | yes | initial RED (30044952928), fix GREEN (30045287989) | yes |
| ctrl / controls | `7f073994c` → fix `b1b21f2a9` | yes | initial RED (30046411071), fix GREEN (30046964945) | yes |
| felogs | `77df849a4` → fixes `a736f05be`, `672365c81` | yes | initial RED (30047658542), fix GREEN (30048019857) | yes |
| wakes (+ interaction-session-service) | `abf934233` (HEAD) | yes | green (30049115622, incl deploy) | yes |

Gates at HEAD (`abf934233`), all local:
- `bun run apps:gen` → zero drift (only untracked docs files).
- `bun run apps:check` → clean, `_generated/*` matches fresh render.
- `bun run typecheck` → exit 0 (all workspaces + config).
- `bun run knip` → exit 0 (only 2 config hints, no dead code/deps).
- `bun run lint` → exit 0 (5 warnings are esphome build-artifact file sizes + 1
  template-string info; zero errors → boundary `noRestrictedImports` rule passes).

Note: ac/ctrl/felogs each landed a RED initial commit on main (transient prod
deploy red) before the fix-forward. Final state per unit is green; HEAD green.

## PART B — Deep review

### 1. Boundary rule (features → apps/api) — CLEAN
`grep` across features/{events,ac,ctrl,felogs,wakes} for `apps/api` returns
matches in **comments only** — zero real imports. `deps.ts` (ac + ctrl) is sound:
imports `createHomeAssistantClient`/`createPgDeviceStateStore`/`createPool`/
`deviceState` from `@www/core` and binds to the feature's own `config` slice.
No apps/api smuggling. The env-bound `ha` singleton is built from `@www/core`
factories, matching the documented end-state (each caller builds its own instance).
Feature→tRPC-runtime reaches only through `@app-kit/server` (sanctioned seam),
never a direct apps/api import.

### 2. Multi-tile calendar — CLEAN
`features/events/manifest.ts` holds `tiles: [tile_event, tile_clock]` in one
`defineApp`. `tile_clock` carries `home: true`; grep confirms it is the **sole**
`home: true` across all `features/*/manifest.ts` (single-home invariant enforced
by validate.ts, apps:check clean). Coords verbatim (event 30,30 4×2; clock
26,27 5×3). App id `tile_events` distinct from tile ids. Both `EventsTile.tsx`
and `wiring/clock.tsx` (CountdownVariant) consume `trpc.events.list` via the
generated merged `featureAppRouter` (router.gen.ts merges `eventsApi`) — not
apps/api. Intra-app overlap passes (bento test green).

### 3. Enforcers hand-wired — CLEAN
`climate-enforcer-service.ts`, `light-enforcer-service.ts`,
`sonos-volume-enforcer-service.ts` remain in `apps/api/src/services/` (not moved,
not converted to a feature `jobs.ts`). Zero `enforcer` refs in any
`features/*/jobs.ts`. ac/ctrl own only api/service/schema/config/deps + web.

### 4. wakes session service — CLEAN
`interaction-session-service` landed as `features/wakes/service.ts`. It reads
felogs' `frontendLog` table via `import { frontendLog } from "@features/felogs/schema"`
(cross-feature `@features` path — the felogs-sanctioned exported table per
felogs/manifest.ts), never reaching into apps/api. The S3 interim wake-upload
route moved to `features/wakes/http.ts` (`defineHttp`, collected by collect.ts
Source A); the `INTERIM_HTTP_MODULES` list now holds **only booth** — the wake
entry is deleted.

### 5. knip / no shims — CLEAN
knip exit 0. All moved originals deleted (git rename `=>` semantics confirmed):
no `ClimateTile`/`ControlsTile`/`EventsTile`/`FrontendLogsTile`/`WakesTile`/
`ClockGreeting` left in apps/web/src; routers climate/controls/events/logs/
sessions/wake-photos all deleted from apps/api. No shim re-export files.

### 6. Fix-forward churn integrity — CLEAN
- `scripts/apps-gen/collect.test.ts` — 5 tests green (hand-placed-tile example
  updated on `b1b21f2a9`).
- registry-guards story glob (`672365c81`) covers BOTH shapes:
  `features/*/web/**/*.stories.tsx` (weather/multi-tile) and
  `features/*/*.stories.tsx` (felogs feature-root). registry-guards 7 tests +
  tile-title-sync 19 tests green.
- felogs story renamed (`a736f05be`) to `FrontendLogsTileView.stories.tsx` at
  feature root — matches the view component name the guard expects.
- No half-reverted files / stale mock paths observed; ac import-repoint fix
  (`65c6985be`, lefthook restage clobber) leaves a coherent tree (typecheck green).

### 7. placeholder-tiles / bento — CLEAN
`placeholder-tiles.test.ts` + Tile/Placeholder stories = 10 tests green. Folded
tiles (incl. calendar's 2) tile gap-free.

### 8. Slop — CLEAN
No duplicated logic, no weakened/skipped tests, no stray `any` casts beyond one
documented seam. `NodePgDatabase<any>` at `features/wakes/photos.ts:168`
(`backfillWakePhotoIndex`) is an **acceptable transitional seam, not a real type
hole**: apps/api's server.ts calls it at boot with apps/api's own db handle whose
schema no longer includes `wakePhoto`; the `any` erases only the unused
`db.query.*` relational generic while the `wakePhoto` table object stays fully
typed in the query builder. Biome-ignored with rationale. This is the allowed
apps/api → @features direction.

## Verdict: CLEAN

- BLOCKER: 0
- MAJOR: 0
- MINOR: 2

### MINOR findings
1. **ac/ctrl/felogs each landed a RED initial commit on main** before fix-forward
   (`ffbdb485a`, `7f073994c`, `77df849a4`). main = prod, so each briefly shipped
   a red deploy. Final state green; process note only, no code fix needed.
2. **wakes/service.ts:16** couples to felogs via direct `@features/felogs/schema`
   drizzle query (shared-table read) rather than the generated tRPC router. This
   is the tightest cross-feature coupling introduced and is felogs-sanctioned
   (exported table, documented in felogs/manifest.ts), but it is a DB-level
   coupling on another feature's schema — worth tracking if felogs later wants to
   own that read behind a procedure.

Most important finding: none blocking — the wave is coherent and green end-to-end.
