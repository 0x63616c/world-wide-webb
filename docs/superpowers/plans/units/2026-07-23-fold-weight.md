# Fold weight tile into features/weight/ (Track C, Wave 2)

Master plan: `docs/superpowers/plans/2026-07-23-track-c-master-execution.md`,
Wave 2, unit **T-weight**. Roadmap: `~/.claude/plans/merry-hugging-river.md`
Phase 3. Reference folds (read fully before implementing):
`features/network/` (W0) and `features/guest-wifi/` (C7) — this fold copies
their shape exactly, including the "feature owns its own db pool" pattern from
`features/guest-wifi/db.ts`.

## Why this fold is bigger than network/guest-wifi

Weight has a full-screen two-variant detail PAGE (Trend + Readings), not just
a tile. Per AGENTS.md the tile view inlines into `web.tsx`, but the detail
page system (`apps/web/src/components/tiles/detail/`) is NOT part of the
Track C facet contract — network and guest-wifi don't have page-shaped
details, so there's no precedent for moving it, and the master plan's
T-weight bullet lists only the four backend files + the table, never the page
views. **Decision: only the tile container + tile view move. The Trend/
Readings page views and their wiring stay in apps/web, repointed to import
the two symbols they need (`LB_PER_KG`, `formatRecency`) from
`@features/weight/web` instead of the old `WeightTile`/`WeightTileView`
paths.** This mirrors guest-wifi's own detail wiring
(`apps/web/src/components/tiles/detail/wiring/guest-wifi.tsx`), which also
stays in apps/web and reaches into the feature only via `@features/guest-wifi/*`.

## Current code (apps/api + apps/web)

- Tile: `apps/web/src/components/tiles/WeightTile.tsx` (container, 45 lines) +
  `WeightTileView.tsx` (view + `formatRecency`, 183 lines).
- Stories (STAY in apps/web per gotcha 3): `WeightTileView.stories.tsx`,
  `__tests__/WeightTileView.stories.test.tsx`.
- Detail page (STAYS in apps/web, not folded): `WeightPageView.tsx` (+
  `.stories.tsx`, `__tests__/WeightPageView.stories.test.tsx`),
  `WeightReadingsView.tsx` (+ `.stories.tsx`,
  `__tests__/WeightReadingsView.stories.test.tsx`),
  `detail/wiring/weight.tsx`, `detail/registry.ts` (entry stays, only its
  import target changes — see below, no line removed).
- Router: `apps/api/src/trpc/routers/weight.ts` — `weightRouter` (summary,
  days, setExcluded, delete) + exported `assembleDays`, `tzInput`. Queries
  apps/api's shared `db` directly (no service indirection).
- Domain: `apps/api/src/services/weight-domain.ts` (median, dailyMedians,
  summarize, isOutsideSanityBand, LB_PER_KG — pure, no db).
- SQL helpers: `apps/api/src/services/weight-sql.ts` (dayExpr, notDeleted,
  isValidTimeZone).
- Ingest (interval cycle, STAYS HAND-WIRED):
  `apps/api/src/services/weight-service.ts` — `runWeightIngestCycle()`, polls
  HA every 15s via `apps/api/src/integrations/homeassistant` (already
  `@www/core`-backed, P1.1 done), writes `weightMeasurement` via apps/api's
  shared `db`. Re-exported by `apps/api/src/worker-deps.ts:35` and run by
  `apps/worker/src/index.ts:30,141` on a 15s `run:` interval — this loop is
  the worker's own hand-wired schedule, not a queue job. NOT an S1 consumer.
- Table: `apps/api/src/db/schema.ts:419-440`, `weightMeasurement` /
  `weight_measurement`, one index, no FK in or out (grep confirmed — safe to
  relocate wholesale).
