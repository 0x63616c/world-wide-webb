# Unit F-calendar — Fold the calendar cluster into one two-tile App

Track C, Phase 3. **Second multi-tile fold** — mirrors the just-landed weather fold
(commit `4be52f800`) exactly, and is the **first fold that moves the board HOME
tile** (the Clock). Fold the two calendar tiles (`tile_clock` + `tile_event`) into
ONE `features/events/` App that owns the `events` router, the `events` table, the
events reads/writes service, and holds BOTH tiles in a single manifest's
`tiles: [...]` array.

Reference folds to mirror: **`features/weather/` (the proven multi-tile template —
read its plan `docs/superpowers/plans/units/2026-07-23-fold-weather.md`)**;
`features/guest-wifi/` + `features/tesla/` + `features/network/` for single-tile /
router shape. Pattern doc: `docs/writing-scalable-typescript/README.md`.

**Execute as ONE atomic commit.** Codegen only collects a facet once `manifest.ts`
exists, and the base router/schema/registry deletions must be simultaneous or
`apps:check` throws (dup-router-key / dup-table / dup-tile-id). Do NOT split into
"add feature" then "delete base" — the intermediate state is red.

---

## What is ALREADY DONE on main (do NOT re-do)

- **`collect.ts` multi-tile dedup is FIXED** (weather landed it): dedup keys on the
  union of feature TILE ids (`featureTileIds`), not app ids. No `collect.ts` edit
  needed for calendar.
- **Guard-test globs already scan `features/*/web/**`**: `tile-title-sync.test.tsx`
  globs `features/*/web/*.tsx` (line ~64) and carries `NO_STATIC_TITLE = ["tile_clock"]`
  (line 29); `registry-guards` and the storybook `main.ts` `stories` glob already
  include `features/**`. No re-fix of those globs.
- **F0 `TileSpec.home?: boolean` is wired end-to-end** (`app-kit/define-app.ts:22`,
  test `define-app.test.ts:37-44`) and `manifestToEntries` propagates it
  (`apps/web/src/lib/tile-registry.ts:221` — `...(tile.home ? { home: true } : {})`).
  Setting `home: true` on the clock `TileSpec` flows into `TILE_REGISTRY`;
  `HOME_TILE` (`tile-registry.ts:233` — `TILE_REGISTRY.find((t) => t.home) ?? [0]`)
  resolves it. Weather never exercised this (no home tile); calendar is the first.

---

## Facts established during planning (verified at HEAD `63cd93e1f`)

- **The two tiles (VERBATIM from `apps/web/src/lib/tile-registry.ts`):**
  - `tile_clock` — label `"Clock"`, `ClockGreeting` / `ClockGreetingView`,
    `worldCol 26, worldRow 27, cols 5, rows 3`, **`home: true`**
    (registry lines 67-76). This is the board home (`HOME_TILE`).
  - `tile_event` — label `"Upcoming"`, `EventsTile` / `EventsTileView`,
    `worldCol 30, worldRow 30, cols 4, rows 2` (registry lines 98-106).
  - Rects: clock cols 26-30 / rows 27-29; event cols 30-33 / rows 30-31. They do
    NOT overlap (row ranges disjoint: 27-29 vs 30-31). Intra-app overlap check
    passes; board layout byte-identical after the fold.
  - **`guestExposed`: NEITHER.** `GUEST_EXPOSED` (`features/guest-exposed.ts`) is
    `["tile_guestwifi"]` only. Do NOT set `guestExposed`; do NOT touch the allowlist.
- **App id `tile_events`** — distinct from both tile ids and from the folder, matches
  the `events` router-key. Verified unused anywhere in `apps/`, `features/`,
  `scripts/`.
- **`tile-title-sync`:** `EventsTileView` renders `title="Upcoming"`
  (`EventsTileView.tsx:116`) so the `tile_event` manifest label MUST be `"Upcoming"`.
  `tile_clock` is in `NO_STATIC_TITLE` (clock renders a live time, no static title),
  so its label stays `"Clock"` and the guard skips it. The guard keys the view file
  by `entry.viewComponent.name`, so the moved view files MUST keep their function
  names + filenames (`EventsTileView.tsx`, `ClockGreetingView.tsx`) at the top
  `features/events/web/` level (where the `features/*/web/*.tsx` glob looks).
