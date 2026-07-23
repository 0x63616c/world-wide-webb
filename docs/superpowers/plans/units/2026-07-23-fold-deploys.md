# Fold `tile_deploys` into `features/deploys/` (Track C, Wave 2)

Unit: **T-deploys** from `docs/superpowers/plans/2026-07-23-track-c-master-execution.md`
(Wave 2 — "Fold self-contained singles"). Reference precedent: `features/network/`
(W0) and `features/guest-wifi/` (C7) — read both before implementing. Roadmap:
`~/.claude/plans/merry-hugging-river.md` Phase 3.

## Scope

Fold the Deploys tile's **web + api + service + schema** into
`features/deploys/`. The GitHub-poll worker cycle (`runGithubPollCycle`, a 10s
interval, self-gating to 60s idle) is **NOT a queue job** — Seam S1
(worker-job seam) is not built yet and is scoped to queue jobs only
(`notify`, `youtube_ingest`). Per the master plan's explicit interim rule
("Interval cycles are NOT a seam"), `runGithubPollCycle` stays hand-wired in
`apps/worker`, which will import it from `@features/deploys/service` instead of
`apps/api`. Do **NOT** invent a `jobs.ts` for it — this feature has no `jobs.ts`.

`github-purge-service.ts` (`apps/api/src/services/github-purge-service.ts`) is
**explicitly out of scope** — see "Not moving" below.

## Current state (read before editing)

- Tile container: `apps/web/src/components/tiles/DeployTile.tsx` (formatting
  helpers `formatAgo`/`formatElapsed`/`staleForOf`/`toModalCommits` live here,
  re-used by the detail wiring).
- Tile view: `apps/web/src/components/tiles/DeployTileView.tsx` (exports
  `DeployTileView`, `CommitState`, and the `DeployCommit`/`DeployRun`/
  `DeployFailure` types the modal pipeline imports).
- Tile story: `apps/web/src/components/tiles/DeployTileView.stories.tsx`.
- Tile test: `apps/web/src/components/tiles/__tests__/DeployTile.test.tsx`
  (tests the pure helpers, no trpc mounting).
- Detail-page body (NOT the tile view — stays put, see "Not moving"):
  `apps/web/src/components/tiles/views/DeployModalPipeline.tsx` (+
  `.stories.tsx`), imports `DeployCommit`/`DeployFailure`/`DeployRun`/
  `CommitState` from `../DeployTileView`.
- Detail wiring (stays put, repoint only):
  `apps/web/src/components/tiles/detail/wiring/deploys.tsx`, registered in
  `apps/web/src/components/tiles/detail/registry.ts` (`deploysDetailEntry`,
  `tileId: "tile_deploys"`) — **no change needed to registry.ts itself**.
- Router: `apps/api/src/trpc/routers/github.ts` (`githubRouter`, key `github`).
  Check whichever root-router file mounts it (`apps/api/src/trpc/routers/*` /
  the app router) — router mounting for a NON-folded tile is presumably manual
  today; confirm and remove that manual mount since codegen will mount `deploys`
  instead. **Router key changes from `github` to `deploys`** (mirrors
  `network`/`portal` precedent: the facet's top-level key is the feature id,
  not the legacy router filename) — the frontend calls `trpc.github.status` in
  three files (`DeployTile.tsx`, `detail/wiring/deploys.tsx`); all three become
  `trpc.deploys.status` after the fold. **PLACEHOLDER: confirm with the
  implementer whether renaming `github` → `deploys` is in-scope for this unit
  or whether the router key should stay `github` for a smaller diff — the
  network/guest-wifi precedent renamed (`network`, `portal`), so default to
  renaming unless it meaningfully increases risk.**
- Service: `apps/api/src/services/github-actions-service.ts` (560 lines) —
  owns `runGithubPollCycle` (worker-only, hand-wired), `getGithubDeployStatus`
  (api read path), plus GitHub HTTP client, parsing, and `commitStateForRun`.
  Uses `env.GITHUB_ACTIONS_TOKEN` / `env.GITHUB_REPO` from `apps/api/src/env.ts`.
- Service test: `apps/api/src/__tests__/github-actions-service.test.ts`.
- Schema: `apps/api/src/db/schema.ts` — `githubRun` (l.451), `githubRunLogTail`
  (l.493), `githubPollStatus` + `GITHUB_POLL_STATUS_SINGLETON_ID` (l.501-508).
