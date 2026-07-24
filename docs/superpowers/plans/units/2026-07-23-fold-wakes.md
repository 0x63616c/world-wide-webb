# Unit F-wakes — Fold the Activity (wakes) tile into `features/wakes`

Track C, Wave 5 unit (executed AFTER felogs in this session's ordering). A
**single-tile** fold that also lands the shared **interaction-session service**
and moves the interim S3 wake-photo **upload** route into the feature.

Fold `tile_wakes` ("Activity") into one `features/wakes/` App that owns:

- the `wakePhoto` table (`wake_photo`),
- the `wakePhotos` + `sessions` tRPC routers,
- the wake-photo service (save / list / read / delete / backfill / default-root),
- the **interaction-session service** (derives sessions from `frontend_log` +
  `wake_photo` — sessions are DERIVED, there is deliberately **no** session
  table),
- the wake-photo **purge** cron (S2 seam),
- the wake-photo **upload** http facet (`POST /media/wake-photo`, moved out of the
  interim `apps/api/src/http/wake.http.ts`),
- and the Activity tile's full web closure (tile face + the PIN-gated Activity
  detail page with the photo gallery and the interaction-session list/detail
  views).

Reference folds to mirror: `features/weather/` (the JUST-LANDED template, commit
`4be52f800`, plan `docs/superpowers/plans/units/2026-07-23-fold-weather.md`);
`features/network/` + `features/guest-wifi/` for single-tile shape; the
`features/weather/{config,db}.ts` pattern for the feature's own Postgres handle;
`features/guest-wifi/jobs.ts` for the `defineCron` purge on the S2 seam. Pattern
doc: `docs/writing-scalable-typescript/README.md`.

**ONE atomic commit.** Codegen only collects a facet once `manifest.ts` exists,
and the base router-key / table / http-route deletions must be simultaneous with
the feature's arrival or `apps:check` throws (dup router-key / dup table / dup
route). Do NOT split "add feature" then "delete base".

---

## Hard dependency: felogs is ALREADY folded (prior unit)

The interaction-session service reads the `frontend_log` table. After F-felogs
(the prior unit in this session), that table lives in `features/felogs/schema.ts`,
NOT in `apps/api/src/db/schema.ts`. The wakes service therefore reads it via a
**cross-feature `@features` import**, which the Biome boundary explicitly allows:
the `features/**` `noRestrictedImports` rule (`biome.json:164-183`) bans only
`@control-center/api` / `apps/api/**`; it does **not** restrict `@features/**`.
Cross-feature imports are sanctioned (master plan: "Clock keeps a read-only dep on
the events feature… cross-feature import is fine").

Both features point their own lazy `createPool` at the SAME `DATABASE_URL` (same
physical Postgres), so the wakes db pool querying `frontend_log` is correct —
`db.select().from(frontendLog)` accepts any `pgTable` object regardless of the
db handle's `schema` generic (the generic only types the `db.query.*` relational
API, which this service does not use).

> **START GATE — felogs must land first (BLOCKER, confirmed unmet at review):**
> As of review HEAD `63cd93e1f`, `features/felogs/` does NOT exist and
> `frontendLog` (`frontend_log`) still lives at `apps/api/src/db/schema.ts:192`.
> This fold CANNOT compile until F-felogs is merged to `main` and exports
> `frontendLog` from `@features/felogs/schema`. This is a sequencing gate, not a
> plan defect — the cross-feature read (`import { frontendLog } from
> "@features/felogs/schema"`) has no module to resolve against otherwise.
> **Do NOT begin implementation until, at implement time:**
> `grep -rn "frontendLog\|frontend_log" features/felogs/schema.ts` returns the
> export. If it does not, STOP and report to the manager. If F-felogs renamed the
> export or module path, use whatever felogs actually exports.

---

## The tile (verbatim, from `apps/web/src/lib/tile-registry.ts:150-159`)

| field         | value        |
| ------------- | ------------ |
| `id`          | `tile_wakes` |
| `label`       | `Activity`   |
| `worldCol`    | `34`         |
| `worldRow`    | `30`         |
| `cols`        | `2`          |
| `rows`        | `2`          |
| `guestExposed`| **not set**  |
| `home`        | **not set**  |

- **NOT home.** Home is the Clock (`tile-registry.ts:78`). A stray `home` makes
  two → `validate.ts` throws. Do NOT set it.
- **NOT guest-exposed.** The Activity page is PIN-gated / `sensitive` (see
  `detail/wiring/activity.tsx`). `GUEST_EXPOSED` (`features/guest-exposed.ts`) is
  `["tile_guestwifi"]` only. Do NOT set `guestExposed`; do NOT touch the
  allowlist. `validate.ts` cross-checks flag⇔allowlist; both absent is consistent.