- **NO worker interval, NO cron, NO purge, NO enforcer for events.** Calendar events
  are user-managed rows (create/update/delete via the Manage variant); nothing in
  `apps/worker/src`, `infra/src/crons.ts`, `apps/api/src/purge.ts`, or
  `apps/api/src/cron-run.ts` references the events table. **So `features/events/`
  has NO `jobs.ts` facet** — simpler than weather on the backend.
- **The "peek" (clock → events list) is same-App after the fold.** The clock detail
  wiring's `CountdownVariant` calls `trpc.events.list.useQuery(undefined)`
  (`detail/wiring/clock.tsx:47`). After the fold `events.list` is served by
  `features/events/api.ts`, mounted into `featureAppRouter` and merged into the root
  `trpc` client. The clock component reaches it through the shared `@/lib/trpc`
  client and the **generated** merged router — it never imports `apps/api` and never
  imports the events service directly. **No repoint of the peek is needed** — it
  already goes through `trpc.events.list`, which resolves to the feature's procedure
  once folded. (This is the "read-only dep via the generated router" the unit calls
  for; it is satisfied structurally, not by an import edit.)
- **`lib/time-suite/` is SHARED substrate — it STAYS in `apps/web`.** It is consumed
  OUTSIDE the clock closure by `apps/web/src/components/TimeSuiteBanner.tsx`,
  `apps/web/src/components/Board.tsx`, and `apps/web/src/lib/store.ts`. The moved
  clock variant components keep importing it via `@/lib/time-suite/*` (unchanged).
- **Feature DB pattern:** own `config.ts` (validates `process.env`, each `.default()`ed
  so codegen import never throws) + `db.ts`
  (`drizzle(createPool(config.DATABASE_URL), { schema })` from `@www/core`). Copy
  `features/weight/{config,db}.ts` verbatim shape. Events needs only `DATABASE_URL`.
- **`apps/web → @features/*` and `apps/worker → @features/*` are ALLOWED**; only
  `features/* → apps/api/*` is Biome-banned (`biome.json:164-180`). **`apps/api →
  @features` is NOT banned** (relevant to `seed.ts`, below).

---

## Target layout: `features/events/`

```
features/events/
  manifest.ts   # defineApp, id "tile_events", tiles:[event, clock] (VERBATIM coords; clock home:true)
  api.ts        # defineApi(router({ events: eventsRouter })) — from apps/api routers/events.ts;
                #   inlines EventSelectSchema + EventInputSchema (from apps/api db/zod-schemas.ts)
  service.ts    # events reads+writes (daysUntil/listEvents/createEvent/updateEvent/deleteEvent,
                #   EventRow/EventInput/ListEventsOptions) — was apps/api/src/services/events-service.ts
  schema.ts     # events pgTable (from apps/api/src/db/schema.ts:23-29)
  config.ts     # z.object({ DATABASE_URL }).parse(process.env)  (DATABASE_URL default like weight/config.ts)
  db.ts         # drizzle(createPool(config.DATABASE_URL), { schema })
  web.tsx       # barrel: re-export the two tile component pairs from web/
  web/          # the 47-file calendar component subtree (see §Web move — FULL move)
  api.test.ts   # was apps/api/src/__tests__/events.test.ts (router+service), repointed
```

**No `jobs.ts`, no `ingest.ts`, no `weather-codes.ts` analogue.** Events is a pure
CRUD feature.

### `manifest.ts` (VERBATIM coords; clock carries the sole global home)

```ts
import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView, EventsTile, EventsTileView } from "./web";

export default defineApp({
  id: "tile_events",
  tiles: [
    { id: "tile_event", label: "Upcoming", component: EventsTile, viewComponent: EventsTileView, worldCol: 30, worldRow: 30, cols: 4, rows: 2 },
    { id: "tile_clock", label: "Clock",    component: ClockTile,  viewComponent: ClockTileView,  worldCol: 26, worldRow: 27, cols: 5, rows: 3, home: true },
  ],
});
```