- Env: `apps/api/src/env.ts:28` `HA_WEIGHT_ENTITY_ID` — used only by the
  ingest cycle; stays in apps/api/src/env.ts untouched (ingest is hand-wired
  apps/api code, not a feature facet, so it keeps using apps/api's `env`).
- Registry: `apps/web/src/lib/tile-registry.ts` `tile_weight` entry (see
  coords below), imports `WeightTile`/`WeightTileView` at the top.
- Tests: `apps/api/src/services/weight-domain.test.ts`,
  `apps/api/src/__tests__/weight-sql.test.ts`,
  `apps/api/src/__tests__/weight-router.test.ts` (assembleDays + tzInput),
  `apps/api/src/__tests__/weight-mutations.test.ts` (delete mutation, mocks
  apps/api's `../db/index`).

## Coords + guestExposed (VERBATIM from tile-registry.ts)

```
id: "tile_weight", worldCol: 34, worldRow: 22, cols: 3, rows: 2
guestExposed: NO (not in features/guest-exposed.ts GUEST_EXPOSED list; no
  allowlist edit needed)
```

Comment above the entry (tile-registry.ts:85-88) explains col 34 (not 33) is
load-bearing for the placeholder-tiles bento gap-fill — carry that comment
into manifest.ts.

## Source → dest

| dest | source(s) |
|---|---|
| `features/weight/manifest.ts` | new — coords above, `defineApp` |
| `features/weight/web.tsx` | `WeightTile.tsx` + `WeightTileView.tsx` merged, both `export function`s inlined in one file (network.tsx precedent: `NetworkTileView` then `NetworkTile` in one file) |
| `features/weight/config.ts` | new — `DATABASE_URL` only (zod, safe default, guest-wifi/config.ts pattern) |
| `features/weight/db.ts` | new — own pool + drizzle instance from `./config` + `./schema`, guest-wifi/db.ts pattern verbatim |
| `features/weight/schema.ts` | `weightMeasurement` table, moved wholesale from `apps/api/src/db/schema.ts:419-440`; DELETE it from apps/api's schema.ts |
| `features/weight/service.ts` | `weight-domain.ts` (median, dailyMedians, summarize, isOutsideSanityBand, LB_PER_KG) + `weight-sql.ts` (dayExpr, notDeleted, isValidTimeZone, **tzInput** moves here too since it's built from isValidTimeZone) + `assembleDays` (pure, from weight.ts router) + the four query bodies currently inline in the router (summary/days/setExcluded/delete), now using `./db` + `./schema` instead of apps/api's db |
| `features/weight/api.ts` | `weight.ts` router — thin `defineApi(router({ weight: weightRouter }))`, `weightRouter`'s procedures call into `service.ts`; **export `weightRouter` itself too** (not just the wrapped `api`), so api.test.ts can build a caller directly, mirroring weight-mutations.test.ts's existing style |

Ingest (`weight-service.ts`, `runWeightIngestCycle`) **does not move**. Only
its imports repoint:
- `import { weightMeasurement } from "../db/schema"` → `from "@features/weight/schema"`
- `import { isOutsideSanityBand, LB_PER_KG } from "./weight-domain"` → `from "@features/weight/service"`
- `import { notDeleted } from "./weight-sql"` → `from "@features/weight/service"`
- `db` import (`../db/index`, apps/api's shared instance) stays as-is — a
  plain drizzle `.insert()/.select()` against a table object works whether or
  not that table is part of the schema object passed to `drizzle()`; no
  second pool needed for a hand-wired writer that already lives in apps/api.
- `apps/api/src/services/weight-domain.ts` and `weight-sql.ts` are DELETED
  after the move (their content now lives in `features/weight/service.ts`).

## tile-registry.ts edit

- Delete the `tile_weight` REGISTRY_ENTRIES object (lines ~85-96) and its
  `WeightTile`/`WeightTileView` imports (lines 39-40).
- Add `import weightManifest from "@features/weight/manifest";` alongside the
  existing `guestWifiManifest`/`networkManifest` imports, and union it into
  whatever list already merges those two generated manifests into
  `TILE_REGISTRY` (read the exact union line near the bottom of the file
  before editing — don't guess the variable name).

## Cross-feature / worker importers to repoint

1. `apps/api/src/trpc/routers/index.ts` — remove
   `import { weightRouter } from "./weight";` and the `weight: weightRouter,`
   key from `baseRouter` (the feature's `api.ts` joins via
   `featureAppRouter`/`router.gen.ts` automatically once `apps:gen` runs).
2. `apps/api/src/trpc/routers/weight.ts` — DELETE (fully replaced by
   `features/weight/api.ts` + `service.ts`).
3. `apps/api/src/services/weight-domain.ts`,
   `apps/api/src/services/weight-sql.ts` — DELETE.
4. `apps/api/src/services/weight-service.ts` — KEEP, repoint 2 imports (see
   above).
5. `apps/api/src/db/schema.ts` — delete the `weightMeasurement` export
   (lines 419-440).
6. `apps/web/src/components/tiles/detail/wiring/weight.tsx` — repoint
   `LB_PER_KG` from `@/components/tiles/WeightTile"` →
   `"@features/weight/web"`; `formatRecency` from
   `@/components/tiles/WeightTileView"` → `"@features/weight/web"`.
7. `apps/web/src/components/tiles/WeightTileView.stories.tsx` — repoint
   `formatRecency, WeightTileView` import from `"./WeightTileView"` →
   `"@features/weight/web"`.
8. `apps/web/src/components/tiles/__tests__/WeightTileView.stories.test.tsx`
   — no import change (imports the sibling `.stories.tsx`, which still lives
   at the same path); confirm it still passes once the stories file's own
   import repoints.
9. Delete `apps/web/src/components/tiles/WeightTile.tsx` and
   `WeightTileView.tsx` after their content is merged into
   `features/weight/web.tsx`.
10. `apps/web/src/lib/tile-registry.ts` — per above.

`WeightPageView.tsx`, `WeightReadingsView.tsx`, their `.stories.tsx` +
`__tests__/*.stories.test.tsx`, and `detail/registry.ts` itself need NO path
changes beyond #6/#7 above — they already only ever imported the tile-level
symbols, never reached into apps/api.

## Tests: move + vitest wiring

- `apps/api/src/services/weight-domain.test.ts` + `weight-sql.test.ts` +
  the `assembleDays`/`tzInput` half of `weight-router.test.ts` → merge into
  **`features/weight/service.test.ts`** (imports become relative `./service`
  instead of `../services/weight-domain` / `../services/weight-sql` /
  `../trpc/routers/weight`). Collected automatically by
  `apps/api/vitest.config.ts`'s `../../features/**/{service,api}.test.ts`
  glob — no vitest.config.ts edit needed.
- `apps/api/src/__tests__/weight-mutations.test.ts` → **`features/weight/api.test.ts`**.
  Rewrite the `vi.mock("../db/index", ...)` to `vi.mock("./db", ...)`
  (features/weight's own db module), build the caller from `@app-kit/server`'s
  `router` + the exported `weightRouter` from `./api` instead of apps/api's
  `trpc/init`. Same glob picks it up.
- Delete the four old test files from apps/api after the port
  (`weight-domain.test.ts`, `weight-sql.test.ts`, `weight-router.test.ts`,
  `weight-mutations.test.ts`).
- No `web*.test.tsx` exists for the weight tile today, so nothing to add to
  `apps/web/vitest.config.ts`'s glob for this fold (the Storybook
  `.stories.test.tsx` files stay under apps/web/src, same as the guest-wifi
  precedent noted in that config's own comment — already collected by
  apps/web's default include).
- Run `apps/web/src/lib/__tests__/placeholder-tiles.test.ts` (bento 1x1
  clearance) after the registry entry deletes — the col-34 comment above says
  this is load-bearing.

## manifest.ts sketch

```ts
import { defineApp } from "@app-kit";
import { WeightTile, WeightTileView } from "./web";

/**
 * The weight app manifest (Track C, Wave 2). One inline `defineApp` is the
 * single source of truth for this tile: id, board placement (copied verbatim
 * from the pre-fold tile-registry entry), and components. Not guest-exposed.
 * Col 34 (not 33) is load-bearing for the bento fill in the rows-22/23 band
 * above the home cluster — see placeholder-tiles.test.ts.
 *
 * The weight-ingest interval cycle (apps/api/src/services/weight-service.ts,
 * 15s HA poll) is NOT part of this app — it stays hand-wired in apps/worker,
 * importing this feature's schema/service directly. The S1 job-handler seam
 * only covers queue jobs (notify, youtube_ingest), not interval cycles.
 */
export default defineApp({
  id: "tile_weight",
  tile: {
    label: "Weight",
    component: WeightTile,
    viewComponent: WeightTileView,
    worldCol: 34,
    worldRow: 22,
    cols: 3,
    rows: 2,
  },
});
```

## web.tsx skeleton

```tsx
import { Icon } from "@/components/Icon";
import { Skeleton, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";

// Duplicated from the feature's own service on purpose: web must not import
// api runtime code across the feature/web boundary either — this constant is
// cheap enough to just restate (was already duplicated pre-fold, from
// apps/api's weight-domain).
export const LB_PER_KG = 2.2046226218;

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** "Today" / "Yesterday" / "Jul 12" — also consumed by detail/wiring/weight.tsx
 * (apps/web) via @features/weight/web. */
export function formatRecency(latestAt: string, now: Date): string {
  // ...body verbatim from apps/web/src/components/tiles/WeightTileView.tsx
}

// ...linePoints/pathFrom/DeltaBadge/Sparkline private helpers verbatim...

interface WeightTileViewProps { /* verbatim */ }

export function WeightTileView(props: WeightTileViewProps) {
  // ...verbatim from WeightTileView.tsx
}

export function WeightTile() {
  const tile = useTileQuery(
    trpc.weight.summary.useQuery({ range: "30d", tz: TZ }, { refetchInterval: POLL.weight }),
  );
  const now = useNow();
  // ...verbatim from WeightTile.tsx
}
```

## service.ts sketch (shape only)

```ts
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { weightMeasurement } from "./schema";

const SANITY_BAND_KG = 5.4;
export const LB_PER_KG = 2.2046226218;

export function median(xs: number[]): number { /* verbatim from weight-domain.ts */ }
export function isOutsideSanityBand(kg: number, recentIncludedKg: number[]): boolean { /* verbatim */ }
export function dailyMedians(rows: DayKeyedRow[]) { /* verbatim */ }
export function summarize(daily, rawKg) { /* verbatim */ }

export function dayExpr(tz: string) { /* verbatim from weight-sql.ts, sql template against weightMeasurement.measuredAt */ }
export function notDeleted() { return isNull(weightMeasurement.deletedAt); }
export function isValidTimeZone(tz: string): boolean { /* verbatim */ }
export const tzInput = z.string().refine(isValidTimeZone, { message: "not a recognised IANA time zone" });

export function assembleDays(rows: DayRow[]) { /* verbatim from weight.ts router */ }

export async function getSummary(range: "7d" | "30d" | "all", tz: string) { /* body of the router's summary query, using ./db */ }
export async function getDays(tz: string, cursor: string | undefined, limit: number) { /* body of the router's days query */ }
export async function setExcluded(id: string, excluded: boolean): Promise<void> { /* body of setExcluded mutation */ }
export async function deleteReading(id: string): Promise<boolean> { /* body of delete mutation; returns whether a row was tombstoned, api.ts throws NOT_FOUND on false */ }
```

## api.ts sketch

```ts
import { getLogger } from "@www/logger";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import * as service from "./service";

export const weightRouter = router({
  summary: publicProcedure
    .input(z.object({ range: z.enum(["7d", "30d", "all"]), tz: service.tzInput }))
    .query(({ input }) => service.getSummary(input.range, input.tz)),
  days: publicProcedure
    .input(z.object({ tz: service.tzInput, cursor: z.string().optional(), limit: z.number().int().min(1).max(90).default(14) }))
    .query(({ input }) => service.getDays(input.tz, input.cursor, input.limit)),
  setExcluded: publicProcedure
    .input(z.object({ id: z.string(), excluded: z.boolean() }))
    .mutation(async ({ input }) => {
      await service.setExcluded(input.id, input.excluded);
      return { ok: true } as const;
    }),
  delete: publicProcedure.input(z.object({ id: z.string() })).mutation(async ({ input }) => {
    const deleted = await service.deleteReading(input.id);
    if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "weight measurement not found" });
    getLogger().info({ id: input.id }, "weight measurement deleted");
    return { ok: true } as const;
  }),
});

export const api = defineApi(router({ weight: weightRouter }));
```

(Output-schema `.output(...)` calls from the original router were trimmed
from this sketch for brevity — port them verbatim, they're real work, not
decoration.)

## PLACEHOLDER open questions

- PLACEHOLDER: whether `getSummary`/`getDays`/etc. return exactly the same
  shape the original inline router queries returned (including the
  `latestMeasuredAt` freshness-token query) — implementer should diff
  against the original `weight.ts` router line-by-line when porting into
  `service.ts`, not paraphrase from this sketch.
- PLACEHOLDER: exact variable name of the manifest-union list in
  `tile-registry.ts` that `weightManifest` joins — read the file at edit
  time, don't guess from this plan.
- PLACEHOLDER: whether `features/weight` needs its own second Postgres pool
  (via `db.ts`) is a real behavior change from today (one shared apps/api
  pool → api.ts gets a second pool, ingest keeps using the first). This
  matches the guest-wifi precedent exactly, but flag it in the commit/PR
  description since it's a new connection to Postgres, not just a code move.
- PLACEHOLDER: none open on the ingest hand-wiring — confirmed
  `runWeightIngestCycle` stays in `apps/api/src/services/weight-service.ts`,
  re-exported by `worker-deps.ts`, run by `apps/worker/src/index.ts` on its
  existing 15s interval. No jobs.ts, no S1.

## Verify chain (run all, keep real output evidence)

```
bun run apps:gen
bun run typecheck
cd apps/api && bunx vitest run features/weight; cd -
cd apps/web && bunx vitest run features/weight src/lib/__tests__/placeholder-tiles.test.ts src/components/tiles/__tests__/WeightTileView.stories.test.tsx src/components/tiles/__tests__/WeightPageView.stories.test.tsx src/components/tiles/__tests__/WeightReadingsView.stories.test.tsx; cd -
bun run apps:check
bun run knip
bun run lint
```

`cd apps/api` before any api build/typecheck step that touches bun build
directly (bun reads tsconfig `paths` from CWD, not entry — gotcha 7); the
commands above are vitest/typecheck at repo root plus feature-scoped test
runs, so the explicit `cd` is only required if a bare `bun build apps/api/...`
step gets added later.

Fix forward on any red — do not leave a step failing.

## Commit

One atomic commit (backend + manifest.ts together, gotcha 1):

feat(features): fold weight tile into features/weight (Track C)

Stage explicit paths (features/weight/**, apps/api/src/... deletes,
apps/web/src/... edits/deletes, features/_generated/**.gen.ts,
apps/web/src/lib/tile-registry.ts, apps/api/src/trpc/routers/index.ts,
apps/api/src/db/schema.ts) — never `git add -A` (gotcha 10, shared checkout).
`git pull --rebase --autostash` before push; `git show --stat HEAD` after
commit to confirm no peer dirt swept in. No backticks in the commit message
body.

Do NOT commit from this planning pass — this file is the plan only.
