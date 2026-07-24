# Unit F-felogs — Fold the Frontend Logs tile into `features/felogs`

Track C, Wave 7. **Single-tile fold.** Fold `tile_felogs` (Frontend Logs) into one
`features/felogs/` App that owns the `logs` tRPC router (the frontend-log ingest),
the `frontend_log` Postgres table, the ingest service, and the log-retention purge
(migrated onto the S2 cron seam).

**Fold felogs FIRST; the wakes/sessions fold is the NEXT unit.** The
`interaction-session-service` (in `apps/api`) reads BOTH `frontendLog` (this
feature) and `wakePhoto` (the wakes feature). It STAYS in `apps/api` for this
unit — it lands with the wakes fold. This unit only makes felogs EXPORT the
`frontendLog` table so the session service reads it via `@features/felogs/schema`
(the sanctioned `apps/api → @features` direction), instead of a table def duplicated
in `apps/api`. See §Cross-feature reader.

Reference folds to mirror: `features/tesla/` + `features/network/` (single-tile
manifest + api shape), `features/weight/` (owns a table + `config.ts` + `db.ts`),
`features/guest-wifi/` + `features/weather/` (`jobs.ts` `defineCron` on the S2 seam).
The just-landed `features/weather/` two-tile fold (commit `4be52f800`) is the proven
template; this unit is the SIMPLER single-tile shape (no multi-tile, no
`collect.ts` change, no worker interval). Pattern doc:
`docs/writing-scalable-typescript/README.md`.

**ONE atomic commit.** Codegen only collects a facet once `manifest.ts` exists, and
base router/schema deletions must be simultaneous or `apps:check` throws
(dup-router-key / dup-table). Do NOT split "add feature" then "delete base".

---

## Facts established during planning (verified at HEAD; do not re-derive)

- **No `collect.ts` change.** Single-tile fold: app id == tile id == `tile_felogs`,
  so the existing dedup (`featureTileIds`, already fixed on main by weather) is
  correct. Do NOT touch `scripts/apps-gen/collect.ts`.
- **No worker interval, no enforcer, no queue job.** Frontend-log ingest is an
  on-demand tRPC mutation; retention is a daily purge (→ S2 cron). `grep` over
  `apps/worker/src` + `apps/api/src/worker-deps.ts` shows ZERO felogs references.
  So felogs has NOTHING left hand-wired in `apps/worker`, and `jobs.ts` is
  `defineCron`-only (NO `defineJobs`).
- **The felogs web closure is 4 files** (verified with `grep -rln FrontendLogs`):
  `FrontendLogsTile.tsx`, `FrontendLogsTileView.tsx`,
  `FrontendLogsTileView.stories.tsx`, and the detail wiring
  `detail/wiring/frontend-logs.tsx`. No `*.test.tsx` / `*.stories.test.tsx` exists
  for this tile — nothing web-side to relocate as a test. The `lib/log/*`
  (`store`, `logger`, `types`) modules are SHARED frontend-logging infra (also used
  by `PushRegistrar`, `TileBoundary`, `LogsView`, etc.) — they STAY in `apps/web`;
  moved web files repoint `../../lib/log/*` → `@/lib/log/*`.
- **The ONLY cross-module consumer of the `frontendLog` TABLE symbol** (outside the
  felogs owning files) is `apps/api/src/services/interaction-session-service.ts`
  (verified by `grep -rn "frontendLog" --include=*.ts`, minus the owning files).
  Everything else that touches frontend logs goes through the service functions
  (`ingestFrontendLogs`, `purgeFrontendLogs`) or the tRPC client (`log/ship.ts`
  posts `logs.ingest` over `/trpc` — a client call, unaffected by the router moving
  as long as the `logs` router key is preserved).
- **`apps/api → @features/*` is ALLOWED.** `biome.json`'s `noRestrictedImports`
  bans only `features/* → apps/api` (and app-kit/platform/core → features). The
  reverse is legal. `sessions.ts` / `interaction-session-service.ts` importing
  `@features/felogs/schema` is the sanctioned interim path.