- **`home: true` goes on the `tile_clock` TileSpec and NOWHERE else.** It is the sole
  global home across all apps (`validate.ts:174-176` throws on `!== 1`). Verify no
  other manifest/registry entry sets `home` (none do today).
- **Coords VERBATIM** from the deleted registry entries (do not renumber).
- Labels VERBATIM: `"Upcoming"` (matches `EventsTileView` `title="Upcoming"`),
  `"Clock"` (clock is title-sync-exempt via `NO_STATIC_TITLE`).
- **Keep the barrel alias names' `.name` stable via the underlying function names.**
  `viewComponent.name` must be `EventsTileView` / `ClockGreetingView` for the
  title-sync glob — a React function's `.name` is its declared function name
  regardless of an `export`-alias, so aliasing in the barrel is fine, but the FILES
  must be `web/EventsTileView.tsx` and `web/ClockGreetingView.tsx`. Prefer NOT
  renaming: re-export `ClockGreeting` (from `web/ClockGreeting.tsx`) as `ClockTile`
  and `ClockGreetingView` (from its OWN file `web/ClockGreetingView.tsx`) as
  `ClockTileView`, each from its own file in the barrel; `viewComponent.name` stays
  `ClockGreetingView`. See the split-file barrel in §web.tsx.

### `web.tsx` — barrel

Both tile pairs are SPLIT across files. `EventsTile.tsx` exports only `EventsTile`
(it imports `EventsTileView` from `./EventsTileView`); `ClockGreeting.tsx` exports
ONLY `ClockGreeting` (it imports `ClockGreetingView` from `./ClockGreetingView`,
never re-exports it — VERIFIED at HEAD). Re-export each of the FOUR symbols from its
OWN file — do NOT pull a `*View` symbol from a `*.tsx` face file that does not export
it (that is a red build):

```ts
// features/events/web.tsx
export { EventsTile } from "./web/EventsTile";
export { EventsTileView } from "./web/EventsTileView";
export { ClockGreeting as ClockTile } from "./web/ClockGreeting";
export { ClockGreetingView as ClockTileView } from "./web/ClockGreetingView";
```

Both `EventsTileView` and `ClockGreetingView` keep their function names (for the
title-sync `viewComponent.name` lookup) and their filenames.

### `api.ts`

Move `apps/api/src/trpc/routers/events.ts` verbatim; swap the tRPC runtime import to
`@app-kit/server`, the service import to `./service`, and **inline** the two zod
schemas that currently live in `apps/api/src/db/zod-schemas.ts` (that file is
events-only — see §zod-schemas). Feed the service the feature's own `./db` (mirrors
guest-wifi's `createDrizzlePortalRepo(db)` and weather's `./db`), NOT `ctx.db` — the
self-contained-feature pattern:

```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import { db } from "./db";
import { events } from "./schema";
import { createEvent, deleteEvent, listEvents, updateEvent } from "./service";

// EventSelectSchema / EventInputSchema — moved VERBATIM from apps/api/src/db/zod-schemas.ts.
// MUST be EXPORTED: the moved test (features/events/api.test.ts) imports EventSelectSchema
// from "./api" and calls EventSelectSchema.parse(row). Export both (EventInputSchema export
// is harmless; only EventSelectSchema is consumed by the test).
export const EventSelectSchema = createSelectSchema(events, { /* date→z.string(), days extension — verbatim */ });
export const EventInputSchema = z.object({ /* verbatim */ });

const eventsRouter = router({
  list:   publicProcedure.input(...).output(z.array(EventSelectSchema)).query(({ input }) => listEvents(db, { includePast: input?.includePast })),
  create: publicProcedure.input(EventInputSchema).output(EventSelectSchema).mutation(({ input }) => createEvent(db, input)),
  update: publicProcedure.input(z.object({ id: z.number().int().positive() }).and(EventInputSchema)).output(EventSelectSchema).mutation(({ input }) => { const { id, ...f } = input; return updateEvent(db, id, f); }),
  delete: publicProcedure.input(z.object({ id: z.number().int().positive() })).output(z.object({ id: z.number().int().positive() })).mutation(({ input }) => deleteEvent(db, input.id)),
});

export const api = defineApi(router({ events: eventsRouter }));
```

