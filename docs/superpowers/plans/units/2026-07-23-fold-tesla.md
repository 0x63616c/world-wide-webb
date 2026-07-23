# Fold `tile_tesla` into `features/tesla/` (Track C, Wave 2)

Reference: `docs/superpowers/plans/2026-07-23-track-c-master-execution.md` line 242
(Wave 2, "T-tesla"); roadmap `~/.claude/plans/merry-hugging-river.md` Phase 3
("tesla + dogcam ... fold the now-unblocked self-contained tiles"). Fold pattern
proven by `features/network` (W0) and `features/guest-wifi` (C7) — both read
before writing this plan.

## Facts gathered from the real code

- Registry entry (`apps/web/src/lib/tile-registry.ts:108-115`):
  ```
  {
    id: "tile_tesla",
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    worldCol: 22,
    worldRow: 27,
    cols: 4,
    rows: 4,
  }
  ```
  `guestExposed` is **absent** (not in the entry, not in the `GUEST_EXPOSED`
  allowlist grep) → **not guest-exposed**. No allowlist edit needed.
- No table (roadmap confirms "No table"). No worker interval (unlike
  weight/deploys) — `T-tesla` is a pure fold, nothing hand-wired to leave.
- `apps/api/src/trpc/routers/index.ts` imports `teslaRouter` and mounts it at
  `tesla: teslaRouter` on `baseRouter` — both must be deleted; the feature's
  `api.ts` (`defineApi(router({ tesla: teslaRouter }))`) rejoins the app router
  automatically via `featureAppRouter` (`@features/_generated/router.gen.ts`),
  same as network's `network` key.
- `apps/api/src/services/climate-service.ts` reads `env.TESLA_ENTITY_PREFIX`
  directly from apps/api's own `env.ts` (to exclude Tesla's climate entity from
  its own entity scan) — it does **not** import tesla-service or anything that
  moves. `TESLA_ENTITY_PREFIX`/`HA_URL`/`HA_TOKEN`/`HOME_LAT`/`HOME_LON`/
  `HOME_PLACE_NAME`/`HOME_RADIUS_MILES` all **stay** in `apps/api/src/env.ts`
  (other HA tiles still consume them) — features/tesla duplicates the keys it
  needs in its own `config.ts`, per the network/guest-wifi precedent.
- `apps/api/src/config/places.ts` (`findPlace`, `haversineMiles`, `PLACES`) is
  used ONLY by `tesla-service.ts` and its own test
  (`apps/api/src/__tests__/places.test.ts`) → moves wholesale into
  `features/tesla/`.
- `apps/api/src/integrations/homeassistant/index.ts` is the apps/api-side HA
  singleton (`ha`), built from `createHomeAssistantClient({baseUrl, token})`
  exported by `@www/core` — per its own comment, "each caller builds its own
  instance from its config slice" once a tile folds. `features/tesla` must NOT
  import `apps/api/src/integrations/homeassistant` (that's an apps/api import,
  forbidden by the Biome boundary) — it builds its own `HomeAssistantClient`
  instance from `@www/core` + its own `config.ts`.
- Tile view uses a helper, `apps/web/src/components/tiles/TeslaMap.tsx`
  (maplibre-gl map), imported ONLY by `TeslaTileView.tsx` → moves with the view,
  inlined as a co-located module next to `web.tsx` (not merged into one file —
  it's a real sub-component, same treatment `web.tsx` files give sub-components
  today, e.g. network's `ButterflyChart` stays inline because it's small; `TeslaMap`
  is 146 lines with its own maplibre lifecycle, so keep it a **separate file**
  `features/tesla/tesla-map.tsx` imported by `web.tsx` — still "inlined" in the
  sense that it leaves `apps/web/src/components/tiles/`).
- Detail-page wiring (`apps/web/src/components/tiles/views/wiring/tesla.tsx`)
  and the four modals (`apps/web/src/components/tiles/views/TeslaModal*.tsx`
  + their `.stories.tsx`) **stay put** — same precedent as
  `views/wiring/network.tsx` and the `NetworkModal*` files, which stayed under
  `apps/web/src/components/tiles/views/` after the network fold. They import
  `trpc.tesla.*` (the tRPC key, unchanged post-fold) and
  `@/components/tiles/views/TeslaModal*` — no import of `TeslaTile`/
  `TeslaTileView`/`TeslaMap`, so **no repoint needed** in wiring/modals.
