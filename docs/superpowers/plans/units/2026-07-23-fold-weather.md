# Unit F-weather — Fold the weather cluster into one two-tile App

Track C, Wave 7. **First multi-tile fold** — proves F0's `tiles: TileSpec[]`
manifest shape AND the codegen dedup end-to-end. Fold the two weather tiles
(`tile_weath` + `tile_hourly`) into ONE `features/weather/` App that owns the
`weather` router, the `weather_reading` + `weather_daily_reading` tables, the
weather-ingest interval, the weather-purge cron, and holds BOTH tiles in a single
manifest's `tiles: [...]` array.

Reference folds to mirror: `features/network/` (W0), `features/tesla/` (Wave 2,
the manifest shape), `features/weight/` (owns a table + `config.ts` + `db.ts`),
`features/guest-wifi/` (`jobs.ts` `defineCron` on the S2 seam). Pattern doc:
`docs/writing-scalable-typescript/README.md`.

**This plan is post-review (REWORK → resolved). Execute verbatim.** All prior
PLACEHOLDERs are now decided; do not re-open them. ONE atomic commit.

---

## THE CRUX — BLOCKER fix: `collect.ts` dedup keys on APP id, not TILE id

**This is the load-bearing change that makes a multi-tile fold possible. It lands
in the SAME atomic commit** — it is part of proving F0 end-to-end, and it unblocks
every future multi-tile fold (calendar, media).

`scripts/apps-gen/collect.ts:338-340` (verified at HEAD):

```ts
// Registry leftovers: every TILE_REGISTRY entry NOT already owned by a feature.
const featureIds = new Set(featureApps.map((a) => a.id));                 // APP ids
const registryApps: CollectedApp[] = TILE_REGISTRY.filter((t) => !featureIds.has(t.id)).map(
```

`t.id` is a **tile** id; `featureIds` holds **app** ids. This has only ever
worked because every existing feature is single-tile with `app.id === tile.id`
(deploys/dogcam/guest-wifi/network/notif/tesla/weight all do). Weather is the
first App where they differ: app id `tile_weather`, tile ids `tile_weath` /
`tile_hourly`. With `weatherManifest` in `FEATURE_MANIFESTS`, `TILE_REGISTRY`
now contains `tile_weath` + `tile_hourly` (via `manifestToEntries`), but
`featureIds` = `{…, "tile_weather"}`, so `featureIds.has("tile_weath")` = false
→ both tiles survive the filter and are collected a SECOND time as standalone
`registryApps`. `validate.ts:159` flattens all tiles → each weather tile appears
twice → throws `duplicate tile id 'tile_weath'`. `bun run apps:check` fails.

**Fix (edit `scripts/apps-gen/collect.ts:339-340`):**

```ts
// Registry leftovers: every TILE_REGISTRY entry NOT already owned by a feature.
// Dedup by the union of feature TILE ids, not app ids — a multi-tile app's tile
// ids differ from its app id (first case: features/weather).
const featureTileIds = new Set(featureApps.flatMap((a) => a.tiles.map((t) => t.id)));
const registryApps: CollectedApp[] = TILE_REGISTRY.filter((t) => !featureTileIds.has(t.id)).map(
```

Correct for BOTH single-tile (app.id==tile.id → identical behavior) and
multi-tile. `CollectedApp.tiles` is `{ id, label, worldCol, … }[]`, so
`.flatMap((a) => a.tiles.map((t) => t.id))` typechecks unchanged.

**Add a collect-level test** in `scripts/apps-gen/collect.test.ts` (the suite
already runs `collect()` over the REAL registry). After the fold, `weatherManifest`
is live, so add an `it()` asserting the multi-tile fold collects exactly two
tiles once each — no registry duplicate:

```ts
it("collect() sources both weather tiles once from the two-tile feature manifest", async () => {
  const model = await collect();
  const weather = model.apps.filter((a) => a.id === "tile_weather");
  expect(weather).toHaveLength(1);
  expect(weather[0].source).toBe("feature");
  expect(weather[0].tiles.map((t) => t.id).sort()).toEqual(["tile_hourly", "tile_weath"]);
  // The BLOCKER regression guard: neither tile id leaks back in as a registry app.
  expect(model.apps.filter((a) => a.id === "tile_weath")).toHaveLength(0);
  expect(model.apps.filter((a) => a.id === "tile_hourly")).toHaveLength(0);
  expect(() => validate(model, ["tile_guestwifi"])).not.toThrow();
});
```