- **Label MUST match the rendered `TileHeader` title** — `WakesTileView` renders
  `<TileHeader icon="moon" title="Activity" />`. `"Activity"` matches; the
  `tile-title-sync` guard stays green.
- **Coords VERBATIM.** `tile_wakes` is a 2×2 at col 34 / row 30. Deleting the
  registry entry and re-adding the identical rect via the manifest nets to the
  SAME rect at the SAME coords → board layout byte-identical. (Memory
  `bento-tiler-1x1-clearance` is about 1×1 tiles; this is 2×2, lower risk, but
  run the placeholder-tiles / bento test regardless.)

---

## Target layout: `features/wakes/`

```
features/wakes/
  manifest.ts        # defineApp, id "tile_wakes", single tile (VERBATIM coords)
  api.ts             # defineApi(router({ wakePhotos, sessions }))
  service.ts         # interaction-session service (was interaction-session-service.ts)
  photos.ts          # wake-photo service (was wake-photo-service.ts)
  jobs.ts            # defineCron "wake-photo-purge" only (from wake-photo-purge-service.ts) — S2 seam
  http.ts            # POST /media/wake-photo (was apps/api/src/http/wake.http.ts)
  schema.ts          # wakePhoto pgTable (from apps/api db/schema.ts:239-265)
  config.ts          # z.object({ DATABASE_URL, MEDIA_STORAGE_DIR }).parse(process.env)
  db.ts              # drizzle(createPool(config.DATABASE_URL), { schema })
  web.tsx            # barrel: re-export WakesTile + WakesTileView from ./web
  web/               # the 18-file Activity web closure (see §Web move)
  *.test.ts(x)       # moved + repointed tests
```

### Service-file split (DECIDED — mirror the source split for 1:1 test repoint)

- `interaction-session-service.ts` → **`service.ts`** (the hint's mapping; the
  session-derivation service, reads `frontendLog` + `wakePhoto`).
- `wake-photo-service.ts` → **`photos.ts`** (save / list / read / delete /
  backfill / `defaultWakePhotoRoot`).
- `wake-photo-purge-service.ts` → **`jobs.ts`** as a `defineCron`.

Do NOT collapse `service.ts` + `photos.ts`. Keeping the split makes each test a
mechanical repoint (`interaction-session-service.test.ts → service.test.ts`,
`wake-photo-service.test.ts → photos.test.ts`).

### `manifest.ts`

```ts
import { defineApp } from "@app-kit";
import { WakesTile, WakesTileView } from "./web";

export default defineApp({
  id: "tile_wakes",
  tiles: [
    {
      id: "tile_wakes",
      label: "Activity",
      component: WakesTile,
      viewComponent: WakesTileView,
      worldCol: 34,
      worldRow: 30,
      cols: 2,
      rows: 2,
    },
  ],
});
```

App `id === tile id === "tile_wakes"` (single-tile — the common case; the
collect.ts multi-tile dedup fixed by weather is irrelevant here but harmless).
Confirmed unique: only the deleted registry entry used `tile_wakes`.

> NOTE (RESOLVED by review): both landed single-tile features
> (`features/network/manifest.ts`, `features/guest-wifi/manifest.ts`) use
> `tiles: [ … ]`, NOT a singular `tile:`. Use `tiles: [ … ]` as shown above. If in
> doubt at implement time, copy their exact manifest shape; coords/label/ids above
> are authoritative regardless.

### `web.tsx` — barrel

```ts
// features/wakes/web.tsx
export { WakesTile } from "./web/WakesTile";
export { WakesTileView } from "./web/WakesTileView";
```

### `api.ts` — TWO router keys off one feature api

Move `routers/wake-photos.ts` + `routers/sessions.ts` verbatim; swap the tRPC
runtime import from `../init` to `@app-kit/server`; repoint the service imports;
brand with `defineApi`:

```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { db } from "./db";
import { getInteractionSession, listInteractionSessions } from "./service";
import { listWakePhotos } from "./photos";

const wakePhotosRouter = router({ /* list — verbatim */ });
const sessionsRouter = router({ /* list / get — verbatim, with Summary/Detail zod schemas */ });

export const api = defineApi(router({ wakePhotos: wakePhotosRouter, sessions: sessionsRouter }));
```

- Both routers currently import `db` from `../../db/index` — repoint to `./db`.
- `collect.ts:253` reads keys off `api._def.record` → BOTH `wakePhotos` and
  `sessions` merge into `featureAppRouter`. `validate.ts` rejects a dup router key
  → the base mounts of BOTH keys MUST be deleted in the same commit (§Deletions).

### `service.ts` (interaction-session service — the felogs cross-read)