- **Feature DB pattern:** own `config.ts` (validates `process.env`, `DATABASE_URL`
  `.default()`ed so codegen import never throws) + `db.ts`
  (`drizzle(createPool(config.DATABASE_URL), { schema })` from `@www/core`). Copy
  `features/weight/{config,db}.ts` verbatim. The ingest api.ts uses THIS db (the
  current router uses `ctx.db`; the feature supplies its own pool, weight
  precedent). The session service keeps using `apps/api`'s own `db` pool with the
  imported table object — two pools against the same physical `frontend_log` table,
  exactly the weight precedent (ingest pool vs api pool).
- **drizzle:** `drizzle.config.ts` points at `features/_generated/schema.gen.ts`
  (the union of base + every feature schema). Moving `frontendLog` from
  `apps/api/src/db/schema.ts` to `features/felogs/schema.ts` keeps the SQL table
  name `frontend_log` and identical columns/indexes → the table SET is unchanged →
  `db:generate` emits NO migration. Do NOT run `db:generate`. If it is run and
  picks up the relocation, `bunx biome format --write` the meta dir before lint
  (memory `drizzle-generate-needs-biome-format`) and confirm no DROP/CREATE.
- **`infra/src/crons.ts` auto-emits a k8s CronJob per collected `defineCron`**
  (`generatedCronSpecs()`). A `felogs-purge` cron appears automatically — zero infra
  hand-edit. `infra/test/{crons,cronjob}.test.ts` assert over the generated set;
  they should stay green with the new entry (verify; fix-forward if they pin an
  exact list/count).

---

## Target layout: `features/felogs/`

```
features/felogs/
  manifest.ts        # defineApp, id "tile_felogs", tiles:[felogs] (coords VERBATIM); NOT home, NOT guestExposed
  api.ts             # defineApi(router({ logs: logsRouter })) — router key stays "logs"
  service.ts         # ingestFrontendLogs + zod schemas + consts — was frontend-log-service.ts
  schema.ts          # frontendLog pgTable ("frontend_log") — from apps/api/db/schema.ts:192-222
  jobs.ts            # defineCron "felogs-purge" (purge logic from frontend-log-purge-service.ts) — S2 seam
  config.ts          # z.object({ DATABASE_URL }).parse(process.env) — copy features/weight/config.ts verbatim
  db.ts              # drizzle(createPool(config.DATABASE_URL), { schema }) — copy features/weight/db.ts verbatim
  web.tsx            # FrontendLogsTile container + FrontendLogsTileView (inlined) — manifest imports both
  web.stories.tsx    # was FrontendLogsTileView.stories.tsx; imports ./web
  detail-wiring.tsx  # was detail/wiring/frontend-logs.tsx; exports frontendLogsDetailEntry
  service.test.ts    # was apps/api/src/__tests__/frontend-log-service.test.ts (repointed)
  jobs.test.ts       # was apps/api/src/__tests__/frontend-log-purge-service.test.ts (repointed)
```

### `manifest.ts`

```ts
import { defineApp } from "@app-kit";
import { FrontendLogsTile, FrontendLogsTileView } from "./web";

export default defineApp({
  id: "tile_felogs",
  tiles: [
    {
      id: "tile_felogs",
      label: "Frontend Logs",
      component: FrontendLogsTile,
      viewComponent: FrontendLogsTileView,
      worldCol: 26,
      worldRow: 30,
      cols: 4,
      rows: 2,
    },
  ],
});
```

- **App `id: "tile_felogs"`** — single-tile, so app id == tile id (matches
  tesla/network). Folder is `features/felogs`.
- **Router key stays `logs`** (NOT `felogs`) — the frontend shipper posts
  `logs.ingest` (`apps/web/src/lib/log/ship.ts`); preserving the key keeps the
  client path byte-identical. `api.ts` = `router({ logs: logsRouter })`.