`collect.ts` is under `scripts/` — no `@features → apps/api` boundary concern,
no knip impact (internal).

---

## Facts established during planning (do not re-derive; verified at HEAD da0be339e)

- **F0 RENDER side is wired.** `tile-registry.ts:228` `manifestToEntries(m)` does
  `m.tiles.map(...)` → one entry per tile, each carrying its own
  `component`/`viewComponent`. `TILE_REGISTRY` (line 250)
  `FEATURE_MANIFESTS.flatMap(manifestToEntries)`. Two `tiles[]` entries → two
  registry entries. **No render-side change.** Same shape as `tesla/manifest.ts`,
  two array entries instead of one. (Confirmed by reviewer.)
- **F0 EMIT side is wired EXCEPT the dedup above.** `collect.ts:228` iterates
  `m.tiles.map(...)`, one `GeneratedTile` per tile (each `appId: m.id`).
  `validate.ts:180-183` already checks intra-app overlap. The ONLY gap was the
  dedup keying — fixed in §CRUX.
- **Feature DB pattern:** own `config.ts` (validates `process.env`, each
  `.default()`ed so codegen import never throws) + `db.ts`
  (`drizzle(createPool(config.DATABASE_URL), { schema })` from `@www/core`). Copy
  `features/weight/{config,db}.ts` verbatim shape.
- **`weather-ingest` is a 5-min Worker INTERVAL, not a queue job.** Stays
  hand-wired in `apps/worker/src/index.ts` (`name: "weather-ingest"`,
  `intervalMs: 5*60_000`, line 135-138) importing via `@features/*`. NOT an S1
  consumer; NO `defineJobs` facet.
- **`weather-purge` migrates to the S2 cron seam NOW.** S2 is landed
  (guest-wifi/jobs.ts precedent). `infra/src/crons.ts` `generatedCronSpecs()`
  (line 99-106) auto-emits one k8s CronJob per collected `defineCron` — zero
  infra hand-edit.
- **`integration_sync_status` + heartbeat are in `@www/core`** (P1.5). Feature
  builds its own store: `createPgIntegrationSyncStore(db)` over the feature's
  drizzle db (mirrors `apps/api/src/db/integration-sync-store.ts`).
- **`apps/web → @features/*` is ALLOWED** (tile-registry.ts already imports
  `@features/*/manifest`; no Biome rule bans it). `features/tsconfig.json` maps
  `@/*` → `../apps/web/src/*`, so moved feature web files keep importing shared
  UI via `@/`.

---

## Target layout: `features/weather/`

```
features/weather/
  manifest.ts        # defineApp, id "tile_weather", tiles:[weath, hourly] (VERBATIM coords)
  api.ts             # defineApi(router({ weather: weatherRouter })) — from apps/api routers/weather.ts
  service.ts         # reads (readWeatherNow/Hourly/Daily) — was weather-read-service.ts
  weather-codes.ts   # pure helpers (WEATHER_CODES, weatherIcon, nextSolarEvent, WeatherNow/HourlyItem/DailyItem types) — was weather-service.ts
  ingest.ts          # runWeatherIngestCycle — was weather-ingest-service.ts; hand-wired by apps/worker via @features
  jobs.ts            # defineCron weather-purge only (purge logic from weather-purge-service.ts) — S2 seam
  schema.ts          # weatherReading + weatherDailyReading pgTables (from apps/api db/schema.ts:56-101)
  config.ts          # z.object({ DATABASE_URL, HOME_LAT, HOME_LON, HOME_PLACE_NAME }).parse(process.env)
  db.ts              # drizzle(createPool(config.DATABASE_URL), { schema })
  web.tsx            # barrel: re-export the two tile component pairs from web/
  web/               # the 33-file weather component subtree (see §Web move — FULL move)
  *.test.ts(x)       # moved + repointed tests
```