Move `apps/api/src/services/interaction-session-service.ts` verbatim, then:

- `import { frontendLog, wakePhoto } from "../db/schema"` →
  `import { wakePhoto } from "./schema";` **plus**
  `import { frontendLog } from "@features/felogs/schema";` (see the START GATE
  under §Hard dependency — verify felogs' actual export at implement time).
- `import type * as schema from "../db/schema"` → `import type * as schema from "./schema";`
  (the `NodePgDatabase<typeof schema>` generic is only for `db.query.*`, unused
  here; typing against the wakes schema is fine even though the queries also touch
  `frontendLog`).
- No `@www/*` runtime imports here beyond drizzle — unchanged.

### `photos.ts` (wake-photo service)

Move `apps/api/src/services/wake-photo-service.ts` verbatim, then:

- `import { wakePhoto } from "../db/schema"` → `./schema`.
- `import type * as schema from "../db/schema"` → `./schema`.
- `import { env } from "../env"` → **delete**; read
  `config.MEDIA_STORAGE_DIR` from `./config` (`defaultWakePhotoRoot()` uses
  `join(env.MEDIA_STORAGE_DIR, "wake-photos")` → `join(config.MEDIA_STORAGE_DIR, "wake-photos")`).
  Apps/api default is `/mnt/media` (`env.ts:59`) — mirror it in `config.ts`.
- `@www/core` (`nextFreeName`, `parsePhotoFileName`) + `@www/logger` — unchanged.

### `http.ts` (the collected wake-photo upload route)

Move `apps/api/src/http/wake.http.ts` verbatim, then:

- `import { db } from "../db/index"` → `./db`.
- `import { saveWakePhoto } from "../services/wake-photo-service"` → `./photos`.
- `defineHttp` from `@app-kit` — unchanged.

`collect.ts:282-293` (Source A) scans `features/<dir>/http.ts` for an
`HTTP_FACET_BRAND` array and emits it into `http.gen.ts` with ident `wakesHttp`
and importPath `../wakes/http`. **This replaces the interim collection** — delete
the interim entry (§Deletions #7).

### `jobs.ts` — `defineCron` on the S2 seam

Move `apps/api/src/services/wake-photo-purge-service.ts` logic
(`purgeWakePhotos`, `WAKE_PHOTO_RETENTION_MS = 90d`, `wakePhotoCutoff`, batch
helpers) into `features/wakes/jobs.ts`:

```ts
import { defineCron } from "@app-kit";
import { db } from "./db";
// …purge logic (moved verbatim), typed against NodePgDatabase<typeof schema>…
// imports wakePhoto from "./schema"; defaultWakePhotoRoot + deleteWakePhotoFile from "./photos"

export const purgeCron = defineCron({
  name: "wake-photo-purge",
  schedule: "0 4 * * *",   // daily 04:00 UTC — staggered off guest-wifi (0 2) + weather (0 3)
  run: async () => { await purgeWakePhotos(db); },
});
```

- **GUARD: export ONLY `purgeCron = defineCron(...)`. NEVER a `defineJobs([...])`
  facet.** `collect.ts:257-280` reads both brands off `jobs.ts`; a stray empty
  `defineJobs` sets `hasJobs` wrongly. There is no queue job here.
- `generatedCronSpecs()` (`infra/src/crons.ts`) auto-emits a `wake-photo-purge`
  k8s CronJob — no infra hand-edit. Confirm `infra/test/crons.test.ts` +
  `infra/test/cronjob.test.ts` stay green (they assert over the generated set,
  now including `wake-photo-purge`).

### `config.ts` + `db.ts`

Copy `features/weather/{config,db}.ts` verbatim shape.

```ts
// config.ts
export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    MEDIA_STORAGE_DIR: z.string().default("/mnt/media"),
  })
  .parse(process.env);

// db.ts
const pool = createPool(config.DATABASE_URL);   // createPool from @www/core
export const db = drizzle(pool, { schema });    // schema = import * as schema from "./schema"
```

`db.ts`'s `schema` is wakes-only (`wakePhoto`). The service imports `frontendLog`
separately from `@features/felogs/schema`; it does NOT need to appear in this
handle's generic (see §Hard dependency).

### `schema.ts`

Move `wakePhoto` (`apps/api/src/db/schema.ts:239-265`) verbatim — same SQL table
name (`wake_photo`), same columns/indexes (`wake_photo_session_idx`,
`wake_photo_captured_at_idx`). A rename would be a migration; do not rename.
Delete from `apps/api/src/db/schema.ts`. There is **no** `interaction_session`
table (sessions are derived — verified by the schema comment at
`apps/api/src/db/schema.ts:234`), so `schema.ts` owns exactly `wakePhoto`.

- `wake_photo` has NO FK (soft reference to sessions by design, see the
  `:234-238` comment). Grep `wakePhoto` across `apps/api/src/db/` before deleting
  to confirm no relation references it. `boothPhoto` (`:282`) is modelled on it
  but is independent — it stays in apps/api (booth not folded).
- `drizzle db:generate` NOT needed (no DDL change; table moves packages, identical
  SQL). If the drizzle snapshot picks up the relocation, `bunx biome format --write`
  the meta dir before lint (memory `drizzle-generate-needs-biome-format`). Verify
  no unintended migration is emitted.

---

## Web move — the 18-file Activity closure (FULL move, no shims)

Move the entire Activity tile closure into `features/wakes/web/` and DELETE the
originals (knip is zero-tolerance — no re-export shims). Verified closure (grep
at HEAD): no non-Activity tile imports any of these.

**Group A — `apps/web/src/components/tiles/` (10):**
`WakesTile.tsx`, `WakesTileView.tsx`, `WakesTileView.stories.tsx`,
`WakeCaptureDiagnostic.tsx`, `ActivityPage.tsx`, `ActivityPage.stories.tsx`,
`SessionListView.tsx`, `SessionListView.stories.tsx`, `SessionDetailView.tsx`,
`SessionDetailView.stories.tsx`.

**Group B — `apps/web/src/components/tiles/__tests__/` (2):**
`WakesTileView.stories.test.tsx`, `ActivityPage.stories.test.tsx`.

**Group C — `apps/web/src/components/__tests__/` (1):**
`SessionListView.stories.test.tsx` (imports both SessionListView + SessionDetailView
stories).

**Group D — `apps/web/src/components/tiles/detail/wiring/` (1):**
`activity.tsx` (exports `activityDetailEntry`) → `features/wakes/web/wiring/activity.tsx`.

**Group E — `apps/web/src/lib/` (4):**
`wake-log-summary.ts` (+ `lib/__tests__/wake-log-summary.test.ts`),
`session-format.ts` (+ `lib/__tests__/session-format.test.ts`).
`wake-log-summary` is consumed ONLY by `WakeCaptureDiagnostic` (moving);
`session-format` ONLY by `SessionDetailView` (moving) — both are tile-owned.

**= 18 files.**

Suggested internal shape under `features/wakes/web/`: tile + page components at
`web/`, the detail wiring at `web/wiring/activity.tsx`, the two moved libs at
`web/lib/` (or `web/`), tests beside their subjects (or a `web/__tests__/`).

### DO NOT MOVE — capture-side infra that STAYS in `apps/web` (scope guard)

`apps/web/src/lib/wake-capture.ts` (+ `lib/__tests__/wake-capture.test.ts`) is
**capture-side panel infra**, NOT the Activity tile. It is consumed by
`components/Board.tsx` (panel wake), `components/settings-page/pages/DevicePage.tsx`
(camera test), `components/tiles/photo-booth/useCameraPreview.ts`,
`lib/booth-capture.ts`, and `components/__tests__/Board.session.test.tsx`. None of
the 18 moved files import it (the tile face reads via `trpc.wakePhotos`; the
diagnostic reads via `wake-log-summary`). **Leave `wake-capture.ts` where it is.**
Its eventual home (panel-session infra vs `packages/platform`) is a separate
concern, out of scope for this tile fold. Moving it would drag Board / booth /
settings into the closure — do NOT.

### Import-repoint rules (moved files use `@/` absolute imports internally)

- **`@/` import pointing at a MOVED file** → repoint to a feature-local relative
  path. Concretely:
  - `ActivityPage.tsx`: `./SessionDetailView`, `./SessionListView`,
    `./WakeCaptureDiagnostic` → stay relative (all moved into `web/`).
  - `WakeCaptureDiagnostic.tsx`: `@/lib/wake-log-summary` → feature-local
    (`./lib/wake-log-summary` or `../lib/...` per chosen structure).
  - `SessionDetailView.tsx`: `../../lib/session-format` → feature-local
    session-format; `./SessionListView` → relative.
  - `detail/wiring/activity.tsx`: `@/components/tiles/ActivityPage` → relative to
    the moved `ActivityPage`; `../types` (detail types, STAYS in apps/web) →
    `@/components/tiles/detail/types`.
- **`@/` import pointing at a file that STAYS** → keep `@/` unchanged. These
  include: `@/components/ui`, `@/components/gallery/group-by-day`,
  `@/components/gallery/PhotoGrid`, `@/lib/hooks` (`POLL.wakePhotos`),
  `@/lib/trpc`, `@/lib/useTileQuery`, `@/lib/tile-detail-store`
  (`closeTileDetail`), `@/lib/log/useLogTail`, `@/lib/log/types`,
  `@/components/tiles/detail/types` (`DetailVariant`, `TileDetailPageEntry`).
  `features/tsconfig.json` maps `@/*` → `../apps/web/src/*`, so moved web files
  keep importing shared UI via `@/`.

### External consumers that STAY in apps/web and repoint TO the feature

1. **`apps/web/src/lib/tile-registry.ts`** — delete the `tile_wakes`
   `REGISTRY_ENTRIES` entry (`:150-159`) and the two now-unused component imports
   `WakesTile` (`:31`) + `WakesTileView` (`:32`); add
   `import wakesManifest from "@features/wakes/manifest"` and push it into
   `FEATURE_MANIFESTS` (mirror how `networkManifest` / `weatherManifest` are
   added).
2. **`apps/web/src/components/tiles/detail/registry.ts`** — repoint the
   `activityDetailEntry` import from `./wiring/activity` (`:15`) to
   `@features/wakes/web/wiring/activity`. The `activityDetailEntry` in the
   `ENTRIES` array (`:47`) is unchanged. Keeps `registry-entries.test.ts` (detail
   completeness) + the `tile_wakes` detail entry green.
3. **`apps/web/.storybook/main.ts`** — its glob already includes
   `"../../../features/**/*.stories.@(ts|tsx)"` (weather added it, verified
   `:15`). **No edit needed.**

No other apps/web file imports any of the 18 moved files (verified by grep).

---

## Backend consumers outside the feature (repoint via `@features`, allowed)

`apps/api → @features` and `apps/worker → @features` are permitted (server.ts
already imports `@features/dogcam/service`; worker-deps imports
`@features/deploys/service`). The `features/* → apps/api` ban is one-directional.

1. **`apps/api/src/server.ts`**
   - `:13` `import { backfillWakePhotoIndex, readWakePhoto } from "./services/wake-photo-service"`
     → `@features/wakes/photos`.
   - `:73` `backfillWakePhotoIndex(db)` boot call — unchanged (still runs at api
     boot; `db` is apps/api's db, same physical Postgres).
   - `:165-167` the `GET /media/wake-photos/*` serve branch calls `readWakePhoto`
     — the import repoints to `@features/wakes/photos`; the branch itself STAYS in
     the server ladder (DEFER decision — GET serve route stays in apps/api this
     unit; see §Resolved decisions).
2. **`apps/api/src/startup/photo-path-migration.ts`** (the wake⇔booth WELD)
   - `import { defaultWakePhotoRoot } from "../services/wake-photo-service"` →
     `@features/wakes/photos`.
   - `import { boothPhoto, wakePhoto } from "../db/schema"` → split:
     `import { boothPhoto } from "../db/schema";` +
     `import { wakePhoto } from "@features/wakes/schema";`.
   - `defaultBoothPhotoRoot` from `../services/booth-photo-service` — unchanged
     (booth not folded).
   - Its `db` is apps/api's handle typed to apps/api's schema (now minus
     `wakePhoto`); `db.update(wakePhoto)…` / `db.select().from(wakePhoto)` still
     typecheck (drizzle query builders accept any `pgTable`; the generic only
     types `db.query.*`). This module STAYS in `apps/api/src/startup/` — it welds
     wake + booth and the master plan defers the un-weld to a `packages/platform`
     move (P1.6), out of scope here. Flag it, do not move it.
   - **Its test too (MAJOR — do NOT miss):**
     `apps/api/src/startup/photo-path-migration.test.ts:5` does
     `import { wakePhoto } from "../db/schema"` and uses it as a table-identity
     token (`t === wakePhoto` at `:31`, `:47`). When `wakePhoto` leaves apps/api's
     schema this import loses its export → typecheck + this test go red. Repoint:
     `import { wakePhoto } from "@features/wakes/schema"` at
     `photo-path-migration.test.ts:5` (only the table-identity import moves; its
     `db` stays apps/api's handle). This test STAYS in apps/api.
3. **`apps/api/src/purge.ts`** — remove the wake pass: delete the
   `purgeWakePhotos` import (`:28`), the `const wakePhotos = await purgeWakePhotos(db)`
   call (`:34`), the `wakePhotos: wakePhotos.photos` log field (`:39`), and the
   `if (wakePhotos.truncated)` warn block (`:48-50`). The remaining bundle
   (frontend-log / github, whichever survive their own folds) keeps running under
   "portal-data-purge". Wake purge now runs as its own `wake-photo-purge` CronJob
   (S2). Update the file's header comment that enumerates the purges.
4. **`apps/api/src/trpc/routers/index.ts`** — delete
   `import { sessionsRouter } from "./sessions"` (`:11`),
   `import { wakePhotosRouter } from "./wake-photos"` (`:14`), and the two mounts
   `sessions: sessionsRouter` (`:31`) + `wakePhotos: wakePhotosRouter` (`:32`).
   Both keys now arrive via `featureAppRouter`.

No worker interval cycle or enforcer is involved (wake capture is a browser-side
best-effort burst, not a worker job). Nothing is left hand-wired in
`apps/worker`. The only cross-feature runtime dependency is
**wakes/service.ts → `@features/felogs/schema` (`frontendLog` table read)**.

---

## Codegen-test repoints (the interim→feature http migration)

Moving `wake.http.ts` from the interim list into the feature changes THREE
codegen tests. All must be updated in the same commit or `bunx vitest run
scripts/apps-gen` is red:

1. **`scripts/apps-gen/collect.ts:150-154`** — delete the `wake` entry from
   `INTERIM_HTTP_MODULES` (keep the `booth` entry — booth not folded).
2. **`scripts/apps-gen/collect.test.ts:41-63`** — the
   "collect() yields the migrated wake + booth routes from the interim http list"
   test asserts the wake route has `source: "interim:wake"` and ident `wakeHttp`.
   After the move the wake route is `source: "feature:wakes"` via Source A.
   Update: drop the interim `/media/wake-photo` assertion + the `wakeHttp` ident
   expectation; keep booth. Mirror the weather collect-test pattern — add an
   assertion that the wake route + `wakesHttp` module now collect from the feature
   (`model.httpModules.map((m) => m.ident)` contains `"wakesHttp"`;
   `model.httpRoutes` contains `{ method: "POST", path: "/media/wake-photo",
   match: "exact", source: "feature:wakes" }` — confirm the exact `source` string
   collect.ts stamps for Source A).
3. **`scripts/apps-gen/emit.test.ts`** — TWO `wakeHttp` occurrences, update BOTH
   or the emit test stays red:
   - `:25` the import-barrel string
     `import { routes as wakeHttp } from "../../apps/api/src/http/wake.http"` →
     `import { routes as wakesHttp } from "../wakes/http"` (ident `wakesHttp`, path
     `../wakes/http`).
   - `:28` the spread-line assertion `expect(a).toContain("...wakeHttp")` →
     `"...wakesHttp"`.
4. **`apps/api/src/http/__tests__/route-table.test.ts`** — this dispatch test
   `vi.mock("../../services/wake-photo-service", …)` (`:28`). After the service
   moves, the wake handler imports `@features/wakes/photos`; repoint the `vi.mock`
   target to `@features/wakes/photos` (mock `saveWakePhoto`). The
   `GENERATED_ROUTES` real-dispatch assertions for `POST /media/wake-photo`
   (`:93-133`) still hold (route now sourced from the feature). Verify the mock
   path resolves; if awkward, the equivalent dispatch is also proven by the
   feature's own `http` — but keep this test green.

---

## Deletions (all in the ONE atomic commit)

1. `apps/web/src/lib/tile-registry.ts` — `tile_wakes` entry + the two component
   imports; add `wakesManifest` → `FEATURE_MANIFESTS`.
2. `apps/api/src/trpc/routers/index.ts` — sessions + wakePhotos imports + mounts.
3. `apps/api/src/trpc/routers/sessions.ts` — delete (→ feature `api.ts`).
4. `apps/api/src/trpc/routers/wake-photos.ts` — delete (→ feature `api.ts`).
5. `apps/api/src/services/interaction-session-service.ts` — delete (→ `service.ts`).
6. `apps/api/src/services/wake-photo-service.ts` — delete (→ `photos.ts`).
7. `apps/api/src/services/wake-photo-purge-service.ts` — delete (→ `jobs.ts`).
8. `apps/api/src/http/wake.http.ts` — delete (→ feature `http.ts`); + the `wake`
   entry in `INTERIM_HTTP_MODULES`.
9. `apps/api/src/db/schema.ts` — delete the `wakePhoto` table.
10. The moved backend tests' originals:
    `apps/api/src/services/interaction-session-service.test.ts`,
    `apps/api/src/services/wake-photo-service.test.ts`,
    `apps/api/src/services/wake-photo-purge-service.test.ts`.
11. The 18 web files (Groups A-E) — delete originals under `apps/web/src/`.

**Repoints that STAY in apps/api (not deletions — table-identity import moves):**

- `apps/api/src/startup/photo-path-migration.test.ts:5` — repoint
  `import { wakePhoto } from "../db/schema"` → `@features/wakes/schema` (MAJOR-1).
- `apps/api/src/services/booth-photo-service.test.ts:23` — cosmetic: its comment
  "mirrors wake-photo-service.test.ts" points at a deleted file; repoint the
  comment to `features/wakes/photos.test.ts` (no import, non-breaking).

**knip is zero-tolerance, whole tree** — after moving, `bun run knip`; chase every
newly-orphaned export to zero (no shims). Watch for: `readWakePhoto` /
`backfillWakePhotoIndex` / `defaultWakePhotoRoot` / `deleteWakePhotoFile` still
having live consumers (server.ts / photo-path-migration / jobs.ts) — keep those
exports; drop any that lose their last consumer.

---

## Tests to move / add

Backend (repoint imports to `./service` / `./photos` / `./jobs` / feature-local):

- `apps/api/src/services/interaction-session-service.test.ts` →
  `features/wakes/service.test.ts` (`./interaction-session-service` → `./service`).
  Pure-function tests (`computeDigest`, `summarise`) carry over unchanged; any
  `getInteractionSession`/`listInteractionSessions` db-backed cases keep their db
  seam. If those cases seed `frontend_log`, they now need the `frontendLog` table
  from `@features/felogs/schema` — repoint accordingly.
- `apps/api/src/services/wake-photo-service.test.ts` → `features/wakes/photos.test.ts`
  (`./wake-photo-service` → `./photos`; it uses `mkdtemp` temp roots, no env dep
  once `defaultWakePhotoRoot` reads `config`).
- `apps/api/src/services/wake-photo-purge-service.test.ts` →
  `features/wakes/jobs.test.ts` (repoint to `./jobs` / `./photos` / `./schema`).

Web (Groups B, C, E — move alongside subjects, repoint relative imports):
`WakesTileView.stories.test.tsx`, `ActivityPage.stories.test.tsx`,
`SessionListView.stories.test.tsx`, `wake-log-summary.test.ts`,
`session-format.test.ts`.

Codegen tests: `collect.test.ts`, `emit.test.ts`, `route-table.test.ts` — updated
in place (§Codegen-test repoints).

Regression guards that MUST stay green (run explicitly):

- `apps/web` **placeholder-tiles / bento** — the `tile_wakes` 2×2 rect is
  byte-identical pre/post (registry-entry delete + manifest add net to the same
  rect at col 34 / row 30). Core regression guard.
- `registry-entries.test.ts` (detail completeness) — `activityDetailEntry` stays
  registered via the repointed `detail/registry.ts` import.
- `tile-title-sync` — `"Activity"` label ⇔ `TileHeader title="Activity"`.
- `infra/test/crons.test.ts` + `infra/test/cronjob.test.ts` — now include
  `wake-photo-purge`.

---

## Verify chain (IMPLEMENTER runs ALL, in order, with real output)

```
cd <repo root>
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck                      # all programs (cd apps/api if a bun build alias needs CWD tsconfig)
bunx vitest run \
  scripts/apps-gen \                   # collect/emit incl. the updated interim→feature http tests
  features/wakes \                     # moved backend + web tests
  apps/api/src/http/__tests__/route-table.test.ts \   # wake dispatch (repointed mock)
  apps/api/src/startup/photo-path-migration.test.ts \ # wakePhoto identity import repointed (MAJOR-1)
  apps/web/src/lib/__tests__/placeholder-tiles* \      # bento gap-free (glob actual path)
  apps/web/src/components/tiles/detail                 # registry-entries + tile-title-sync
bun run apps:check                     # codegen drift + validator (dup id/router-key/table, =1 home, no overlap incl intra-app, guestExposed⇔allowlist)
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome dep-boundary: NO features/wakes/* → apps/api import
bunx vitest run infra/test/crons.test.ts infra/test/cronjob.test.ts
```

Confirm after `apps:check`:

- `features/_generated/tiles.gen.ts` has `tile_wakes`, `appId: "tile_wakes"`,
  `source: "feature"`, exactly once, coords 34/30/2×2.
- `features/_generated/router.gen.ts` mounts BOTH `wakePhotos` and `sessions`.
- `features/_generated/schema.gen.ts` includes `wake_photo`.
- `features/_generated/http.gen.ts` imports `wakesHttp` from `../wakes/http` and
  registers `POST /media/wake-photo` (and NO leftover `wakeHttp` from apps/api).
- `features/_generated/crons.gen.ts` + `cron-handlers.gen.ts` include
  `wake-photo-purge`.
- Biome dep-boundary: no surviving `features/wakes/* → apps/api/*` import; the
  only cross-feature import is `features/wakes/service.ts → @features/felogs/schema`.

Then commit + push + watch CI to green (FOREGROUND `gh run watch --exit-status`;
do not yield to a monitor — memory `subagent-background-wait-stalls`). Confirm
deploy green + pod image age (memory `ci-cancelled-runs-strand-image-digests`).

**Fix-forward on red** — never leave unpushed work.

---

## Git hygiene (SHARED tree, peer dirt present)

```
git pull --rebase --autostash          # FIRST; parallel sessions push main
git add <explicit paths>               # NEVER git add -A (memory never-git-add-all-shared-checkout)
git show --stat HEAD                    # after commit: MUST list your FULL fileset with insertions
git commit -m "…"                      # NO backticks
git push                                # or --no-verify iff hook blocks on UNRELATED peer dirt AND your diff is independently clean
```

- `git add` can silently abort on an already-`git rm`'d pathspec — after commit,
  `git show --stat HEAD` MUST show your full moved/deleted/added fileset with
  insertions, not an empty/partial commit. If partial, re-stage explicitly and
  amend.
- If the pre-push `lint:tracked` hook blocks on UNRELATED peer dirt and your own
  diff is independently clean (typecheck/knip/lint green on your files +
  `git show --stat` = only your files), push with `git push --no-verify`
  (sanctioned escape).
- `lefthook` format re-stages the whole tree (memory
  `lefthook-format-restages-whole-tree`) — stage explicit paths, re-check
  `git show --stat` before push.
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.

---

## Gotchas (inherit)

- `features/* → apps/api/*` is Biome-banned. Every moved backend file repoints to
  `@www/core`, `@app-kit`/`@app-kit/server`, `@features/felogs/schema`, or
  feature-local `./`. A single surviving `apps/api` import turns lint red.
- `apps/api → @features` and `apps/web → @features` and `apps/worker → @features`
  are ALLOWED (used for server.ts / photo-path-migration / tile-registry
  repoints).
- `bun build` reads the **CWD** tsconfig paths (memory
  `bun-build-alias-needs-cwd-tsconfig`). `cd apps/api` for any apps/api build
  step; local typecheck/vitest can pass while a CI-only Docker build resolves
  `@features/wakes/*` differently — watch the api + worker image builds go green.
- **ONE commit.** Codegen only collects once `manifest.ts` exists; base
  router/schema/http/interim deletions must be simultaneous or `apps:check`
  throws (dup router-key / dup table / dup route). Do NOT split.
- No backticks in `git commit -m` (zsh command substitution).

---

## Commit message (no backticks)

```
feat(features): fold wakes tile + interaction-session service into features/wakes (Track C)

Activity tile (tile_wakes) now lives in one features/wakes App owning the
wakePhotos + sessions routers, the wake_photo table, the wake-photo service, the
interaction-session service (derives sessions from frontend_log + wake_photo, the
former read cross-feature from @features/felogs/schema), the wake-photo-purge cron
on the S2 seam, and the wake-photo upload http facet moved out of the interim
apps/api/src/http/wake.http.ts (INTERIM_HTTP_MODULES wake entry removed; the facet
now collects from features/wakes/http.ts via Source A). Full 18-file Activity web
closure moved under features/wakes/web/ (tile face, PIN-gated Activity detail page,
session list/detail views, wake diagnostic); capture-side wake-capture.ts stays in
apps/web as shared panel infra. Base routers, service files, schema table, purge
pass, and codegen interim tests repointed/removed. No coord or DDL change; board
layout byte-identical.
```

---

## Resolved decisions (baked — no open plan questions)

- **MANIFEST-SHAPE → use `tiles: [...]`.** Verified: both landed single-tile
  features use `tiles: [ … ]`, not a singular `tile:`. The `manifest.ts` example
  above is correct as written.
- **GET-ROUTE → DEFER (in scope: UPLOAD/POST only).** Leave the
  `GET /media/wake-photos/*` serve branch (`server.ts:165-167`) in the server
  ladder, repointing `readWakePhoto` to `@features/wakes/photos`. Moving the
  prefix serve-route is a later http-seam pass, out of this task's scope. Do NOT
  move it now.

## Start gate + non-blocking note

1. **START GATE — FELOGS (blocker, external precondition):** implementation MUST
   NOT begin until F-felogs is merged to `main` and exports `frontendLog` from
   `@features/felogs/schema`. Confirmed UNMET at review HEAD `63cd93e1f`
   (`features/felogs/` absent; `frontendLog` still at `apps/api/src/db/schema.ts:192`).
   At implement time run `grep -rn "frontendLog\|frontend_log" features/felogs/schema.ts`;
   if empty, STOP and report to the manager. If the export name/path differs, use
   felogs' actual export. This gates STARTING, not the plan's correctness.
2. **NOTE (not blocking):** `photo-path-migration.ts` remains a wake⇔booth weld in
   `apps/api/src/startup/` (imports both `@features/wakes/schema` `wakePhoto` and
   apps/api `boothPhoto`). Un-welding to `packages/platform` is deferred to P1.6
   per the master plan — do NOT attempt it here.
```