- **Coords VERBATIM** from `tile-registry.ts:164-172`: `worldCol 26, worldRow 30,
  cols 4, rows 2`. `label "Frontend Logs"`.
- **NOT `home`.** Home is the Clock (`tile-registry.ts`). A stray `home` makes it
  two → `validate.ts` throws. Do NOT set it.
- **NOT `guestExposed`.** `GUEST_EXPOSED` allowlist (`features/guest-exposed.ts`) is
  `["tile_guestwifi"]` only. Do NOT set `guestExposed`; do NOT touch the allowlist.
  `validate.ts` cross-checks flag⇔allowlist; both-absent is consistent.
- **`tile-title-sync` guard:** label MUST match the rendered `TileHeader` title.
  Verified `FrontendLogsTileView` renders `<TileHeader icon="apps" title="Frontend
  Logs" />` (lines 73, 94). Label `"Frontend Logs"` matches. Do not change either.

### `web.tsx` — inline the Tile + View (tesla/network single-tile shape)

The fold gotcha is "Tile view INLINED in `web.tsx`". tesla/network both define the
container AND the presentational view directly in `web.tsx` and export both; the
manifest imports `{ Tile, TileView } from "./web"`. Mirror that: move the
`FrontendLogsTile` body (container, 55 lines) and the `FrontendLogsTileView` body
(presentational + its exported types `LogHourBucket` / `FrontendLogsTileViewProps`,
163 lines) into a single `features/felogs/web.tsx` (~210 lines, on par with
`features/tesla/web.tsx`'s 213). Export `FrontendLogsTile`, `FrontendLogsTileView`,
and re-export the view prop types (`web.stories.tsx` uses them).

Import-repoint rules inside the moved web code:

- `@/components/ui` (`Skeleton`, `Tile`, `TileHeader`, `TileStatus`) → **keep `@/`**
  (shared primitive).
- `../../lib/log/logger` (`flushNow`) → **`@/lib/log/logger`** (shared, stays in
  apps/web).
- `../../lib/log/store` (`* as store`) → **`@/lib/log/store`**.
- `../../lib/log/types` (`LOG_LEVELS`, `LogLevel`) → **`@/lib/log/types`**.
- `./FrontendLogsTileView` (container → view) → now a same-file local reference
  (inlined); delete the import.

> ALT (acceptable if the implementer prefers not to inline): keep the view as a
> sibling `features/felogs/tile-view.tsx` and have `web.tsx` import + re-export it,
> matching how tesla keeps `tesla-map.tsx` separate. Either is fine; the manifest
> and `web.stories.tsx` still import from `./web`. Pick one and be consistent.

### `web.stories.tsx`

Move `FrontendLogsTileView.stories.tsx` → `features/felogs/web.stories.tsx`. Repoint:

- `./__stories__/factory` (`defineTileMeta`) → **`@/components/tiles/__stories__/factory`**
  (shared story factory, stays in apps/web).
- `./FrontendLogsTileView` → **`./web`**.

Storybook glob: `apps/web/.storybook/main.ts` already scans
`"../../../features/**/*.stories.@(ts|tsx)"` (weather landed it — confirm it is
present; do NOT re-add if so). This is the first felogs story under `features/`, so
that glob is what keeps it discoverable. `bun run knip` + a Storybook build stay
honest via it.

### `detail-wiring.tsx`

Move `apps/web/src/components/tiles/detail/wiring/frontend-logs.tsx` →
`features/felogs/detail-wiring.tsx` (exports `frontendLogsDetailEntry`, an ACTION
entry that calls `openSettings("logs")`). This reaches the locked end-state
(feature owns its whole web closure), mirroring what weather did with its wiring.
Repoint:

- `@/lib/settings-overlay-store` (`openSettings`) → **keep `@/`** (shared).
- `../types` (`TileDetailActionEntry`) → **`@/components/tiles/detail/types`**
  (shared detail infra, stays).

Then in `apps/web/src/components/tiles/detail/registry.ts`: change
`import { frontendLogsDetailEntry } from "./wiring/frontend-logs";` →
`import { frontendLogsDetailEntry } from "@features/felogs/detail-wiring";`. The
`ENTRIES` array is otherwise unchanged — `registry-entries.test.ts` (detail
completeness) stays green because `tile_felogs` still has a registered entry.

> Note (out of scope): tesla/network left their detail wiring in
> `apps/web/.../views/wiring/` — those get cleaned up in their own follow-ups. This
> unit moves ONLY the felogs wiring.

### `api.ts`

Move `apps/api/src/trpc/routers/logs.ts` into the feature; swap the tRPC runtime
import to `@app-kit/server`, the service import to `./service`, brand with
`defineApi`, and supply the feature-local `db`:

```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { db } from "./db";
import { frontendLogIngestSchema, ingestFrontendLogs } from "./service";

// EXPORTED (mirrors features/weight `export const weightRouter`) so the moved
// service.test.ts can `import { logsRouter } from "./api"` and assert the key
// locally — see §Tests. Do NOT downgrade to `const`.
export const logsRouter = router({
  // Devices ship their frontend logs here (spec 2026-07-18). Idempotent by the
  // composite PK. Thin wrapper: validation + persistence live in ./service.
  ingest: publicProcedure
    .input(frontendLogIngestSchema)
    .mutation(({ input }) => ingestFrontendLogs(db, input)),
});

/** The branded `api` facet — single top-level key `logs`. */
export const api = defineApi(router({ logs: logsRouter }));
```

- The current router reads `ctx.db`; the feature has no such ctx (weight/tesla
  precedent) → use the feature's own `db` from `./db`. Behaviour identical (same
  physical `frontend_log` table).