**Service split is DECIDED (MINOR-3): mirror the source split, 1:1 test repoint.**
`weather-read-service.ts` (reads) → `service.ts`; `weather-service.ts` (pure
helpers) → `weather-codes.ts`. Do NOT collapse to one file. This keeps
`weather-read-service.test.ts → service.test.ts` and any helper test → a
`weather-codes.test.ts` a mechanical repoint.

### `manifest.ts` (the load-bearing new shape)

```ts
import { defineApp } from "@app-kit";
import { HourlyTile, HourlyTileView, WeatherTile, WeatherTileView } from "./web";

export default defineApp({
  id: "tile_weather",
  tiles: [
    { id: "tile_weath",  label: "Weather Now",   component: WeatherTile, viewComponent: WeatherTileView, worldCol: 26, worldRow: 24, cols: 4, rows: 3 },
    { id: "tile_hourly", label: "Next 12 Hours", component: HourlyTile,  viewComponent: HourlyTileView,  worldCol: 22, worldRow: 24, cols: 4, rows: 3 },
  ],
});
```

- **App `id: "tile_weather"`** — distinct from both tile ids, matches the folder +
  the `weather` router-key. First App where app id ≠ tile id. VERIFIED unique:
  no other app/tile registers `tile_weather`. Note (MINOR-2): the string
  `"tile_weather"` appears in `apps/web/src/lib/__tests__/log-interaction.test.ts:66,79`
  as an arbitrary `interaction()` tileId arg — a coincidental literal, NOT a
  registered id, NOT a collision. Ignore it.
- **Neither tile is `home`.** Home is the Clock (`tile-registry.ts:78`). A stray
  `home` makes it two → `validate.ts` throws. Do NOT set it.
- **Labels MUST match the rendered `TileHeader` title** ("Weather Now",
  "Next 12 Hours") — `tile-title-sync` guard. Copy verbatim from the deleted
  registry entries.
- **Coords VERBATIM** from `tile-registry.ts`: `tile_weath` 26/24/4×3;
  `tile_hourly` 22/24/4×3. Edge-adjacent (cols 26-29 vs 22-25, same rows) — no
  overlap; intra-app check passes; board layout byte-identical.
- **`guestExposed`: NEITHER.** `GUEST_EXPOSED` allowlist
  (`features/guest-exposed.ts`) is `["tile_guestwifi"]` only. Do NOT set
  `guestExposed`; do NOT touch the allowlist. `validate.ts` cross-checks
  flag⇄allowlist; both absent is consistent.

### `web.tsx` — barrel

The manifest imports four named exports from `./web`. `web.tsx` re-exports the two
moved tile component pairs under stable names:

```ts
// features/weather/web.tsx
export { WeatherNow as WeatherTile, WeatherNowView as WeatherTileView } from "./web/WeatherNow";
export { Next12Hours as HourlyTile, Next12HoursView as HourlyTileView } from "./web/Next12Hours";
```

(Keep the source export names inside the moved files; alias to `*Tile`/`*TileView`
at the barrel. Pick either aliasing or the raw names in manifest.ts — be
consistent.)

### `api.ts`

Move `apps/api/src/trpc/routers/weather.ts` verbatim; swap tRPC runtime import to
`@app-kit/server`, read import to `./service`; brand with `defineApi`:

```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { readWeatherDaily, readWeatherHourly, readWeatherNow } from "./service";

const weatherRouter = router({ /* now / hourly / daily — verbatim */ });
export const api = defineApi(router({ weather: weatherRouter }));
```