- Worker wiring: `apps/api/src/worker-deps.ts` re-exports `runGithubPollCycle`
  from `./services/github-actions-service`; `apps/worker/src/index.ts` imports
  it from `@control-center/api/worker` and registers it as a `Worker` with a
  10s tick (confirm exact registration block around line ~151).
- Registry entry to delete:
  `apps/web/src/lib/tile-registry.ts` lines 221-229 (the `tile_deploys` object
  inside `REGISTRY_ENTRIES`), plus the `DeployTile`/`DeployTileView` imports at
  the top of that file (lines ~19-20) once nothing else in the file uses them.

## VERBATIM coords + guestExposed

From `apps/web/src/lib/tile-registry.ts`:

```
id: "tile_deploys"
worldCol: 34
worldRow: 24
cols: 4
rows: 3
```

`guestExposed`: **NOT SET** — `tile_deploys` is not in the `GUEST_EXPOSED`
allowlist (`features/guest-exposed.ts`) and has no `guestExposed` flag today.
**No `GUEST_EXPOSED` allowlist edit needed.**

## Not moving (explicit — read before "helpfully" folding it)

- `apps/api/src/services/github-purge-service.ts` — retention purge for
  `github_run`/`github_run_log_tail`, called from `apps/api/src/purge.ts`
  (the daily one-shot purge bundle alongside weather/frontend-log/wake-photo
  purges — all apps/api-owned, none folded). It operates via raw
  `db.execute(sql\`...\`)` against literal table names, only *type*-imports
  `../db/schema` (`NodePgDatabase<typeof schema>`) and never references
  `schema.githubRun` as a value — so it needs **zero code changes** when
  `githubRun`/`githubRunLogTail` move out of `apps/api/src/db/schema.ts`. Physical
  Postgres table names (`github_run`, `github_run_log_tail`) are unaffected by
  which `schema.ts` file declares them. Leave this file and its test
  (`apps/api/src/__tests__/github-purge-service.test.ts`) untouched, same as
  `weather-purge-service.ts` / `frontend-log-purge-service.ts` stay app-level.
  This mirrors the guest-wifi precedent only partially: guest-wifi's purge
  moved because it got its **own db/pool**; deploys' purge stays because it
  keeps using apps/api's db and only touches tables via raw SQL.
- `DeployModalPipeline.tsx` (+ `.stories.tsx`) and the four `NetworkModal*`-style
  detail-page bodies are the **detail-page view**, distinct from the **tile
  view**. Per the network precedent, only the tile (`DeployTile.tsx` +
  `DeployTileView.tsx`) is inlined into `web.tsx`; the detail-page body stays
  under `apps/web/src/components/tiles/views/`. Repoint its two type/value
  imports from `../DeployTileView` to `@features/deploys/web` (that file only
  imports types + `CommitState`, nothing else).
- `apps/web/src/components/tiles/detail/wiring/deploys.tsx` stays under
  `apps/web/src/components/tiles/detail/wiring/` (gotcha: wiring files are not
  features/ facets even when they wire a folded feature — see `guest-wifi.tsx`
  and `views/wiring/network.tsx` precedents). Repoint its import of
  `formatAgo`/`formatElapsed`/`staleForOf`/`toModalCommits` from
  `@/components/tiles/DeployTile` to `@features/deploys/web`.

## Destination layout

```
features/deploys/
  manifest.ts   — defineApp: id, tile coords (verbatim), component/viewComponent
  web.tsx       — DeployTile + DeployTileView inlined (merge of both source files;
                  export DeployCommit/DeployRun/DeployFailure/CommitState too,
                  since DeployModalPipeline.tsx imports them)
  api.ts        — defineApi(router({ deploys: deployRouter })) via @app-kit/server
  service.ts    — github-actions-service.ts moved verbatim (imports own config
                  + own db instead of apps/api's env/db)
  service.test.ts — github-actions-service.test.ts moved
  web.test.tsx  — DeployTile.test.tsx moved (helper import path updates to "./web")
  config.ts     — GITHUB_ACTIONS_TOKEN, GITHUB_REPO, DATABASE_URL (own zod slice,
                  mirrors network/guest-wifi config.ts)
  db.ts         — own drizzle handle: createPool(config.DATABASE_URL) + schema
                  (mirrors guest-wifi/db.ts — service.ts must NOT import
                  apps/api's db, Biome-banned)
  schema.ts     — githubRun, githubRunLogTail, githubPollStatus,
                  GITHUB_POLL_STATUS_SINGLETON_ID moved verbatim
```