- The current router bodies read `ctx.db`; switch each to the feature `db` from
  `./db`. Behaviour is identical (same drizzle pool over `DATABASE_URL`).
- Codegen collects key `events` off `api._def.record` (collect.ts) → merges into
  `featureAppRouter`. `validate.ts` rejects a dup `events` router key → the base
  mount MUST be deleted in the same commit (§Deletions #2).

### `service.ts`

Move `apps/api/src/services/events-service.ts` verbatim into
`features/events/service.ts`. Only import repoint:
`import * as schema from "../db/schema"` → `import * as schema from "./schema"`.
All exported functions keep signatures (`(db, ...)` — the db is passed in by `api.ts`
and by the moved test). `daysUntil` (pure), `EventRow`, `EventInput`,
`ListEventsOptions` come along.

### `schema.ts`

Move the `events` `pgTable` (`apps/api/src/db/schema.ts:23-29`) verbatim into
`features/events/schema.ts` — same SQL table name `events`, same columns
(`id serial PK`, `name`, `place`, `date timestamptz`, `createdAt timestamptz default now()`).
Delete it from `apps/api/src/db/schema.ts`. Codegen collects the feature's `pgTable`
into `schema.gen.ts`; `validate.ts` rejects a dup table name → the base copy MUST be
deleted in the same commit.

- Standalone append-only table, no FKs. Confirm nothing else in
  `apps/api/src/db/` relates to `events` before deleting.
- `drizzle db:generate` NOT needed (no DDL change; identical SQL, moved packages).
  If the drizzle snapshot picks up the relocation, `bunx biome format --write` the
  meta dir before lint (memory `drizzle-generate-needs-biome-format`). Verify no
  unintended migration is emitted.

### `config.ts` / `db.ts`

Copy `features/weight/config.ts` + `features/weight/db.ts` shape. `config.ts` only
needs `DATABASE_URL` (with the same `.default()` the other features use so codegen's
manifest/collect import never throws). `db.ts` is
`drizzle(createPool(config.DATABASE_URL), { schema })` importing `* as schema from
"./schema"` + `createPool` from `@www/core`.

---

## Web move — FULL move of the 47-file calendar subtree

**Decision: move the entire calendar closure into `features/events/web/`.** Mirrors
weather's full-closure decision and reaches the locked code-ownership end-state in
one pass. The closure is self-contained: verified that the ONLY external importers
of any closure file are `apps/web/src/lib/tile-registry.ts` and
`apps/web/src/components/tiles/detail/registry.ts` (both repoint to the feature —
see §External consumers). No non-calendar tile imports any of these files.

**The exact 47 files (enumerated — verified with grep at HEAD):**

Group A — Events tile face + view (`apps/web/src/components/tiles/`, 3):
`EventsTile.tsx`, `EventsTileView.tsx`, `EventsTileView.stories.tsx`.

Group B — Events tile tests (`apps/web/src/components/tiles/__tests__/`, 3):
`EventsTile.test.tsx`, `EventsTileView.test.tsx`, `EventsTileView.stories.test.tsx`.

Group C — Events modal views (`apps/web/src/components/tiles/views/`, 10 = 5 comps + 5 stories):
`EventsModalCountdownSpotlight{,.stories}.tsx`, `EventsModalFullAgenda{,.stories}.tsx`,
`EventsModalManage{,.stories}.tsx`, `EventsModalMonthGrid{,.stories}.tsx`,
`EventsModalTimelineGaps{,.stories}.tsx`.

Group D — Events detail wiring (`apps/web/src/components/tiles/views/wiring/`, 1):
`events.tsx` (exports `eventsDetailEntry`).

Group E — Clock tile face + views + rings (`apps/web/src/components/tiles/`, 5):
`ClockGreeting.tsx`, `ClockGreetingView.tsx`, `ClockGreetingView.stories.tsx`,
`ClockSecondsRing.tsx`, `ClockSecondsRing.stories.tsx`.

Group F — Clock tile tests (`apps/web/src/components/tiles/__tests__/`, 4):
`ClockGreeting.test.tsx`, `ClockGreetingView.test.tsx`,
`ClockGreetingView.stories.test.tsx`, `ClockSecondsRing.stories.test.tsx`.

Group G — Clock modal views (`apps/web/src/components/tiles/views/`, 4 = 2 comps + 2 stories):
`ClockModalCountdownHorizon{,.stories}.tsx`, `ClockModalWorldClocks{,.stories}.tsx`.

Group H — Clock detail wiring (`apps/web/src/components/tiles/detail/wiring/`, 1):
`clock.tsx` (exports `clockDetailEntry`; imports the `../clock/*Variant` files below).

Group I — Clock interactive variant suite (`apps/web/src/components/tiles/detail/clock/`, 9):
`AlarmVariant.tsx`, `StopwatchVariant.tsx`, `TimerVariant.tsx`,
`ClockAlarmView{,.stories}.tsx`, `ClockStopwatchView{,.stories}.tsx`,
`ClockTimerView{,.stories}.tsx`.

Group J — Clock variant tests (`apps/web/src/components/tiles/detail/clock/__tests__/`, 6):
`ClockAlarmView{,.stories}.test.tsx`, `ClockStopwatchView{,.stories}.test.tsx`,
`ClockTimerView{,.stories}.test.tsx`.

Group K — Clock-only config (`apps/web/src/config/`, 1):
`world-clocks.ts` (exports `WORLD_CLOCK_ZONES`; only importer is the clock wiring —
verified no other consumer).

**= 47 files.** All move under `features/events/web/`.

Suggested internal structure under `features/events/web/`: tile faces + views at
`web/` top level (so the title-sync `features/*/web/*.tsx` glob finds
`EventsTileView.tsx` / `ClockGreetingView.tsx`); modal views at `web/views/`;
detail wiring at `web/wiring/{events,clock}.tsx`; the interactive variant suite at
`web/clock/`; `world-clocks.ts` at `web/config/world-clocks.ts` (or `web/world-clocks.ts`);
tests beside their subjects.

### Import-repoint rules (these files use `@/` absolute imports internally)

- **Any `@/` import pointing at a MOVED file** → repoint to a feature-local relative
  path matching the new structure. Concretely, repoint imports of:
  `@/components/tiles/EventsTile*`, `@/components/tiles/EventsTileView`,
  `@/components/tiles/views/EventsModal*`,
  `@/components/tiles/ClockGreeting*`, `@/components/tiles/ClockSecondsRing`,
  `@/components/tiles/views/ClockModal*`,
  `@/components/tiles/detail/clock/*` (the `../clock/*Variant` refs in `clock.tsx`),
  `@/components/tiles/views/wiring/events`, `@/config/world-clocks`.
- **Any `@/` import pointing at a file that STAYS** → keep `@/` unchanged. These
  include: `@/components/ui`, `@/components/Icon`, `@/lib/hooks`, `@/lib/trpc`,
  `@/lib/useTileQuery`, `@/config/home`, `@/components/tiles/detail/types`
  (shared detail-page infra), and **all of `@/lib/time-suite/*`** (shared substrate —
  Timer/Stopwatch/Alarm stores consumed by `Board`/`TimeSuiteBanner`/`store.ts`).
  The moved variant files (`web/clock/*`) keep importing `@/lib/time-suite/*` and
  `@/components/tiles/detail/types` unchanged.

### External consumers that STAY in `apps/web` and repoint TO the feature

1. **`apps/web/src/lib/tile-registry.ts`** — delete the `tile_clock` + `tile_event`
   `REGISTRY_ENTRIES` and the now-unused direct component imports (`ClockGreeting`,
   `ClockGreetingView`, `EventsTile`, `EventsTileView` — registry lines 22-23,26-27);
   add `import eventsAppManifest from "@features/events/manifest"` and push it into
   `FEATURE_MANIFESTS`. `HOME_TILE` keeps working because the clock's `home: true`
   now arrives via the manifest → `manifestToEntries` → `TILE_REGISTRY`.
2. **`apps/web/src/components/tiles/detail/registry.ts`** — repoint the two wiring
   imports: `../views/wiring/events` → `@features/events/web/wiring/events`, and
   `./wiring/clock` → `@features/events/web/wiring/clock`. The `eventsDetailEntry` /
   `clockDetailEntry` in the `ENTRIES` array are unchanged. Keeps the detail-registry
   completeness test (`registry-entries.test.ts`) + `clock-entry.test.ts` green.
3. **Storybook `apps/web/.storybook/main.ts`** — its `stories` glob already includes
   `features/**` (weather added it). No edit. (Confirm the moved `*.stories.tsx`
   are discovered; they should be under the existing `features/**` entry.)

**STAYS PUT (do NOT move):** `apps/web/src/components/tiles/detail/__tests__/clock-entry.test.ts`
— it imports `../registry` (an `apps/web` file) and exercises `getTileDetailEntry("tile_clock")`
through the registry, which now resolves the clock wiring from the feature. It tests
`apps/web` registry glue, so it stays in `apps/web`; it will pass once
`detail/registry.ts` repoints (item 2). Confirm it stays green.

No other `apps/web` file imports any moved file (verified: the only external
importers are tile-registry.ts + detail/registry.ts).

---

## zod-schemas — events-only, moves into `api.ts`

`apps/api/src/db/zod-schemas.ts` (35 lines) is **events-only**: it defines
`EventSelectSchema` + `EventInputSchema`, both derived from the `events` table via
`createSelectSchema(events, …)`. Its only importers are the events router +
`events.test.ts` + itself (verified). After the table moves, these schemas must live
with the feature. **Inline both into `features/events/api.ts`** (from `./schema`
`events`, `createSelectSchema` from `drizzle-zod`), and **delete
`apps/api/src/db/zod-schemas.ts`**. knip zero-tolerance would flag the orphan file
otherwise.

---

## seed — KEEP in place, repoint only its `events` table import (DECIDED)

`apps/api/src/db/seed.ts` (46 lines) is an events-only manual DB seed (concert data),
a knip entry (`knip.jsonc:104` lists apps/api `src/db/seed.ts`). It imports `db, pool`
from `./index` (apps/api's db) and `events` from `./schema`.

**DECISION (reviewer-endorsed, low-risk — PLACEHOLDER-SEED CLOSED): keep `seed.ts`
where it is and repoint ONLY its table import** —
`import { events } from "./schema"` → `import { events } from "@features/events/schema"`.
Rationale (all verified): `apps/api → @features` is NOT Biome-banned (only
`features → apps/api` is); the existing knip entry stays valid with zero knip-config
churn; `db.insert(events)` / `db.delete(events)` type-check against the feature's
`pgTable` regardless of the apps/api `db` schema generic (drizzle's insert/delete take
the table directly). Do NOT move the seed into the feature — a workspace-less
`features/events/seed.ts` would need a new knip entry for no benefit.

The seed's concert data is pre-existing — this fold relocates the import, it does not
add or delete seed data (the "no fake data" invariant is about runtime, not this
dev-only seed script; out of scope to change).

---

## Deletions (all in the ONE atomic commit)

1. `apps/web/src/lib/tile-registry.ts` — delete the `tile_clock` + `tile_event`
   `REGISTRY_ENTRIES` + the 4 now-unused direct component imports; add
   `eventsAppManifest` → `FEATURE_MANIFESTS`.
2. `apps/api/src/trpc/routers/index.ts` — delete `import { eventsRouter } from "./events"`
   (line 7) and the `events: eventsRouter` mount (line 25). Feature supplies `events`
   via `featureAppRouter`.
3. `apps/api/src/trpc/routers/events.ts` — delete (→ feature `api.ts`).
4. `apps/api/src/services/events-service.ts` — delete (→ feature `service.ts`).
5. `apps/api/src/db/schema.ts` — delete the `events` `pgTable` (lines 23-29).
6. `apps/api/src/db/zod-schemas.ts` — delete (schemas inlined into feature `api.ts`).
7. `apps/api/src/__tests__/events.test.ts` — delete after relocating + repointing
   into `features/events/api.test.ts`.
8. The 47 web files (Groups A-K) — delete originals under `apps/web/src/`.
9. `apps/api/src/db/seed.ts` — do NOT delete/move the file; repoint ONLY its `events`
   import to `@features/events/schema` (§seed, DECIDED).

**knip is zero-tolerance, whole tree** — every moved file's original MUST be deleted
(no re-export shims). After moving, `bun run knip`; chase any newly orphaned export
to zero.

---

## Tests to move / add

- `apps/api/src/__tests__/events.test.ts` → `features/events/api.test.ts`. This is a
  **service + schema** test, NOT a router test — it never imports `eventsRouter` or
  builds a tRPC caller; it exercises the pure `service` functions plus a
  `describe("EventSelectSchema")` block that calls `EventSelectSchema.parse(row)`. It
  **mocks the db with `vi`** (verified: imports `type NodePgDatabase`, `vi`), so it
  needs NO feature `./db` construction — simpler than the weather test wiring. The
  THREE import repoints:
  - `import type * as schema from "../db/schema"` → `"./schema"`
  - `../services/events-service` → `./service`
  - `import { EventSelectSchema } from "../db/zod-schemas"` → `"./api"`
    (per MAJOR-2, `api.ts` now exports it).
  There is NO separate `events-service.test.ts` today.
- The 47 web files include their own `*.test.tsx` + `*.stories.test.tsx` (Groups B,
  F, J) — they move alongside their subjects with repointed relative imports.
- **NEW collect test** in `scripts/apps-gen/collect.test.ts` (mirror the weather
  multi-tile test): assert `tile_events` sources both `tile_clock` + `tile_event`
  once each with `source: "feature"`, and neither tile id leaks back in as a registry
  app; assert `validate(model, ["tile_guestwifi"])` does not throw.
- The `apps/web` **placeholder-tiles / bento** test MUST pass with the two calendar
  tiles now sourced from the manifest — the registry-entry deletion + manifest
  addition net to the SAME two rects at the SAME coords → board layout byte-identical.
  Both tiles are ≥2×2 (5×3 and 4×2), so the 1×1 clearance risk
  (memory `bento-tiler-1x1-clearance`) does not apply, but run it explicitly.
- `registry-entries.test.ts` (detail completeness) + `clock-entry.test.ts` MUST stay
  green via the repointed `detail/registry.ts` imports.
- `tile-title-sync.test.tsx` MUST stay green: `tile_event`/`"Upcoming"` matches
  `EventsTileView`'s `title="Upcoming"`; `tile_clock` remains in `NO_STATIC_TITLE`.

---

## Verify chain (implementer runs ALL, in order, with real output)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck                      # all programs
bunx vitest run \
  scripts/apps-gen \                   # collect/validate incl. the NEW multi-tile collect test
  features/events \                    # moved api/service/web tests + stories tests
  apps/web/src/lib/__tests__/placeholder-tiles \
  apps/web/src/components/tiles/__tests__/tile-title-sync \
  apps/web/src/components/tiles/detail   # registry-entries + clock-entry completeness
  # (glob the actual placeholder-tiles / bento / tile-title-sync / registry paths)
bun run apps:check                     # codegen drift + validator (dup id/router-key/table, =1 home, no overlap incl intra-app, guestExposed<->allowlist)
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome dep-boundary: NO features/events/* -> apps/api
git pull --rebase --autostash          # SHARED tree; peer dirt present
git add <explicit paths>               # NEVER git add -A
git commit -m "..."                    # message below (NO backticks)
git show --stat HEAD                    # confirm ONLY your full fileset staged, with insertions (not empty/partial)
git push                                # or: git push --no-verify if the pre-push lint:tracked hook blocks on UNRELATED peer dirt AND your own diff is independently clean
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor
# then confirm deploy green + pod image age (memory ci-cancelled-runs-strand-image-digests)
```

Confirm after `apps:check`:
- `features/_generated/tiles.gen.ts` has `tile_event` + `tile_clock`, BOTH
  `appId: "tile_events"`, `source: "feature"`, each **exactly once**, same coords,
  and `tile_clock` carries `home: true` (the sole home in the emitted set).
- `features/_generated/router.gen.ts` mounts `events`.
- `features/_generated/schema.gen.ts` includes the `events` table.
- No `crons.gen.ts` change (events has no cron).
- Biome dep-boundary: no surviving `features/events/* → apps/api/*` import.

`git show --stat HEAD` gotcha (memory `agent-thread-cwd-reset-leaks-to-main` /
`never-git-add-all-shared-checkout`): `git add` can silently abort on an already-`git
rm`'d pathspec — verify the stat shows the FULL fileset with insertions, not an
empty/partial commit. Stage explicit paths only; the shared tree carries peer dirt.

---

## Gotchas (inherit from the weather fold)

- `features/* → apps/api/*` is Biome-banned. Every moved backend file repoints to
  `@www/core`, `@app-kit`/`@app-kit/server`, or feature-local `./`. A single
  surviving `apps/api` import in the feature turns lint red.
- `apps/web → @features/*` and `apps/worker → @features/*` (and `apps/api → @features`
  for the seed) are ALLOWED. Moved web files repoint to `@/` (shared) or `./` (moved).
- `bun build` reads the **CWD** tsconfig paths (memory `bun-build-alias-needs-cwd-tsconfig`).
  This fold removes events FROM apps/api; the api image build must resolve the
  remaining routers cleanly and the web build must resolve `@features/events/*` —
  verify both go green in CI.
- Parallel sessions push `main`: `git pull --rebase --autostash`; **never**
  `git add -A`; lefthook format re-stages the whole tree (memory
  `lefthook-format-restages-whole-tree`) — stage explicit paths, `git show --stat
  HEAD` before push.
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- **ONE commit.** Do NOT split "add feature" from "delete base" — the intermediate
  state is red (`apps:check` throws dup-router-key / dup-table / dup-tile-id).

---

## Commit message (no backticks)

```
feat(features): fold calendar (event+clock) into features/events (Track C)

Second multi-tile fold. The event + clock tiles now live in one features/events
App declaring both via F0's tiles[] manifest, owning the events router, the events
table, the events reads/writes service, and inlining the events zod input/select
schemas. First fold to relocate the board HOME tile: the Clock's home:true moves
onto its manifest TileSpec and stays the sole global home via manifestToEntries.
The clock detail's Countdown "peek" reads events.list through the generated merged
router (never apps/api). Full 47-file calendar web subtree (event + clock faces,
modal views, detail wiring, the Timer/Stopwatch/Alarm variant suite, world-clocks
config) moved under features/events/web/; the shared lib/time-suite stores stay in
apps/web. Base events router/schema/service/zod-schemas, registry entries, and the
router mount removed; seed repointed. No coord or DDL change; board layout
byte-identical.
```

---

## Open PLACEHOLDERs

**NONE.** All decisions closed.

- **SEED (was PLACEHOLDER-SEED, now CLOSED):** keep `apps/api/src/db/seed.ts` in
  place; repoint ONLY its `events` import to `@features/events/schema`. Do not move.
- App id `tile_events` (verified unique).
- Full 47-file web closure move; `lib/time-suite` STAYS shared.
- `home: true` on the `tile_clock` TileSpec is the sole global home.
- zod-schemas inlined into `api.ts` as EXPORTED consts (`EventSelectSchema` consumed
  by the moved test); `zod-schemas.ts` deleted.
- Split-file barrel: each of the 4 tile symbols re-exported from its OWN file
  (`ClockGreetingView` from `web/ClockGreetingView.tsx`, not from `ClockGreeting.tsx`).
- No `jobs.ts` / cron / worker (events is pure CRUD).
- The clock→events peek is satisfied structurally through the generated router; no
  import edit.