Codegen collects key `weather` off `api._def.record` (collect.ts:253) → merges
into `featureAppRouter`. `validate.ts` rejects a dup `weather` router key → the
base mount MUST be deleted in the same commit (§Deletions #2).

---

## Web move — FULL move of the 33-file weather subtree (PLACEHOLDER-1 RESOLVED)

**Decision: move the entire weather closure into `features/weather/web/`. NOT the
top-4 fallback.** The closure is self-contained (verified: no non-weather tile
imports any of these; `SolarDayArcGraphic` is weather-only). Reaches the locked
code-ownership end-state in one pass.

**The exact 33 files (enumerated — verified with grep at HEAD):**

Group A — `apps/web/src/components/tiles/` (6):
`WeatherNow.tsx`, `WeatherNowView.tsx`, `WeatherNowView.stories.tsx`,
`Next12Hours.tsx`, `Next12HoursView.tsx` (defines the `HourlyEntry` type),
`Next12HoursView.stories.tsx`.

Group B — `apps/web/src/components/tiles/__tests__/` (6):
`WeatherNow.test.tsx`, `WeatherNowView.test.tsx`, `WeatherNowView.stories.test.tsx`,
`Next12Hours.test.tsx`, `Next12HoursView.test.tsx`, `Next12HoursView.stories.test.tsx`.

Group C — `apps/web/src/components/tiles/views/` (16 = 8 components + 8 stories):
`WeatherModalSunDayArc{,.stories}.tsx`, `WeatherModalHourlyTempCurve{,.stories}.tsx`,
`WeatherModalComfortBreakdown{,.stories}.tsx`, `WeatherModalWeekOutlook{,.stories}.tsx`,
`Next12HoursModalComfortBand{,.stories}.tsx`, `Next12HoursModalThermalDayArc{,.stories}.tsx`,
`Next12HoursModalSkyClock{,.stories}.tsx`, `Next12HoursModalConditionTimeline{,.stories}.tsx`.

Group D — `apps/web/src/components/` (SolarDayArcGraphic, weather-ONLY, 3):
`SolarDayArcGraphic.tsx`, `SolarDayArcGraphic.stories.tsx`,
`__tests__/SolarDayArcGraphic.stories.test.tsx`.

Group E — `apps/web/src/components/tiles/views/wiring/` (2):
`weather.tsx` (exports `weatherDetailEntry`), `next12hours.tsx` (exports
`next12HoursDetailEntry`).

**= 33 files.** (The review's "~34" estimate; the exact closure is 33. All move.)

Suggested internal structure under `features/weather/web/`: keep the same relative
shape — top tile comps at `web/`, modal views at `web/views/`, wiring at
`web/wiring/`, `SolarDayArcGraphic` at `web/SolarDayArcGraphic.tsx`, tests beside
their subjects (or a `web/__tests__/`).

### Import-repoint rules (CRITICAL — these files use `@/` absolute imports internally, not `./`)

The moved files reference each other via `@/components/...` absolute paths (e.g.
`wiring/weather.tsx` imports `@/components/tiles/views/WeatherModalComfortBreakdown`;
`WeatherModalSunDayArc.tsx` imports `@/components/SolarDayArcGraphic`). After the
move those `@/` targets no longer exist under `apps/web`. So:

- **Any `@/` import pointing at a MOVED file** (`@/components/tiles/WeatherNow*`,
  `@/components/tiles/Next12Hours*`, `@/components/tiles/views/WeatherModal*`,
  `@/components/tiles/views/Next12HoursModal*`,
  `@/components/tiles/views/wiring/{weather,next12hours}`,
  `@/components/SolarDayArcGraphic`) → **repoint to a feature-local relative path**
  (`./…`, `../…`) matching the new structure.
- **Any `@/` import pointing at a file that STAYS** (`@/components/ui`,
  `@/components/Icon`, `@/lib/hooks`, `@/lib/trpc`, `@/lib/useTileQuery`,
  `@/components/tiles/detail/types`, `@/components/tiles/detail/*`) → **keep `@/`
  unchanged.** These are shared primitives / detail infra used by other tiles.

### External consumers that STAY in apps/web and repoint TO the feature

1. **`apps/web/src/lib/tile-registry.ts`** — delete the `tile_weath` + `tile_hourly`
   `REGISTRY_ENTRIES` and the now-unused direct component imports
   (`WeatherNow`/`WeatherNowView`/`Next12Hours`/`Next12HoursView`); add
   `import weatherManifest from "@features/weather/manifest"` and push it into
   `FEATURE_MANIFESTS`.
2. **`apps/web/src/components/tiles/detail/registry.ts`** — repoint the two moved
   wiring imports (currently `../views/wiring/weather`, `../views/wiring/next12hours`)
   to `@features/weather/web/wiring/weather` and
   `@features/weather/web/wiring/next12hours`. The `weatherDetailEntry` /
   `next12HoursDetailEntry` in the `ENTRIES` array are unchanged. This keeps the
   detail-registry completeness test (`registry-entries.test.ts`) green.
3. **`apps/web/.storybook/main.ts`** — its `stories` glob is `["../src/**/*.mdx",
   "../src/**/*.stories.@(ts|tsx)"]`, scoped to `apps/web/src` ONLY. Moved stories
   under `features/` would NOT be discovered. **Add a features entry:**
   `"../../../features/**/*.stories.@(ts|tsx)"`. Weather is the first feature to
   carry stories, so this is the wiring that keeps Storybook-first honest. (The
   `*.stories.test.tsx` vitest files import the story modules directly and do not
   depend on this glob — but the glob is required for the Storybook build.)

No other apps/web file imports any moved file (verified: the only external
consumers of the View components are tile-registry.ts; of the wiring,
detail/registry.ts; `SolarDayArcGraphic` has no non-weather consumer).

---

## Ingest — stays a hand-wired worker interval

Move `apps/api/src/services/weather-ingest-service.ts` → `features/weather/ingest.ts`.
Repoint apps/api imports to feature-local:

- `db` from `../db/index` → `./db`.
- `integrationSyncStore` from `../db/integration-sync-store` → build feature-local:
  `const integrationSyncStore = createPgIntegrationSyncStore(db)`
  (`createPgIntegrationSyncStore` from `@www/core`, `db` from `./db`). Module-level
  singleton is fine (lazy pool). Live in `ingest.ts` or a small
  `integration-sync.ts`.
- `weatherDailyReading, weatherReading` from `../db/schema` → `./schema`.
- `env` from `../env` → read `config.HOME_LAT` / `config.HOME_LON` /
  `config.HOME_PLACE_NAME` from `./config` (env defaults 34.0537 / -118.2428 /
  "Home" — `apps/api/src/env.ts:47-49`).
- `heartbeat` from `@www/core` — unchanged.

Rewire the worker:

- `apps/worker/src/index.ts:28` imports `runWeatherIngestCycle` from the
  worker-deps barrel. Change to
  `import { runWeatherIngestCycle } from "@features/weather/ingest"` (`apps/worker
  → @features` allowed). The `weather-ingest` Worker entry (line 135-138) is
  otherwise unchanged.
- Delete `apps/api/src/worker-deps.ts:39`
  (`export { runWeatherIngestCycle } from "./services/weather-ingest-service"`) —
  knip zero-tolerance flags the orphan otherwise.

---

## Purge — onto the S2 cron seam `jobs.ts` (PLACEHOLDER-2 RESOLVED: S2 now)

Move `apps/api/src/services/weather-purge-service.ts` logic (`purgeWeatherData`,
`WEATHER_RETENTION_MS`, batch helpers) into `features/weather/jobs.ts` as a
`defineCron` mirroring `features/guest-wifi/jobs.ts`:

```ts
import { defineCron } from "@app-kit";
import { db } from "./db";
// …purge logic (moved verbatim), typed against NodePgDatabase<typeof schema>…

export const purgeCron = defineCron({
  name: "weather-purge",
  schedule: "0 3 * * *",   // daily 03:00 UTC — staggered off guest-wifi's 0 2 * * *
  run: async () => { await purgeWeatherData(db); },
});
```

- **`jobs.ts` GUARD: export ONLY `purgeCron = defineCron(...)`. NEVER a
  `defineJobs([...])` facet.** Ingest is an interval, not a queue job.
  `collect.ts:257-280` reads BOTH brands off `jobs.ts`; a stray empty
  `defineJobs` sets `hasJobs` wrongly. defineCron-only.
- `generatedCronSpecs()` auto-produces the `weather-purge` k8s CronJob — no infra
  hand-edit. Confirm `infra/test/crons.test.ts` + `infra/test/cronjob.test.ts`
  stay green (they assert over the generated set, now including `weather-purge`).
- **Remove weather from `apps/api/src/purge.ts`:** delete the `purgeWeatherData`
  import (line 28), the `const weather = await purgeWeatherData(db)` call (line 33),
  the `...weather` log spread (line 39), and the `if (weather.truncated)` warn
  block (line 47-49). The remaining bundle (frontend-log / wake-photo / github)
  keeps running under "portal-data-purge".
- Delete `apps/api/src/services/weather-purge-service.ts` +
  `apps/api/src/__tests__/weather-purge-service.test.ts` (test moves into the
  feature as `jobs.test.ts`, repointed).

---

## Schema move

Move `weatherReading` + `weatherDailyReading` (`apps/api/src/db/schema.ts:56-101`)
into `features/weather/schema.ts` verbatim — same SQL table names
(`weather_reading` / `weather_daily_reading`), same columns/indexes (a rename would
be a migration). Delete from `apps/api/src/db/schema.ts`. Codegen collects the
feature's `pgTable`s into `schema.gen.ts`; `validate.ts` rejects a dup table name
→ base copies MUST be deleted in the same commit.

- Standalone append-only tables, no FKs (per source comments). Grep
  `weatherReading`/`weatherDailyReading` across `apps/api/src/db/` before deleting
  to confirm no relation references them.
- `drizzle db:generate` NOT needed (no DDL change; tables move packages, identical
  SQL). If the drizzle snapshot picks up the relocation, `bunx biome format --write`
  the meta dir before lint (memory `drizzle-generate-needs-biome-format`). Verify
  no unintended migration is emitted.

---

## Deletions (all in the ONE atomic commit)

1. `apps/web/src/lib/tile-registry.ts` — delete `tile_weath` + `tile_hourly`
   `REGISTRY_ENTRIES` + the now-unused direct component imports; add
   `weatherManifest` → `FEATURE_MANIFESTS`.
2. `apps/api/src/trpc/routers/index.ts` — delete
   `import { weatherRouter } from "./weather"` (line 15) and the
   `weather: weatherRouter` mount (line 23). Feature supplies `weather` via
   `featureAppRouter`.
3. `apps/api/src/trpc/routers/weather.ts` — delete (→ feature `api.ts`).
4. `apps/api/src/services/weather-service.ts`, `weather-read-service.ts`,
   `weather-ingest-service.ts`, `weather-purge-service.ts` — delete (moved).
5. `apps/api/src/db/schema.ts` — delete the two weather tables.
6. `apps/api/src/worker-deps.ts:39` — delete the `runWeatherIngestCycle` re-export.
7. `apps/api/src/purge.ts` — remove the weather purge (§Purge).
8. `apps/api/src/__tests__/weather*.test.ts` (4 files) — delete after relocating +
   repointing into `features/weather/`.
9. The 33 web files (Groups A-E) — delete originals under `apps/web/src/components/`.

**knip is zero-tolerance, whole tree** — every moved file's original MUST be
deleted (no re-export shims). After moving, `bun run knip`; chase any newly
orphaned export to zero.

---

## Tests to move / add

- `apps/api/src/__tests__/weather.test.ts` (router) → `features/weather/api.test.ts`
  (repoint to `./api` / `./service`).
- `weather-read-service.test.ts` → `features/weather/service.test.ts`.
- (any pure-helper test) → `features/weather/weather-codes.test.ts`.
- `weather-ingest-service.test.ts` → `features/weather/ingest.test.ts`.
- `weather-purge-service.test.ts` → `features/weather/jobs.test.ts`.
- The 33 web files include their own `*.test.tsx` + `*.stories.test.tsx` (Groups
  B, D) — they move alongside their subjects with repointed relative imports.
- **NEW collect test** (§CRUX) in `scripts/apps-gen/collect.test.ts`.
- The `apps/web` **placeholder-tiles / bento** test MUST pass with the two weather
  tiles now sourced from the manifest. Both are 4×3 (not 1×1) so the 1×1 clearance
  risk (memory `bento-tiler-1x1-clearance`) is low, but run it explicitly: the
  registry-entry deletion + manifest addition net to the SAME two rects at the
  SAME coords → board layout byte-identical. Core regression guard.
- `registry-entries.test.ts` (detail completeness) MUST stay green — the two
  weather detail entries remain registered via the repointed `detail/registry.ts`
  imports.

---

## Verify chain (implementer runs ALL, in order)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck
bunx vitest run \
  scripts/apps-gen \                   # collect/validate incl. the NEW multi-tile collect test
  features/weather \
  apps/web/src/lib/__tests__/placeholder-tiles* \
  apps/web/src/components/tiles/detail  # registry-entries completeness + tile-title-sync
  # (glob the actual placeholder-tiles / tile-title-sync / registry-entries paths)
bun run apps:check                     # codegen drift + validator (dup id/router-key/table, =1 home, no overlap incl. intra-app, guestExposed⇔allowlist)
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome (dep-boundary: no features/* → apps/api)
bunx vitest run infra/test/crons.test.ts infra/test/cronjob.test.ts   # weather-purge CronJob now in the generated set
git pull --rebase --autostash
git add <explicit paths>               # NEVER git add -A
git show --stat HEAD  # (after commit) confirm only weather-fold paths staged
git commit -m "..."   # message below
git push
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor
# then confirm deploy green + pod image age (memory ci-cancelled-runs-strand-image-digests)
```

Confirm after `apps:check`:
- `features/_generated/tiles.gen.ts` has `tile_weath` + `tile_hourly`, BOTH
  `appId: "tile_weather"`, `source: "feature"`, each **exactly once** (the BLOCKER
  regression), same coords.
- `features/_generated/router.gen.ts` mounts `weather`.
- `features/_generated/schema.gen.ts` includes `weather_reading` +
  `weather_daily_reading`.
- `features/_generated/crons.gen.ts` + `cron-handlers.gen.ts` include
  `weather-purge`.
- Biome dep-boundary: no surviving `features/weather/* → apps/api/*` import.

---

## Gotchas (inherit)

- `features/* → apps/api/*` is Biome-banned. Every moved backend file repoints to
  `@www/core`, `@app-kit`/`@app-kit/server`, or feature-local `./`. Moved web files
  repoint to `@/` (shared) or `./` (moved). A single surviving `apps/api` import in
  a feature turns lint red.
- `apps/worker → @features/*` and `apps/web → @features/*` are ALLOWED.
- `bun build` reads the **CWD** tsconfig paths (memory
  `bun-build-alias-needs-cwd-tsconfig`). This fold removes weather FROM apps/api;
  the residual risk is the worker build resolving `@features/weather/ingest` — the
  worker image build must go green (verify in CI).
- Parallel sessions push `main`: `git pull --rebase --autostash`; **never**
  `git add -A` (memory `never-git-add-all-shared-checkout`); lefthook format
  re-stages the whole tree (memory `lefthook-format-restages-whole-tree`) — stage
  explicit paths, `git show --stat HEAD` before push, tree may carry peer dirt.
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- **ONE commit.** Codegen only collects a feature once `manifest.ts` exists, and
  base router/schema deletions + the collect.ts fix must be simultaneous or
  `apps:check` throws (dup-router-key / dup-table / dup-tile-id). Do NOT split into
  "add feature" then "delete base" — the intermediate state is red.

---

## Commit message (no backticks)

```
feat(features): fold weather cluster into two-tile features/weather App (F-weather)

First multi-tile fold. weath + hourly tiles now live in one features/weather App
declaring both via F0's tiles[] manifest, owning the weather router,
weather_reading + weather_daily_reading tables, the weather-ingest interval
(hand-wired in apps/worker via @features), and the weather-purge cron on the S2
seam. Fixes scripts/apps-gen/collect.ts dedup to key on the union of feature tile
ids (not app ids) so a multi-tile app's tiles are not double-collected — the
codegen change that unblocks every future multi-tile fold. Registry entries, base
weather router/schema/services, worker-deps re-export, and the purge-bundle
weather pass removed. Full 33-file weather web subtree moved under
features/weather/web/. No coord or DDL change; board layout byte-identical.
```

---

## Resolved decisions (no open PLACEHOLDERs)

1. **collect.ts dedup** — fixed in §CRUX + collect test; in the atomic commit.
2. **Web subtree** — FULL move of all 33 enumerated files (Groups A-E), plus the 3
   external repoints (tile-registry, detail/registry, storybook glob).
3. **App id** — `tile_weather` (verified unique; log-interaction literal is a
   coincidence, not a collision).
4. **Purge** — S2 `defineCron` now, schedule `0 3 * * *`; purge.ts pass deleted;
   infra crons/cronjob tests asserted green.
5. **Service split** — `service.ts` (reads) + `weather-codes.ts` (helpers),
   mirroring the source split for 1:1 test repoint.
6. **jobs.ts** — `defineCron`-only, NO `defineJobs`.