- Codegen collects key `logs` off `api._def.record` → merges into
  `featureAppRouter`. `validate.ts` rejects a dup `logs` router key → the base
  mount MUST be deleted in the SAME commit (§Deletions #2).

### `service.ts`

Move `apps/api/src/services/frontend-log-service.ts` verbatim (exports
`MAX_DATA_BYTES`, `MAX_BATCH_SIZE`, `frontendLogEntrySchema`,
`frontendLogIngestSchema`, `FrontendLogIngestInput`, `FrontendLogIngestResult`,
`ingestFrontendLogs`). Repoint `import * as schema from "../db/schema"` →
`import * as schema from "./schema"`. `@www/logger` unchanged.

### `schema.ts`

Move the `frontendLog` `pgTable` (`apps/api/src/db/schema.ts:192-222`) verbatim —
same SQL name `frontend_log`, same columns, same three indexes (`frontend_log_ts_idx`,
`frontend_log_level_ts_idx`, and the partial `frontend_log_ui_session_idx` on
`(data->>'interactionSessionId') where source = 'ui'`). Keep the drizzle imports it
needs (`pgTable`, `text`, `timestamp`, `jsonb`, `primaryKey`, `index`, `sql`) —
import from `drizzle-orm` / `drizzle-orm/pg-core` as the source does. Delete the
table (and its leading comment block, `schema.ts:184-191`) from
`apps/api/src/db/schema.ts`. **Leave `wakePhoto` (schema.ts:239+) in place** — it
belongs to the wakes fold (next unit).

### `jobs.ts` — retention purge onto the S2 cron seam

Move the purge logic from `apps/api/src/services/frontend-log-purge-service.ts`
(`FRONTEND_LOG_RETENTION_MS`, `MAX_BATCHES`, `PURGE_BATCH_SIZE`, `frontendLogCutoff`,
`logShouldPurge`, `purgeFrontendLogs`) into `features/felogs/jobs.ts` as a
`defineCron`, mirroring `features/weather/jobs.ts`:

```ts
import { defineCron } from "@app-kit";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "./db";
import type * as schema from "./schema";

// …FRONTEND_LOG_RETENTION_MS, batch consts, frontendLogCutoff, logShouldPurge,
//   purgeFrontendLogs(db, now) — moved verbatim, typed NodePgDatabase<typeof schema>…

export const purgeCron = defineCron({
  name: "felogs-purge",
  schedule: "0 4 * * *", // daily 04:00 UTC — staggered off guest-wifi 0 2 / weather 0 3
  run: async () => {
    await purgeFrontendLogs(db);
  },
});
```

- **`jobs.ts` GUARD: export ONLY `purgeCron = defineCron(...)`. NEVER a
  `defineJobs([...])` facet.** felogs has no queue job. `collect.ts` reads both
  brands off `jobs.ts`; a stray `defineJobs` sets `hasJobs` wrongly.
- `purgeFrontendLogs` currently takes `db` as an arg; keep it exported + arg-taking
  (the moved `jobs.test.ts` calls it with a mock db), and have `run` pass `./db`'s
  `db` — same shape as weather (`purgeWeatherData(db)`).
- `generatedCronSpecs()` auto-produces the `felogs-purge` k8s CronJob — no infra
  hand-edit. Confirm `infra/test/crons.test.ts` + `infra/test/cronjob.test.ts` stay
  green (now including `felogs-purge`); fix-forward if they pin an exact set.

### `config.ts` + `db.ts`

Copy `features/weight/config.ts` and `features/weight/db.ts` VERBATIM (only
`DATABASE_URL` is needed; `db.ts` imports `* as schema from "./schema"`). Update the
doc comments to say "felogs" instead of "weight".

---

## Cross-feature reader — `interaction-session-service` (STAYS in apps/api)

The session service (`apps/api/src/services/interaction-session-service.ts`) is a
DERIVED aggregate over `frontend_log` (the transcript) + `wake_photo` (burst
frames). It stays in `apps/api` this unit and lands with the wakes fold. It reads
the `frontendLog` table via the core drizzle query builder
(`db.select().from(frontendLog)...`), NOT `db.query.*`, so the table need not be in
`db`'s schema type param — only the table OBJECT is needed.

**Repoint ONE import line** (`interaction-session-service.ts:19`):

```ts
// before
import { frontendLog, wakePhoto } from "../db/schema";
// after
import { wakePhoto } from "../db/schema";
import { frontendLog } from "@features/felogs/schema";
```

- This is felogs EXPORTING its table (its `schema.ts` IS the public surface codegen
  already collects) and the session service reading it via `@features` — the
  sanctioned `apps/api → @features` direction (biome-legal). It does NOT reach into
  felogs internals; it does NOT keep a duplicate `frontendLog` def in apps/api (we
  delete that). The session-domain query logic (JSONB `interactionSessionId`,
  `wakePhoto` join) correctly stays in the reader, not felogs.
- `wakePhoto` stays imported from `apps/api/src/db/schema` (wakes not folded yet).
- The `db` passed in (from `apps/api/src/db/index`, typed with apps/api's schema)
  keeps working: `.from(frontendLog)` builds SQL from the imported table object
  against the same physical DB. No type param change needed.
- `interaction-session-service.test.ts` + `routers/sessions.ts` are UNCHANGED (they
  import the service functions, not the table). Run the session test to confirm
  green after the repoint.

This resolves master-plan PLACEHOLDER #2 for the felogs half: sessions does not
move now; felogs owns `frontend_log` and exports it; no read is split. When the
wakes fold lands, `wakePhoto` moves to `features/wakes/schema` and the session
service's other import repoints the same way (or the whole service moves into
wakes) — out of scope here.

---

## Deletions (all in the ONE atomic commit)

1. `apps/web/src/lib/tile-registry.ts` — delete the `tile_felogs` `REGISTRY_ENTRIES`
   object (lines 163-172) and the now-unused direct component imports
   (`FrontendLogsTile`, `FrontendLogsTileView`); add
   `import felogsManifest from "@features/felogs/manifest"` and push it into
   `FEATURE_MANIFESTS`. (Match how weather/tesla are wired in the same file.)
2. `apps/api/src/trpc/routers/index.ts` — delete `import { logsRouter } from "./logs"`
   (line 9) and the `logs: logsRouter` mount (line 26). Feature supplies `logs` via
   `featureAppRouter`.
3. `apps/api/src/trpc/routers/logs.ts` — delete (→ feature `api.ts`).
4. `apps/api/src/services/frontend-log-service.ts` — delete (→ `service.ts`).
5. `apps/api/src/services/frontend-log-purge-service.ts` — delete (→ `jobs.ts`).
6. `apps/api/src/db/schema.ts` — delete the `frontendLog` table + its comment
   (lines ~184-222). Leave `wakePhoto`.
7. `apps/api/src/purge.ts` — remove the frontend-log purge from the bundle. **Match
   by CONTENT, not line number** (the cited lines are stale — a long header comment
   shifts them): delete the `import { purgeFrontendLogs } from
   "./services/frontend-log-purge-service"`, the `const frontendLogs = await
   purgeFrontendLogs(db)` call, the `frontendLogs: frontendLogs.logs` log field, and
   the `if (frontendLogs.truncated) {...}` warn block. The remaining bundle
   (`wakePhotos` + `github`) keeps running under "portal-data-purge".
8. `apps/api/src/__tests__/frontend-log-service.test.ts` — delete after relocating
   → `features/felogs/service.test.ts` (see §Tests).
9. `apps/api/src/__tests__/frontend-log-purge-service.test.ts` — delete after
   relocating → `features/felogs/jobs.test.ts`.
10. The 4 web files (`FrontendLogsTile.tsx`, `FrontendLogsTileView.tsx`,
    `FrontendLogsTileView.stories.tsx`, `detail/wiring/frontend-logs.tsx`) — delete
    originals under `apps/web/src/components/`.

**knip is zero-tolerance, whole tree** — every moved file's original MUST be deleted
(no re-export shims). After moving, `bun run knip`; chase any newly orphaned export
to zero.

---

## Tests to move / add

- `apps/api/src/__tests__/frontend-log-service.test.ts` → `features/felogs/service.test.ts`.
  Repoint the service imports (`../services/frontend-log-service` → `./service`) and
  the schema type import (`../db/schema` → `./schema`).
  - **HARD BOUNDARY REQUIREMENT (not optional):** the current file imports
    `appRouter` from `../trpc/routers/index` (line 18). Once this file lands at
    `features/felogs/service.test.ts`, ANY surviving import of `apps/api`'s
    `appRouter` is a Biome `noRestrictedImports` violation (`features/* → apps/api`)
    → `bun run lint` RED, not just a test smell. The `appRouter` import MUST be
    removed as part of the move.
  - The file has a **router wiring** describe (lines 179-183) asserting `logs.ingest`
    is registered on `appRouter`. Rework it to the weight/api.test.ts pattern: import
    the now-EXPORTED `logsRouter` from `./api`, build a local
    `router({ logs: logsRouter })`, and assert the `logs.ingest` key. This is the
    chosen approach (matches `features/weight/api.test.ts:21`, no cross-app import).
    Do NOT assert against `@features/_generated/router` — the local-router assertion
    is the decision.
  - **PLACEHOLDER-FELOGS-1 → RESOLVED: DROP.** The same file has a
    `describe("layout router removal")` block (lines 185-189) asserting `appRouter`
    exposes no `layout*` procedure. DELETE this block entirely. It is a stale guard
    for a router removed long ago, is NOT felogs-specific, and could only be kept by
    importing `apps/api`'s `appRouter` — forbidden inside a feature. Do NOT drag it
    into the feature; do NOT relocate it as part of this unit.
- `apps/api/src/__tests__/frontend-log-purge-service.test.ts` → `features/felogs/jobs.test.ts`.
  Repoint the purge imports (`../services/frontend-log-purge-service` → `./jobs`).
  It tests `frontendLogCutoff` / `logShouldPurge` / `purgeFrontendLogs`, all now
  exported from `jobs.ts`.
- No web-side tests exist for this tile (verified) — nothing to move there.
- The `apps/web` **placeholder-tiles / bento** test MUST pass with `tile_felogs`
  now sourced from the manifest. It is 4×2 (not 1×1), so the 1×1-clearance risk
  (memory `bento-tiler-1x1-clearance`) does not apply; the registry-entry deletion +
  manifest addition net to the SAME rect at the SAME coords → board layout
  byte-identical. Run it explicitly as the core regression guard.
- `registry-entries.test.ts` (detail completeness) MUST stay green — `tile_felogs`
  still has a registered detail entry via the repointed
  `@features/felogs/detail-wiring` import.

---

## Verify chain (implementer runs ALL, in order — real output, fix-forward on red)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck                      # all programs
bunx vitest run \
  features/felogs \                    # service + jobs tests
  apps/api/src/services/interaction-session-service.test.ts \  # cross-feature reader still green
  apps/web/src/lib/__tests__/placeholder-tiles* \              # bento gap-free (glob the real path)
  apps/web/src/components/tiles/detail                          # registry-entries + tile-title-sync
bun run apps:check                     # codegen drift + validator (dup id/router-key/table, =1 home, no overlap, guestExposed⇔allowlist)
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome dep-boundary: no features/* → apps/api
bunx vitest run infra/test/crons.test.ts infra/test/cronjob.test.ts  # felogs-purge CronJob now in the generated set
git pull --rebase --autostash          # SHARED tree; peer dirt present
git add <explicit paths>               # NEVER git add -A / -A
git show --stat HEAD                    # (after commit) confirm ONLY felogs-fold paths, with insertions — not empty/partial
git commit -m "..."                     # message below; NO backticks
git push                                # if lint:tracked hook blocks on UNRELATED peer dirt and your OWN diff is clean → git push --no-verify (sanctioned)
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor
# then confirm deploy green + pod image age (memory ci-cancelled-runs-strand-image-digests)
```

Confirm after `apps:check`:
- `features/_generated/tiles.gen.ts` has `tile_felogs`, `appId: "tile_felogs"`,
  `source: "feature"`, EXACTLY once, coords 26/30/4×2.
- `features/_generated/router.gen.ts` imports `api as felogsApi` and includes it in
  `mergeRouters(...)` — the merged router still exposes key `logs`.
- `features/_generated/schema.gen.ts` includes `export * from "../felogs/schema"`
  and NO LONGER double-defines `frontend_log` (the base `apps/api/db/schema` export
  no longer carries it).
- `features/_generated/crons.gen.ts` + `cron-handlers.gen.ts` include `felogs-purge`.
- Biome dep-boundary: no surviving `features/felogs/* → apps/api/*` import; the ONLY
  new `apps/api → @features` import is `interaction-session-service.ts`'s
  `@features/felogs/schema` (legal direction).

---

## Gotchas (inherit — honor ALL)

- `features/* → apps/api/*` is Biome-banned. Every moved backend file repoints to
  `@www/core`, `@app-kit`/`@app-kit/server`, `@www/logger`, or feature-local `./`.
  Moved web files repoint to `@/` (shared) or same-file (inlined). A single
  surviving `apps/api` import in the feature turns lint red.
- `apps/api → @features/*` and `apps/web → @features/*` are ALLOWED. The session
  service's `@features/felogs/schema` import is intentional and legal.
- `bun build` reads the **CWD** tsconfig paths (memory
  `bun-build-alias-needs-cwd-tsconfig`). This fold removes felogs FROM apps/api; the
  residual risk is the api image build resolving `@features/felogs/schema` (from
  `interaction-session-service`) — the api image build must go green (verify in CI).
  Local typecheck can pass while a CWD-tsconfig build fails; watch CI.
- **ONE atomic commit.** Codegen collects a feature only once `manifest.ts` exists,
  and base router/schema deletions must be simultaneous or `apps:check` throws
  (dup-router-key `logs` / dup-table `frontend_log`). Do NOT split.
- Parallel sessions push `main`: `git pull --rebase --autostash`; **never**
  `git add -A` (memory `never-git-add-all-shared-checkout`). lefthook format
  re-stages the whole tree (memory `lefthook-format-restages-whole-tree`) — stage
  explicit paths, `git show --stat HEAD` before push, the tree may carry peer dirt.
  `git add` can silently abort on an already-`git rm`'d pathspec — after staging,
  verify `git show --stat HEAD` lists your FULL fileset with insertions, not an
  empty/partial commit.
- If the pre-push `lint:tracked` hook blocks on UNRELATED peer dirt and your own
  diff is independently clean (typecheck/knip/lint green on your files +
  `git show --stat` = only your files), push with `git push --no-verify`
  (sanctioned escape).
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- Do NOT run `drizzle db:generate` (no DDL change). If run, `bunx biome format
  --write` the meta dir and confirm no migration was emitted.
- Subagent stalls: run `gh run watch --exit-status` in the FOREGROUND (memory
  `subagent-background-wait-stalls`).

---

## Commit message (no backticks)

```
feat(features): fold felogs tile into features/felogs (Track C)

Single-tile fold. The Frontend Logs tile now lives in one features/felogs App
declaring it via the tiles[] manifest (coords verbatim), owning the logs router
(logs.ingest, key preserved for the frontend shipper), the frontend_log table,
the ingest service, and the 30-day retention purge migrated onto the S2 cron
seam (felogs-purge, daily 04:00). The frontend_log table is exported from
features/felogs/schema; interaction-session-service (staying in apps/api until
the wakes fold) reads it via @features/felogs/schema instead of a duplicate
apps/api table def. Registry entry, base logs router/mount, frontend-log
service + purge service, the purge.ts frontend-log pass, and the 4-file web
closure (tile, view, story, detail wiring) removed from apps/api + apps/web. No
coord or DDL change; board layout and logs.ingest client path byte-identical.
```

---

## Resolved decisions (no open blockers)

1. **No `collect.ts` change** — single-tile, app id == tile id.
2. **Router key `logs`** (not `felogs`) — preserves the `logs.ingest` client path.
3. **Cross-feature reader** — `interaction-session-service` stays in apps/api and
   repoints `frontendLog` to `@features/felogs/schema` (legal `apps/api → @features`).
   No read split; resolves master-plan PLACEHOLDER #2 for the felogs half.
4. **Purge** — S2 `defineCron` now (`felogs-purge`, `0 4 * * *`); removed from
   `purge.ts`; infra crons/cronjob tests asserted green.
5. **Web** — inline Tile + View into `web.tsx` (tesla/network single-tile shape);
   move the story + the detail wiring into the feature; repoint `detail/registry.ts`.
6. **jobs.ts** — `defineCron`-only, NO `defineJobs` (no queue job, no worker
   interval for felogs).

## Resolved at plan-review (no open placeholders)

- **PLACEHOLDER-FELOGS-1 → RESOLVED: DROP.** The moved service test's stale
  `describe("layout router removal")` block is DELETED (see §Tests). Not
  felogs-specific; could only be kept by importing `apps/api`'s `appRouter` —
  forbidden inside a feature. No relocation.
- **Test `appRouter` import → HARD BOUNDARY:** removing the `appRouter` import from
  the moved `service.test.ts` is mandatory (a surviving `features/* → apps/api`
  import turns `bun run lint` red), not a test-quality choice. See §Tests.
- **`api.ts` `logsRouter` → EXPORTED:** `export const logsRouter` (mirrors weight) so
  the reworked wiring test imports it from `./api` and asserts a local router — no
  cross-app import. Snippet and test instruction now consistent.
- **`purge.ts` deletions → match by content**, not the stale cited line numbers.