- `TeslaTileView.stories.tsx` stays under `apps/web/src/components/tiles/`
  (gotcha #3) but its `import { TeslaTileStatus, TeslaTileView } from
  "./TeslaTileView"` must repoint to `@features/tesla/web`.
- `apps/web/vitest.config.ts` already globs
  `../../features/**/web*.test.tsx` and `apps/api/vitest.config.ts` already
  globs `../../features/**/{service,api}.test.ts` (see both files' `test.include`
  comments — this collection convention was set up during the network/guest-wifi
  folds) — **no vitest.config.ts edit needed**, only correct destination
  filenames.

## File moves (source → dest)

| Source | Dest | Notes |
|---|---|---|
| `apps/web/src/components/tiles/TeslaTile.tsx` (32 lines, container) | inlined into `features/tesla/web.tsx` bottom (`export function TeslaTile()`) | |
| `apps/web/src/components/tiles/TeslaTileView.tsx` (181 lines, pure view) | inlined into `features/tesla/web.tsx` (`export function TeslaTileView(...)`, `TeslaCharge`, `TeslaSkeleton`, `TeslaTileStatus`, `TeslaTileViewProps`) | imports `TeslaMap` from new `./tesla-map` |
| `apps/web/src/components/tiles/TeslaMap.tsx` (146 lines) | `features/tesla/tesla-map.tsx` | only consumer is the view |
| `apps/api/src/trpc/routers/tesla.ts` (80 lines) | `features/tesla/api.ts` | wrap in `defineApi(router({ tesla: teslaRouter }))`, `publicProcedure`/`router` from `@app-kit/server` (not `../init`) |
| `apps/api/src/services/tesla-service.ts` (204 lines) | `features/tesla/service.ts` | `env` → new `./config`; `ha` → build own client from `@www/core` + `./config`; `findPlace` → `./places` |
| `apps/api/src/config/places.ts` (54 lines) | `features/tesla/places.ts` | `env` → `./config` |
| new | `features/tesla/config.ts` | own env slice: `HA_URL`, `HA_TOKEN`, `TESLA_ENTITY_PREFIX`, `HOME_LAT`, `HOME_LON`, `HOME_PLACE_NAME`, `HOME_RADIUS_MILES` (same defaults as `apps/api/src/env.ts` today) |
| new | `features/tesla/manifest.ts` | `defineApp`, coords verbatim |
| `apps/web/src/components/tiles/__tests__/TeslaTile.test.tsx` | `features/tesla/web.test.tsx` | import `./web` not `../TeslaTile`; mock target for trpc stays `@/lib/trpc` (feature files still use the `@/lib/trpc` alias per network/guest-wifi precedent) |
| `apps/web/src/components/tiles/__tests__/TeslaTileView.test.tsx` | `features/tesla/web-view.test.tsx` | import `TeslaMap` from `./tesla-map`, `TeslaTileView`/`TeslaTileViewProps` from `./web` |
| `apps/api/src/__tests__/tesla.test.ts` | `features/tesla/service.test.ts` | mock target `../integrations/homeassistant` → the feature no longer imports that module; mock `@www/core`'s `createHomeAssistantClient` (or mock the constructed client instance the service builds — see service.ts sketch) instead |
| `apps/api/src/__tests__/places.test.ts` | merge into `features/tesla/service.test.ts` (append as its own `describe` blocks) OR `features/tesla/places.test.ts` **only if** it's appended to `service.test.ts` filename-wise — vitest only collects `service.test.ts`/`api.test.ts`/`web*.test.tsx` from `features/**`, so a standalone `places.test.ts` would NOT run. **Must merge into `service.test.ts`.** | import `findPlace`, `haversineMiles`, `PLACES` from `./places` |

Stay put (do not move): `TeslaTileView.stories.tsx` (repoint its import only),
`apps/web/src/components/tiles/__tests__/TeslaTileView.stories.test.tsx`
(repoint import), `views/wiring/tesla.tsx`, all four `TeslaModal*.tsx` +
`.stories.tsx`.

## Cross-feature / importer repoints

1. `apps/web/src/lib/tile-registry.ts`:
   - delete the `tile_tesla` entry (lines ~108-115)
   - delete `import { TeslaTile } from "../components/tiles/TeslaTile"` and
     `import { TeslaTileView } from "../components/tiles/TeslaTileView"`
   - add `import teslaManifest from "@features/tesla/manifest"` alongside the
     existing `networkManifest`/`guestWifiManifest` imports, and wire it into
     whatever union mechanism those two already use (read the exact
     network/guest-wifi wiring at the top of tile-registry.ts before editing —
     it's a manifest array/union, not a per-entry object like the legacy
     entries).
2. `apps/api/src/trpc/routers/index.ts`:
   - delete `import { teslaRouter } from "./tesla"`
   - delete `tesla: teslaRouter,` from `baseRouter`
3. `apps/web/src/components/tiles/TeslaTileView.stories.tsx`: repoint
   `from "./TeslaTileView"` → `from "@features/tesla/web"`.
4. `apps/web/src/components/tiles/__tests__/TeslaTileView.stories.test.tsx`:
   check its import target (currently composes the stories file, likely no
   direct Tesla import — verify and repoint only if needed).
5. Delete now-empty source files: `TeslaTile.tsx`, `TeslaTileView.tsx`,
   `TeslaMap.tsx` (web); `tesla-service.ts`, `routers/tesla.ts`, `config/places.ts`
   (api); `apps/api/src/__tests__/tesla.test.ts`, `apps/api/src/__tests__/places.test.ts`,
   `apps/web/src/components/tiles/__tests__/TeslaTile.test.tsx`,
   `apps/web/src/components/tiles/__tests__/TeslaTileView.test.tsx`.
6. No other importer found for `tesla-service`, `routers/tesla`,
   `config/places`, `TeslaTile`, `TeslaTileView`, or `TeslaMap` (verified by
   grep across `apps/`, excluding `.claude/worktrees/**`). `climate-service.ts`
   reads `env.TESLA_ENTITY_PREFIX` from its OWN apps/api env — untouched, no
   repoint (it's not importing anything that moved).

## Code sketches

`features/tesla/manifest.ts`:
```ts
import { defineApp } from "@app-kit";
import { TeslaTile, TeslaTileView } from "./web";

/**
 * The tesla app manifest (Track C, Wave 2). Coords copied verbatim from the
 * pre-fold tile-registry entry. Not guest-exposed. HA-backed via @www/core
 * directly (P1.1) — no apps/api reach.
 */
export default defineApp({
  id: "tile_tesla",
  tile: {
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    worldCol: 22,
    worldRow: 27,
    cols: 4,
    rows: 4,
  },
});
```

`features/tesla/config.ts` (own env slice, network/guest-wifi pattern):
```ts
import { z } from "zod";

export const config = z
  .object({
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
    TESLA_ENTITY_PREFIX: z.string().default("evee"),
    HOME_LAT: z.coerce.number().default(34.0537),
    HOME_LON: z.coerce.number().default(-118.2428),
    HOME_PLACE_NAME: z.string().default("Home"),
    HOME_RADIUS_MILES: z.coerce.number().default(1),
  })
  .parse(process.env);
```

`features/tesla/service.ts` HA client construction (replaces the `ha` singleton
import):
```ts
import { createHomeAssistantClient } from "@www/core";
import { config } from "./config";
import { findPlace } from "./places";

const ha = createHomeAssistantClient({ baseUrl: config.HA_URL, token: config.HA_TOKEN });
// ...rest of tesla-service.ts body unchanged, `env.TESLA_ENTITY_PREFIX` -> `config.TESLA_ENTITY_PREFIX`
```

`features/tesla/api.ts`:
```ts
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { getTeslaData, setTeslaCharging, setTeslaLock, setTeslaPreconditioning } from "./service";

// ...teslaOutputSchema, unavailable() unchanged...

const teslaRouter = router({ /* get/setLock/setCharging/setPreconditioning unchanged */ });

export const api = defineApi(router({ tesla: teslaRouter }));
```

`features/tesla/web.tsx` skeleton (view inlined, TeslaTile container at bottom,
mirrors `features/network/web.tsx` shape):
```tsx
import { Icon } from "@/components/Icon";
import { Skeleton, Stat, Tile, TileHeader, TileStatus } from "@/components/ui";
import { formatRelativeAge } from "@/lib/relative-age";
import { POLL } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";
import { TeslaMap } from "./tesla-map";

function TeslaCharge(/* unchanged from TeslaTileView.tsx */) { /* ... */ }
function TeslaSkeleton() { /* ... */ }

export const TeslaTileStatus = TileStatus;
export type TeslaTileStatus = TileStatus;
export type TeslaTileViewProps = /* unchanged union */;

export function TeslaTileView(props: TeslaTileViewProps) { /* unchanged body */ }

export function TeslaTile() {
  const q = useTileQuery(trpc.tesla.get.useQuery(undefined, { refetchInterval: POLL.tesla }));
  if (q.status !== TileStatus.Populated) return <TeslaTileView status={q.status} />;
  const data = q.data;
  return (
    <TeslaTileView
      status={q.status}
      locked={data.locked}
      charging={data.charging}
      rate={data.rate}
      pct={data.pct}
      range={data.range}
      odo={data.odo}
      climate={data.climate}
      lat={data.lat ?? null}
      lon={data.lon ?? null}
      place={data.place ?? ""}
    />
  );
}
```

## Commit

ONE atomic commit (backend + frontend + manifest.ts together — gotcha #1).
Stage explicit paths (never `git add -A`):
```
git add features/tesla/ \
  apps/web/src/lib/tile-registry.ts \
  apps/web/src/components/tiles/TeslaTileView.stories.tsx \
  apps/web/src/components/tiles/__tests__/TeslaTileView.stories.test.tsx \
  apps/api/src/trpc/routers/index.ts
git rm apps/web/src/components/tiles/TeslaTile.tsx \
  apps/web/src/components/tiles/TeslaTileView.tsx \
  apps/web/src/components/tiles/TeslaMap.tsx \
  apps/web/src/components/tiles/__tests__/TeslaTile.test.tsx \
  apps/web/src/components/tiles/__tests__/TeslaTileView.test.tsx \
  apps/api/src/services/tesla-service.ts \
  apps/api/src/trpc/routers/tesla.ts \
  apps/api/src/config/places.ts \
  apps/api/src/__tests__/tesla.test.ts \
  apps/api/src/__tests__/places.test.ts
```
Message (no backticks):

feat(features): fold tesla tile into features/tesla (Track C)

Before pushing: `git pull --rebase --autostash`, then `git show --stat HEAD` to
confirm no peer dirt landed in the commit.

## Verify chain (run all, real output evidence, fix forward on red)

1. `bun run apps:gen` — regenerates `features/_generated/*.gen.ts`; confirm
   `tile_tesla` now comes from `features/tesla/manifest.ts` in the diff.
2. `bun run typecheck`
3. `cd apps/api && bunx vitest run src/__tests__ ../../features/tesla` (or the
   repo's standard per-app vitest invocation) covering
   `features/tesla/service.test.ts`, then from `apps/web`:
   `bunx vitest run features/tesla ../../apps/web/src/components/tiles/__tests__/TeslaTileView.stories.test.tsx`
   covering `features/tesla/web.test.tsx`, `features/tesla/web-view.test.tsx`,
   PLUS the placeholder-tiles bento 1x1-clearance test (memory
   `bento-tiler-1x1-clearance`) — a moved tile must not break gap-free tiling.
4. `bun run apps:check` — codegen drift + validator (dup id/router-key/table,
   exactly 1 `home` tile, no tile-rect overlap, guestExposed↔allowlist — tesla
   has neither flag so this should be a no-op check).
5. `bun run knip` — zero-tolerance; confirms no dead export left behind
   (`ha` singleton import path, old `TeslaTile`/`TeslaTileView`/`TeslaMap`
   exports, `findPlace`/`haversineMiles` old location).
6. `bun run lint` — proves the `features/* → apps/api` Biome boundary stays
   green; features/tesla must show zero apps/api imports (it imports
   `@www/core`, `@app-kit`, `@app-kit/server`, `@/...` web aliases only).

## Open questions / PLACEHOLDER

- PLACEHOLDER: exact wiring mechanism in `tile-registry.ts` for how
  `networkManifest`/`guestWifiManifest` get merged with the legacy per-entry
  array (a `manifests` array unioned with `TILES`, or something else) — read
  the full file before editing so `teslaManifest` is wired the same way; not
  fully inspected line-by-line in this planning pass (only imports + the
  `tile_tesla` entry were read).
- PLACEHOLDER: whether `apps/web/vitest.config.ts`'s `web*.test.tsx` glob
  covers `web-view.test.tsx` — the glob pattern `web*.test.tsx` should match
  both `web.test.tsx` and `web-view.test.tsx` (both start with `web` and end
  `.test.tsx`), consistent with `features/network/web-view.test.tsx` already
  existing and presumably running today — implementer should confirm with a
  dry vitest list before relying on it.
- No worker-interval to hand-wire for this tile (confirmed: no queue job, no
  interval cycle, unlike weight/deploys/github in the same wave).