## Exact source → dest moves

| Source | Dest | Notes |
|---|---|---|
| `apps/web/src/components/tiles/DeployTile.tsx` | merged into `features/deploys/web.tsx` | container + helpers |
| `apps/web/src/components/tiles/DeployTileView.tsx` | merged into `features/deploys/web.tsx` | view + types + `CommitState` |
| `apps/web/src/components/tiles/__tests__/DeployTile.test.tsx` | `features/deploys/web.test.tsx` | import path `"../DeployTile"` → `"./web"` |
| `apps/api/src/trpc/routers/github.ts` | `features/deploys/api.ts` | `publicProcedure`/`router` from `@app-kit/server`, wrapped in `defineApi`; router key `github`→`deploys` (see PLACEHOLDER above) |
| `apps/api/src/services/github-actions-service.ts` | `features/deploys/service.ts` | `env.GITHUB_ACTIONS_TOKEN`/`env.GITHUB_REPO` → `config.*`; `db` import → own `./db` |
| `apps/api/src/__tests__/github-actions-service.test.ts` | `features/deploys/service.test.ts` | update import path |
| `githubRun`/`githubRunLogTail`/`githubPollStatus`/`GITHUB_POLL_STATUS_SINGLETON_ID` in `apps/api/src/db/schema.ts` (l.451-508) | `features/deploys/schema.ts` | delete from apps/api schema.ts, leave a one-line pointer comment (mirrors the portal-table comment at l.261-266) |
| (new) | `features/deploys/manifest.ts` | coords verbatim |
| (new) | `features/deploys/config.ts` | own zod slice |
| (new) | `features/deploys/db.ts` | own pool/drizzle handle |

**Files staying, edited in place** (repoint only, not moved):
- `apps/web/src/components/tiles/views/DeployModalPipeline.tsx` — import from
  `@features/deploys/web` instead of `../DeployTileView`.
- `apps/web/src/components/tiles/views/DeployModalPipeline.stories.tsx` — only
  if it imports types from `DeployTileView`/`DeployTile` directly; check.
- `apps/web/src/components/tiles/detail/wiring/deploys.tsx` — import from
  `@features/deploys/web` instead of `@/components/tiles/DeployTile`.
- `apps/web/src/lib/tile-registry.ts` — delete `DeployTile`/`DeployTileView`
  imports + the `tile_deploys` `REGISTRY_ENTRIES` object; add
  `import deploysManifest from "@features/deploys/manifest";` and append
  `deploysManifest` to `FEATURE_MANIFESTS`.
- `apps/api/src/worker-deps.ts` — `export { runGithubPollCycle } from
  "@features/deploys/service";` (repoint from `./services/github-actions-service`;
  `apps/api` importing `@features/*` is precedented, `purge.ts` already does
  this for guest-wifi).
- `apps/worker/src/index.ts` — no change if it only imports `runGithubPollCycle`
  via the `@control-center/api/worker` barrel (worker-deps.ts absorbs the
  repoint); confirm no direct path import exists.
- `apps/api/src/db/schema.ts` — delete the four moved exports, add a pointer
  comment.
- `apps/web/src/components/tiles/DeployTileView.stories.tsx` — stays under
  `apps/web/src/components/tiles/` (gotcha #3), repoint its `DeployCommit`/
  `DeployTileView` import from `"./DeployTileView"` to `"@features/deploys/web"`.

## Storybook

`DeployTileView.stories.tsx` and `DeployModalPipeline.stories.tsx` both **stay**
under `apps/web/src/components/tiles/` — only their imports move to
`@features/deploys/web`, mirroring `NetworkTileView.stories.tsx`'s
`import { NetworkTileView } from "@features/network/web";`.

## Tests: move + wire-in

Both `apps/api/vitest.config.ts` and `apps/web/vitest.config.ts` already glob
`../../features/**/{service,api}.test.ts` (node project) and
`../../features/**/web*.test.tsx` (jsdom project) respectively — **this is
generic, not per-feature**, so `features/deploys/service.test.ts` and
`features/deploys/web.test.tsx` are picked up automatically with **no config
edit needed**. Verify by running the suites (see Verify chain) — do not just
trust the glob by inspection.

The Storybook-composed test
`apps/web/src/components/tiles/__tests__/NetworkTileView.stories.test.tsx` has
no `DeployTileView` equivalent today (check — if one doesn't exist, none needs
creating; this unit is a fold, not new coverage).

## manifest.ts sketch

```ts
import { defineApp } from "@app-kit";
import { DeployTile, DeployTileView } from "./web";

/**
 * The deploys app manifest (Track C, Wave 2). defineApp is the single source
 * of truth for the tile: id, board placement (copied verbatim from the
 * pre-fold tile-registry entry), and components. Not guest-exposed. The
 * github-poll worker cycle (10s interval) stays hand-wired in apps/worker,
 * importing this feature's service directly — Seam S1 (worker-job seam) only
 * covers queue jobs, not interval cycles (roadmap decision), so there is no
 * jobs.ts here.
 */
export default defineApp({
  id: "tile_deploys",
  tile: {
    label: "Deploys",
    component: DeployTile,
    viewComponent: DeployTileView,
    worldCol: 34,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
});
```

## web.tsx skeleton

```ts
/**
 * Deploys tile (Track C, Wave 2 fold of DeployTile.tsx + DeployTileView.tsx).
 * Polls github.status (renamed from the pre-fold `github` router — see
 * api.ts) every 10s; formatting helpers are pure and re-used by the detail
 * page wiring (apps/web/src/components/tiles/detail/wiring/deploys.tsx) and
 * by the Storybook stories left under apps/web/src/components/tiles/.
 */
import { Pill, PillTone, Skeleton, Stat, Tile, TileHeader, TileStatus } from "@/components/ui";
import { POLL, useNow } from "@/lib/hooks";
import { formatSha } from "@/lib/short-sha";
import type { RouterOutputs } from "@/lib/trpc";
import { trpc } from "@/lib/trpc";
import { useTileQuery } from "@/lib/useTileQuery";

// ── types + CommitState (moved verbatim from DeployTileView.tsx) ──────────
export const CommitState = { /* ... */ } as const;
export type CommitState = (typeof CommitState)[keyof typeof CommitState];
export interface DeployCommit { /* ... */ }
export interface DeployRun { /* ... */ }
export interface DeployFailure { /* ... */ }
export type DeployTileViewProps = /* ... */;

// ── pure helpers (moved verbatim from DeployTile.tsx) ──────────────────────
export const STALE_AFTER_MS = 5 * 60 * 1000;
export const STALE_AFTER_FAILURES = 3;
export function formatAgo(iso: string, nowMs: number): string { /* ... */ }
export function formatElapsed(startedAtIso: string, nowMs: number): string { /* ... */ }
export function staleForOf(status: DeployStatus, nowMs: number): string | null { /* ... */ }
export function toModalCommits(status: DeployStatus, nowMs: number): DeployModalCommit[] { /* ... */ }

// ── view (moved verbatim from DeployTileView.tsx: CommitDot, CommitRow,
//    DeploySkeleton, headerPill, DeployTileView) ──────────────────────────
export function DeployTileView(props: DeployTileViewProps) { /* ... */ }

// ── container (moved verbatim from DeployTile.tsx, trpc.github.status →
//    trpc.deploys.status) ──────────────────────────────────────────────────
export function DeployTile() {
  const tile = useTileQuery(
    trpc.deploys.status.useQuery(undefined, { refetchInterval: POLL.deploy }),
  );
  /* ... */
}
```

## service.ts / api.ts / schema.ts / config.ts / db.ts sketches

`config.ts` (mirrors `features/network/config.ts`):
```ts
import { z } from "zod";

export const config = z
  .object({
    GITHUB_ACTIONS_TOKEN: z.string().default(""),
    GITHUB_REPO: z.string().default("0x63616c/world-wide-webb"),
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
  })
  .parse(process.env);
```

`db.ts` (mirrors `features/guest-wifi/db.ts`):
```ts
import { createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";

export const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
```

`service.ts`: `github-actions-service.ts` moved verbatim, with `env.GITHUB_*` →
`config.GITHUB_*`, and its `import { db } from "../db/index"` → `import { db }
from "./db"`. `runGithubPollCycle` and `getGithubDeployStatus` keep their
current export names (worker-deps.ts and api.ts import by name, not
default-export).

`api.ts` (mirrors `features/network/api.ts`, minus the QR helper):
```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { getGithubDeployStatus } from "./service";

const commitSchema = z.object({ /* verbatim from routers/github.ts */ });
const deployStatusSchema = z.object({ /* verbatim */ });

const deployRouter = router({
  status: publicProcedure
    .input(z.object({}).optional())
    .output(deployStatusSchema)
    .query(() => getGithubDeployStatus()),
});

export const api = defineApi(router({ deploys: deployRouter }));
```

`schema.ts`: `githubRun`, `githubRunLogTail`, `githubPollStatus`,
`GITHUB_POLL_STATUS_SINGLETON_ID` moved verbatim from
`apps/api/src/db/schema.ts` l.451-508, imports trimmed to what's used
(`pgTable`, column helpers).

## Cross-feature / worker importers to repoint (full list)

1. `apps/web/src/components/tiles/views/DeployModalPipeline.tsx` — type import.
2. `apps/web/src/components/tiles/detail/wiring/deploys.tsx` — helper import
   + `trpc.github.status` → `trpc.deploys.status` (2 call sites in that file).
3. `apps/web/src/components/tiles/DeployTileView.stories.tsx` — type/component
   import.
4. `apps/web/src/lib/tile-registry.ts` — imports + registry entry + manifest
   registration.
5. `apps/api/src/worker-deps.ts` — `runGithubPollCycle` re-export source.
6. `apps/api/src/db/schema.ts` — delete 4 exports, add pointer comment.
7. `apps/api/src/trpc/routers/index.ts` — confirmed manual mount: line 9
   `import { githubRouter } from "./github";`, line 36 `github: githubRouter,`.
   Delete both; codegen mounts `deploys` instead. Delete the now-empty
   `apps/api/src/trpc/routers/github.ts` (superseded by `features/deploys/api.ts`).
8. Any file still calling `trpc.github.*` (grep `trpc.github` across
   `apps/web/src` — expect exactly the two in `DeployTile.tsx`/
   `detail/wiring/deploys.tsx`, both already covered above; confirm no third).

Confirmed clean: `apps/worker/src/index.ts` has no direct import of
`github-actions-service` — it only imports `runGithubPollCycle` via the
`@control-center/api/worker` barrel, so `apps/api/src/worker-deps.ts` is the
only repoint needed for the worker side.

## Verify chain (run ALL, evidence required, fix-forward on red)

```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb

# 1. regenerate codegen — new manifest must be collected
bun run apps:gen

# 2. typecheck (whole repo — cd apps/api first for any api-scoped build per gotcha 7)
bun run typecheck

# 3. moved/colocated tests
bunx vitest run features/deploys/service.test.ts features/deploys/web.test.tsx
bunx vitest run apps/web/src/lib/__tests__/placeholder-tiles.test.ts   # bento 1x1 clearance
bunx vitest run apps/web/src/components/tiles/detail/__tests__        # registry completeness guard, if present
bunx vitest run apps/api/src/__tests__/github-purge-service.test.ts   # unchanged file still green

# 4. full apps:check — codegen drift + validator (dup id/router-key/table,
#    exactly 1 home tile, no tile-rect overlap, guestExposed<->allowlist)
bun run apps:check

# 5. knip — zero tolerance, no dead exports/old imports
bun run knip

# 6. lint — proves features/*->apps/api Biome boundary stays green
bun run lint
```

Before pushing (gotcha 10): `git pull --rebase --autostash`; stage EXPLICIT
paths (never `git add -A`); `git show --stat HEAD` to confirm no peer dirt; no
backticks in the commit message.

## Commit message

feat(features): fold deploys tile into features/deploys (Track C)

## Open questions / PLACEHOLDERs (consolidated)

- **PLACEHOLDER**: router key rename `github` → `deploys` — confirmed as the
  default per network/guest-wifi precedent, but flag to implementer as a
  decision point since it touches 2 frontend call sites + the wire contract.
- **PLACEHOLDER**: verify `apps/worker/src/index.ts` has no direct (non-barrel)
  import of `github-actions-service` before treating worker-deps.ts as the only
  repoint needed.
- **PLACEHOLDER**: confirm the exact file that manually mounts `githubRouter`
  today (root app-router file) so its manual mount can be deleted once codegen
  owns it — not located precisely during planning, grep for
  `routers/github`/`githubRouter` during implementation.
- **Not a placeholder, load-bearing guard**: `runGithubPollCycle` (10s interval,
  self-gating to 60s idle) stays hand-wired in `apps/worker`, imported from
  `@features/deploys/service` — this is NOT S1 (queue-job seam), do not build a
  `jobs.ts` for it.
