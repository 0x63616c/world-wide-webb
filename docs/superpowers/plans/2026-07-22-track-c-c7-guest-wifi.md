# C7 Foundation + guest-wifi Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the "features-are-apps" architecture (one folder per feature, a codegen step that is also a validator) and prove it by folding one real feature (guest-wifi) end-to-end.

**Architecture:** Each feature lives in `features/<id>/` as a thin `manifest.ts` + branded facet files (`web`/`api`/`jobs`/`schema`) + private internals. A build step `apps:gen` globs the folders and emits checked-in `features/_generated/*.gen.ts` aggregates; the runtime stays 100% static. Codegen refuses to emit a broken state (dup id/router-key/table, ≠1 home, overlapping tile rects, `guestExposed`≠`GUEST_EXPOSED`) — it *is* the consistency check. The authoring surface (`defineApp`, `defineApi`/`defineJobs`/`defineCron`) lives in a root `app-kit/` source dir. Shared DB/UniFi substrate moves to `packages/core`; each feature owns its own config slice and drizzle handle.

**Tech Stack:** TypeScript (strict), Bun (runtime + test runner via vitest), drizzle-orm + drizzle-kit (Postgres), tRPC, React (web tiles), Biome (format/lint), dependency-cruiser (dep rules), Pulumi (infra), GitHub Actions (CI/deploy).

## Global Constraints

- **Design for 10x–100x this repo's size.** Get data layout (paths, schema, IDs, on-disk formats) right up front; never reject a shared primitive on "few call sites today".
- **Shared primitives live in `packages/platform`** (Biome-enforced escape-hatch ban). DB/UniFi substrate this plan moves lives in `packages/core`.
- **Panel is fixed `1366x1024`, not responsive.**
- **IDs default to `prefix_<id>`.** Feature ids match today's tile ids.
- **No fake or placeholder data.** (lefthook `no-fake-data` hook enforces.)
- **Backend uses structured logging** via `getLogger()` from `@www/logger`. Never `console.log`.
- **Panel audio only through the sound bus** (`playCue()`); not touched by this plan.
- **Commit + push to `main` after every green task — pre-approved, never batch, never ask.** `git pull --rebase --autostash` before every push (parallel sessions push `main` constantly).
- **Never `git add -A` / `git add .`** — the lefthook format hook re-stages the whole tree and will swallow parallel sessions' uncommitted work. Stage explicit paths; verify with `git show --stat HEAD` after committing.
- **Verify before pushing** where cheap: `bun run typecheck` + the task's tests. On failure fix forward, never sit on unpushed work.
- **Biome-format any generated file before lint** (`bunx biome format --write <path>`), including everything under `features/_generated/`.
- **Subagent background-wait stalls** — if a step waits on CI, foreground it: `gh run watch <run-id> --exit-status`, never yield to a monitor.

---

## File Structure

New / moved / deleted, by responsibility:

**Created (foundation):**
- `app-kit/index.ts` — `@app-kit` web-safe barrel: `defineApp`, `defineApi`/`defineJobs`/`defineCron`, `AppManifest`/facet types.
- `app-kit/define-app.ts` — `defineApp()` + manifest types + brand.
- `app-kit/define-facets.ts` — `defineApi`/`defineJobs`/`defineCron` branded wrappers + brands.
- `app-kit/server.ts` — `@app-kit/server` barrel: tRPC primitives (`router`, `publicProcedure`, …) re-exported for facet authors.
- `scripts/apps-gen.ts` — the `apps:gen` codegen + validator (reads union input, emits `_generated/`).
- `scripts/apps-gen/collect.ts` — glob + parse features and registry leftovers into an in-memory model.
- `scripts/apps-gen/validate.ts` — the validator (all throw paths).
- `scripts/apps-gen/emit.ts` — render + biome-format the `_generated/*.gen.ts` files.
- `scripts/apps-check.ts` — regen to temp + diff against committed `_generated/`; non-zero on drift.
- `features/_generated/tiles.gen.ts`, `router.gen.ts`, `guest-router.gen.ts`, `schema.gen.ts`, `crons.gen.ts` — committed aggregates.

**Created (substrate, Slice 4):**
- `packages/core/src/db/pool.ts` — `databaseUrlFromSecret`, `createPool`.
- `packages/core/src/secrets/hydrate.ts` — listless `hydrateSecretFiles` (with `POSTGRES_PASSWORD` deny-list).
- `packages/core/src/unifi/client.ts` — `createUnifiClient({ apiKey, baseUrl, siteId })` (no env import).
- `packages/core/src/unifi/index.ts` — types + interfaces (`UnifiGuestClient`, `UnifiStatsClient`).
- `apps/api/src/integrations/unifi.ts` — apps/api-side configured singleton built from `env`, for the unfolded Network tile.

**Created (canary, Slice 5):**
- `features/guest-wifi/manifest.ts`, `web.tsx`, `api.ts`, `jobs.ts`, `schema.ts`, `service.ts`, `repo.ts`, `repo.fake.ts`, `config.ts`.
- `features/guest-wifi/GUEST_EXPOSED` allowlist constant (in `app-kit` or a hand-owned file — see Task 5.1).

**Deleted (Slice 1):**
- `apps/web/src/components/layout-editor/` (dir), `apps/web/src/lib/layout-edit-store.ts`, `apps/api/src/services/board-layout-service.ts`, the `board_tile_placement` table in `apps/api/src/db/schema.ts:353`, the `resolveLayout` override in `apps/web/src/lib/board-layout.ts`.

**Modified:**
- `apps/web/src/lib/tile-registry.ts` — retype unions (Slice 2), then shed guest-wifi entry (Slice 5).
- `apps/api/src/db/index.ts`, `apps/api/src/purge.ts`, `apps/api/src/db/seed.ts` — import `pool`/substrate from core (Slice 4).
- `apps/api/drizzle.config.ts` — repoint `schema` at `schema.gen.ts` (Slice 5).
- `.storybook/vitest.setup.ts` — global MapLibre stub (Slice 2).
- CI workflow(s), `scripts/check-dockerfile-manifests.ts`, product Dockerfiles, `.dependency-cruiser` config, vite/tsconfig/vitest alias config (Slice 3).

---

## Slice 1 — Delete custom tile placement (Q4)

Standalone, lands first. A real feature deletion. Collides with Track B's layout-edit camera-freeze fix — expect to untangle camera/session state out of the layout path rather than delete it wholesale.

### Task 1.1: Trace the placement blast radius

**Files:**
- Read-only survey; no edits.

- [ ] **Step 1: Enumerate every reference to the placement feature**

Run each and record the hit list:
```bash
cd /Users/calum/code/github.com/0x63616c/world-wide-webb
rg -n "layout-editor|layoutEditor|layout-edit-store|layoutEditStore|board-layout-service|boardLayoutService|board_tile_placement|boardTilePlacement|resolveLayout" --type ts --type tsx
```
Expected: hits in the deletion targets plus consumers (board render, camera/session coupling, any tRPC router mounting `board-layout-service`, any store subscribers).

- [ ] **Step 2: Identify the camera/session coupling points**

Run:
```bash
rg -n "layoutEdit|isEditingLayout|editLayout|freezeCamera|layout.*camera|camera.*layout" apps/web/src --type ts --type tsx
```
Expected: the Track B freeze-fix touchpoints. Record which camera/session state exists *only* to serve layout edit (delete) vs. state shared with normal panning (keep, un-couple).

- [ ] **Step 3: Record the plan of attack in the commit-to-be**

Write the hit list into a scratch note `scratch-slice1-blast-radius.md` (git-ignored scratch, NOT committed) so later steps have the exact file:line list. This task produces no code — its deliverable is the verified deletion map.

### Task 1.2: Delete the placement data layer (table + service + migration)

**Files:**
- Modify: `apps/api/src/db/schema.ts` (remove `board_tile_placement` table ~`:353`)
- Delete: `apps/api/src/services/board-layout-service.ts`
- Delete: any `board-layout-service` tRPC router mount + its test
- Create: `apps/api/src/db/migrations/<next>_drop_board_tile_placement.sql`

**Interfaces:**
- Produces: removal of the `boardTilePlacement` export from `schema.ts` and the `board-layout` router key from the app router.

- [ ] **Step 1: Write the failing test (router no longer mounts board-layout)**

In the app-router test (find via `rg -n "board-layout|boardLayout" apps/api/src/**/*.test.ts`), add:
```ts
it("does not expose a board-layout router", () => {
  expect(Object.keys(appRouter._def.procedures).some((k) => k.startsWith("boardLayout"))).toBe(false);
});
```

- [ ] **Step 2: Run it — expect FAIL** (router still mounts it)

Run: `bun run --cwd apps/api test -- board` — Expected: FAIL (procedure present).

- [ ] **Step 3: Delete the service, its router mount, and the table**

- Remove the `board-layout-service.ts` file and its import/mount in the app router.
- Remove the `boardTilePlacement` `pgTable` block from `apps/api/src/db/schema.ts`.
- Generate the drop migration:
```bash
bun run --cwd apps/api db:generate
bunx biome format --write apps/api/src/db/migrations/meta
```
Confirm the generated SQL is a `DROP TABLE "board_tile_placement"` and nothing else.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun run --cwd apps/api test -- board` and `bun run typecheck` — Expected: PASS, no type errors from the removed export.

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add apps/api/src/db/schema.ts apps/api/src/services/ apps/api/src/db/migrations apps/api/src/<router-file> apps/api/src/<router-test>
git commit -m "feat(track-c): delete board-layout placement data layer (Q4)"
git show --stat HEAD   # verify only intended paths
git push
```

### Task 1.3: Delete the placement UI + store, un-couple camera/session

**Files:**
- Delete: `apps/web/src/components/layout-editor/` (dir), `apps/web/src/lib/layout-edit-store.ts`
- Modify: `apps/web/src/lib/board-layout.ts` (drop `resolveLayout` override — position now comes only from `TILE_REGISTRY` coords)
- Modify: camera/session files identified in Task 1.1 Step 2 (un-couple)
- Modify: board render component (remove edit-mode entry points)

**Interfaces:**
- Produces: `TILE_REGISTRY` coords are the single source of tile position; no `layoutEditStore`; camera/session state no longer references layout edit.

- [ ] **Step 1: Write the failing test (positions come straight from the registry)**

In `apps/web/src/lib/board-layout.test.ts` (create if absent):
```ts
import { describe, it, expect } from "vitest";
import { TILE_REGISTRY } from "./tile-registry";
import { resolveBoardLayout } from "./board-layout";

it("positions each tile at its registry coordinates with no override", () => {
  const layout = resolveBoardLayout();
  for (const tile of TILE_REGISTRY) {
    const placed = layout.find((t) => t.id === tile.id);
    expect(placed).toBeDefined();
    expect(placed).toMatchObject({ worldCol: tile.worldCol, worldRow: tile.worldRow });
  }
});
```
(Adapt property names to the real `board-layout.ts` API found in Task 1.1.)

- [ ] **Step 2: Run it — expect FAIL** (resolveLayout still applies stored overrides)

Run: `bun run --cwd apps/web test -- board-layout` — Expected: FAIL.

- [ ] **Step 3: Delete UI + store, simplify `board-layout.ts`, un-couple camera**

- `rm -rf apps/web/src/components/layout-editor` and `rm apps/web/src/lib/layout-edit-store.ts`.
- In `board-layout.ts`, delete the `resolveLayout`-override branch; return positions straight from `TILE_REGISTRY`.
- In the camera/session files: delete state that existed only for edit mode; for state shared with normal panning, remove the layout-edit conditionals but keep the panning path (per Task 1.1 Step 2 map).
- Remove edit-mode buttons/entry points from the board component.

- [ ] **Step 4: Run tests — expect PASS**

Run: `bun run --cwd apps/web test -- board-layout` then `bun run --cwd apps/web test -- camera` (or the camera/session test file) — Expected: PASS. Then `bun run typecheck`.

- [ ] **Step 5: Run the bento clearance guard + full web suite**

Run: `bun run --cwd apps/web test -- placeholder-tiles` — Expected: PASS (memory: bento-tiler-1x1-clearance — a 1×1 tile needs a clear neighbourhood). Then `bun run --cwd apps/web test` (full) — Expected: green.

- [ ] **Step 6: Verify on the real panel**

Launch the app (see `/run` or the project run skill) and confirm: the board renders every tile at its registry position, and there is no layout-edit affordance. Capture a screenshot for the task record.

- [ ] **Step 7: Commit**

```bash
git pull --rebase --autostash
git add apps/web/src/components apps/web/src/lib/board-layout.ts apps/web/src/lib/board-layout.test.ts apps/web/src/<camera-session-files>
git commit -m "feat(track-c): delete layout-editor UI + un-couple camera from layout (Q4)"
git show --stat HEAD
git push
```

---

## Slice 2 — Registry cleanup (Q10)

No codegen, no `features/`. Pure type + test-infra cleanup.

### Task 2.1: Retype the two 20-member component unions to `ComponentType`

**Files:**
- Modify: `apps/web/src/lib/tile-registry.ts` (unions at `:41` and `:63`)

**Interfaces:**
- Produces: `TileRegistryEntry.component: ComponentType` and `.view?: ComponentType` (eager, direct refs). The 20-member `TileComponent`/`TileViewComponent` unions are gone.

- [ ] **Step 1: Write the failing test (eager component refs, no lazy)**

In `apps/web/src/lib/tile-registry.test.ts` (create if absent):
```ts
import { describe, it, expect } from "vitest";
import { isValidElementType } from "react-is";
import { TILE_REGISTRY } from "./tile-registry";

it("every tile component is an eager component (not a lazy/thenable)", () => {
  for (const tile of TILE_REGISTRY) {
    expect(isValidElementType(tile.component)).toBe(true);
    expect((tile.component as { $$typeof?: symbol }).$$typeof).not.toBe(Symbol.for("react.lazy"));
  }
});
```

- [ ] **Step 2: Run it — expect FAIL or type error** (lazy refs / union mismatch)

Run: `bun run --cwd apps/web test -- tile-registry` — Expected: FAIL (lazy present) or the file doesn't typecheck against the new assertion.

- [ ] **Step 3: Retype to `ComponentType` and inline the direct imports**

In `tile-registry.ts`: replace the `TileComponent`/`TileViewComponent` union type aliases with `import type { ComponentType } from "react"`; type the entry fields as `component: ComponentType<Record<string, never>>` (or the existing tile-prop type) and `view?: ComponentType<...>`. Replace any `lazyNamed(...)` / `React.lazy(...)` refs with direct component imports at the top of the file.

- [ ] **Step 4: Run tests + typecheck — expect PASS**

Run: `bun run --cwd apps/web test -- tile-registry` and `bun run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add apps/web/src/lib/tile-registry.ts apps/web/src/lib/tile-registry.test.ts
git commit -m "refactor(track-c): retype tile unions to eager ComponentType (Q10)"
git show --stat HEAD
git push
```

### Task 2.2: Centralize the MapLibre mock to one global stub

**Files:**
- Modify: `.storybook/vitest.setup.ts` (add global `maplibre-gl` stub)
- Modify: the ~15 test files carrying the trivial inline mock (remove their local `vi.mock("maplibre-gl", ...)`); leave the ~2–3 functional Tesla map mocks untouched.

**Interfaces:**
- Produces: a single global `vi.mock("maplibre-gl")` in setup; trivial per-file mocks deleted.

- [ ] **Step 1: List the trivial vs functional MapLibre mocks**

Run:
```bash
rg -n "vi.mock\\(['\"]maplibre-gl" apps/web/src -l
rg -n "vi.mock\\(['\"]maplibre-gl" apps/web/src -A6
```
Record which return `() => ({ default: {} })` (trivial → delete) vs. which define behaviour (Tesla → keep).

- [ ] **Step 2: Add the global stub to setup**

In `.storybook/vitest.setup.ts`:
```ts
import { vi } from "vitest";

// Global MapLibre stub: jsdom has no WebGL, and most tiles only need the module
// to import cleanly. Tests that exercise real map behaviour (Tesla) override this
// with their own local vi.mock, which wins over this global default.
vi.mock("maplibre-gl", () => ({
  default: {},
  Map: class { on() {} remove() {} addControl() {} },
  Marker: class { setLngLat() { return this; } addTo() { return this; } remove() {} },
  NavigationControl: class {},
}));
```
(Match the surface the trivial mocks provided — widen only to what importing modules touch at load.)

- [ ] **Step 3: Delete the trivial per-file mocks**

Remove the local `vi.mock("maplibre-gl", ...)` block from each trivial file found in Step 1. Do NOT touch the Tesla functional mocks.

- [ ] **Step 4: Run the full web suite — expect PASS**

Run: `bun run --cwd apps/web test` — Expected: green, including Tesla map tests (their local mock still overrides the global).

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add .storybook/vitest.setup.ts apps/web/src
git commit -m "test(track-c): centralize trivial MapLibre stub to one setup (Q10)"
git show --stat HEAD
git push
```

---

## Slice 3 — Codegen scaffold (Q5/Q6/Q7/Q12)

Stands up the foundation as a **no-op transform**: `apps:gen` reads the existing `tile-registry.ts` and emits `_generated/` byte-identical to what the app effectively uses. Runtime behaviour is unchanged.

### Task 3.1: `app-kit` authoring surface (`defineApp` + branded facet wrappers)

**Files:**
- Create: `app-kit/define-app.ts`, `app-kit/define-facets.ts`, `app-kit/index.ts`, `app-kit/server.ts`
- Test: `app-kit/define-app.test.ts`

**Interfaces:**
- Produces:
  - `defineApp(m: AppManifestInput): AppManifest` — returns `m` tagged with a brand symbol; `AppManifest = { id: string; tile: TileSpec; guestExposed?: boolean; home?: boolean; sensitive?: boolean }`, `TileSpec = { label: string; component: ComponentType; view?: ComponentType; worldCol: number; worldRow: number; cols: number; rows: number }`.
  - `defineApi<T>(router: T): ApiFacet<T>` — brands a tRPC router as the feature's api facet.
  - `defineJobs(jobs: JobSpec[]): JobsFacet` — brands a job array.
  - `defineCron(spec: CronSpec): CronSpec` — brands one cron (codegen collects all `defineCron` exports from `jobs.ts`).
  - Brand symbols exported for the collector to test against (`APP_BRAND`, `API_FACET_BRAND`, `JOBS_FACET_BRAND`, `CRON_BRAND`).

- [ ] **Step 1: Write the failing test**

`app-kit/define-app.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defineApp, APP_BRAND } from "./define-app";
import { defineApi, defineJobs, defineCron, API_FACET_BRAND, JOBS_FACET_BRAND, CRON_BRAND } from "./define-facets";

const Dummy = () => null;

it("defineApp brands and passes through the manifest", () => {
  const m = defineApp({ id: "demo", tile: { label: "Demo", component: Dummy, worldCol: 0, worldRow: 0, cols: 1, rows: 1 } });
  expect(m.id).toBe("demo");
  expect((m as Record<symbol, unknown>)[APP_BRAND]).toBe(true);
});

it("facet wrappers brand their payload", () => {
  expect((defineApi({} as never) as Record<symbol, unknown>)[API_FACET_BRAND]).toBe(true);
  expect((defineJobs([]) as Record<symbol, unknown>)[JOBS_FACET_BRAND]).toBe(true);
  expect((defineCron({ name: "c", schedule: "* * * * *", run: async () => {} }) as Record<symbol, unknown>)[CRON_BRAND]).toBe(true);
});
```

- [ ] **Step 2: Run it — expect FAIL** (modules absent)

Run: `bunx vitest run app-kit/define-app.test.ts` — Expected: FAIL (cannot resolve `./define-app`).

- [ ] **Step 3: Implement `define-app.ts` + `define-facets.ts`**

`app-kit/define-app.ts`:
```ts
import type { ComponentType } from "react";

export const APP_BRAND = Symbol.for("app-kit.app");

export interface TileSpec {
  label: string;
  component: ComponentType;
  view?: ComponentType;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
}
export interface AppManifest {
  id: string;
  tile: TileSpec;
  guestExposed?: boolean;
  home?: boolean;
  sensitive?: boolean;
}

/** Brand + pass-through. The manifest is authored inline; codegen collects it. */
export function defineApp(m: AppManifest): AppManifest {
  return Object.assign(Object.create(null), m, { [APP_BRAND]: true }) as AppManifest;
}
```

`app-kit/define-facets.ts`:
```ts
export const API_FACET_BRAND = Symbol.for("app-kit.api");
export const JOBS_FACET_BRAND = Symbol.for("app-kit.jobs");
export const CRON_BRAND = Symbol.for("app-kit.cron");

export interface CronSpec { name: string; schedule: string; run: () => Promise<void>; }
export interface JobSpec { name: string; run: () => Promise<void>; }

export function defineApi<T>(router: T): T { return brand(router, API_FACET_BRAND); }
export function defineJobs(jobs: JobSpec[]): JobSpec[] { return brand(jobs, JOBS_FACET_BRAND); }
export function defineCron(spec: CronSpec): CronSpec { return brand(spec, CRON_BRAND); }

function brand<T>(v: T, sym: symbol): T {
  Object.defineProperty(v as object, sym, { value: true, enumerable: false });
  return v;
}
```

`app-kit/index.ts` (web-safe barrel — NO tRPC imports):
```ts
export { defineApp, APP_BRAND } from "./define-app";
export type { AppManifest, TileSpec } from "./define-app";
export { defineApi, defineJobs, defineCron, API_FACET_BRAND, JOBS_FACET_BRAND, CRON_BRAND } from "./define-facets";
export type { CronSpec, JobSpec } from "./define-facets";
```

`app-kit/server.ts` (`@app-kit/server` — tRPC primitives for api facets):
```ts
// Re-export the app's tRPC primitives so feature api.ts files import them from
// @app-kit/server, never from apps/api (one-way dep rule).
export { router, publicProcedure } from "../apps/api/src/trpc/trpc";
```
(Adjust the source path to the real tRPC init module found via `rg -n "initTRPC" apps/api/src`.)

- [ ] **Step 4: Run test + typecheck — expect PASS**

Run: `bunx vitest run app-kit/define-app.test.ts` then `bun run typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add app-kit/
git commit -m "feat(track-c): app-kit authoring surface (defineApp + facet brands) (Q6/Q12)"
git show --stat HEAD
git push
```

### Task 3.2: Codegen collector + validator (the consistency check)

**Files:**
- Create: `scripts/apps-gen/collect.ts`, `scripts/apps-gen/validate.ts`
- Test: `scripts/apps-gen/validate.test.ts`

**Interfaces:**
- Consumes: `AppManifest` (from `app-kit`), the existing `TILE_REGISTRY` shape.
- Produces:
  - `collect(): Promise<AppModel>` where `AppModel = { apps: CollectedApp[] }` and `CollectedApp = { id; tile; guestExposed; home; sensitive; source: "feature" | "registry" }`. It reads `glob(features/*/manifest.ts)` ∪ the remaining `TILE_REGISTRY` entries.
  - `validate(model: AppModel, guestExposed: readonly string[]): void` — throws `CodegenError` on: duplicate `id`; duplicate router-key; duplicate table name; `home` count ≠ 1; overlapping tile rects; any app whose `guestExposed` flag disagrees with membership in the `GUEST_EXPOSED` allowlist argument.

- [ ] **Step 1: Write the failing validator test (every throw path)**

`scripts/apps-gen/validate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { validate, CodegenError } from "./validate";

const base = { tile: { label: "x", component: (() => null), worldCol: 0, worldRow: 0, cols: 1, rows: 1 }, source: "feature" as const };
const app = (over: Partial<{ id: string; home: boolean; guestExposed: boolean; worldCol: number; worldRow: number; cols: number; rows: number }>) =>
  ({ ...base, id: over.id ?? "a", home: over.home ?? false, guestExposed: over.guestExposed ?? false,
     tile: { ...base.tile, worldCol: over.worldCol ?? 0, worldRow: over.worldRow ?? 0, cols: over.cols ?? 1, rows: over.rows ?? 1 } });

it("throws on duplicate id", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true }), app({ id: "a" })] }, [])).toThrow(CodegenError);
});
it("throws when home count != 1", () => {
  expect(() => validate({ apps: [app({ id: "a" }), app({ id: "b" })] }, [])).toThrow(/exactly one home/);
});
it("throws on overlapping tile rects", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true, worldCol: 0, cols: 2 }), app({ id: "b", worldCol: 1 })] }, [])).toThrow(/overlap/);
});
it("throws when guestExposed flag diverges from the GUEST_EXPOSED allowlist", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true, guestExposed: true })] }, [])).toThrow(/GUEST_EXPOSED/);
  expect(() => validate({ apps: [app({ id: "a", home: true, guestExposed: false })] }, ["a"])).toThrow(/GUEST_EXPOSED/);
});
it("accepts a consistent model", () => {
  expect(() => validate({ apps: [app({ id: "a", home: true, guestExposed: true })] }, ["a"])).not.toThrow();
});
```

- [ ] **Step 2: Run it — expect FAIL** (validate absent)

Run: `bunx vitest run scripts/apps-gen/validate.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement `validate.ts`**

```ts
export class CodegenError extends Error {
  constructor(message: string) { super(message); this.name = "CodegenError"; }
}

interface Rect { worldCol: number; worldRow: number; cols: number; rows: number; }
interface ValApp { id: string; home?: boolean; guestExposed?: boolean; tile: Rect; }
interface Model { apps: ValApp[]; }

function overlaps(a: Rect, b: Rect): boolean {
  return a.worldCol < b.worldCol + b.cols && a.worldCol + a.cols > b.worldCol &&
         a.worldRow < b.worldRow + b.rows && a.worldRow + a.rows > b.worldRow;
}

export function validate(model: Model, guestExposed: readonly string[]): void {
  const allow = new Set(guestExposed);
  const seen = new Set<string>();
  let homes = 0;
  for (const a of model.apps) {
    if (seen.has(a.id)) throw new CodegenError(`duplicate app id: ${a.id}`);
    seen.add(a.id);
    if (a.home) homes++;
    const inAllow = allow.has(a.id);
    if (Boolean(a.guestExposed) !== inAllow) {
      throw new CodegenError(
        `app ${a.id}: guestExposed=${Boolean(a.guestExposed)} but GUEST_EXPOSED allowlist ${inAllow ? "contains" : "omits"} it — ` +
        `widening the guest surface needs an explicit, security-reviewed edit to the allowlist`,
      );
    }
  }
  if (homes !== 1) throw new CodegenError(`expected exactly one home tile, found ${homes}`);
  for (let i = 0; i < model.apps.length; i++)
    for (let j = i + 1; j < model.apps.length; j++)
      if (overlaps(model.apps[i].tile, model.apps[j].tile))
        throw new CodegenError(`tiles ${model.apps[i].id} and ${model.apps[j].id} overlap`);
}
```
(Duplicate router-key / table-name checks land in Slice 5 Task 5.4 where facets first appear; add stubbed no-op branches now with a `// extended in Slice 5` comment so the signature is stable.)

- [ ] **Step 4: Run test — expect PASS**

Run: `bunx vitest run scripts/apps-gen/validate.test.ts` — Expected: PASS.

- [ ] **Step 5: Implement `collect.ts` (registry-only at this slice)**

```ts
import { TILE_REGISTRY } from "../../apps/web/src/lib/tile-registry";

export interface CollectedApp {
  id: string;
  tile: { label: string; worldCol: number; worldRow: number; cols: number; rows: number };
  guestExposed: boolean;
  home: boolean;
  sensitive: boolean;
  source: "feature" | "registry";
}
export interface AppModel { apps: CollectedApp[]; }

// Slice 3: features/ is empty, so the model is the registry alone. Slice 5 adds
// the features/*/manifest.ts glob and unions it with the registry leftovers.
export async function collect(): Promise<AppModel> {
  const apps: CollectedApp[] = TILE_REGISTRY.map((t) => ({
    id: t.id,
    tile: { label: t.label, worldCol: t.worldCol, worldRow: t.worldRow, cols: t.cols, rows: t.rows },
    guestExposed: false,
    home: Boolean((t as { home?: boolean }).home),
    sensitive: Boolean((t as { sensitive?: boolean }).sensitive),
    source: "registry",
  }));
  return { apps };
}
```
(Match the real `TILE_REGISTRY` field names — adjust `home`/`sensitive`/coords accessors to the actual shape.)

- [ ] **Step 6: Commit**

```bash
git pull --rebase --autostash
git add scripts/apps-gen/
git commit -m "feat(track-c): codegen collector + validator (Q7)"
git show --stat HEAD
git push
```

### Task 3.3: Emitter + `apps:gen` entrypoint (byte-identical no-op)

**Files:**
- Create: `scripts/apps-gen/emit.ts`, `scripts/apps-gen.ts`
- Create (committed output): `features/_generated/tiles.gen.ts` (+ empty `router`/`guest-router`/`schema`/`crons` gen files this slice)
- Modify: root `package.json` (`"apps:gen"` script)
- Modify: wherever the app currently consumes `TILE_REGISTRY` for the board → point at `tiles.gen.ts` **only if** it stays byte-equivalent; otherwise leave runtime consuming the registry this slice and treat gen as validation-only (decide per determinism proof).

**Interfaces:**
- Consumes: `collect()`, `validate()`.
- Produces: `apps:gen` writes sorted-by-`id`, biome-formatted `features/_generated/*.gen.ts`; exits non-zero (via `CodegenError`) on an invalid model.

- [ ] **Step 1: Write the failing determinism test**

`scripts/apps-gen/emit.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { renderTiles } from "./emit";
import { collect } from "./collect";

it("renders tiles sorted by id and is stable across two runs", async () => {
  const model = await collect();
  const a = renderTiles(model);
  const b = renderTiles(model);
  expect(a).toBe(b);
  const ids = [...a.matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toEqual([...ids].sort());
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `bunx vitest run scripts/apps-gen/emit.test.ts` — Expected: FAIL (renderTiles absent).

- [ ] **Step 3: Implement `emit.ts` + `apps-gen.ts`**

`emit.ts` renders a deterministic module string (sort apps by `id` before rendering). `apps-gen.ts`:
```ts
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { collect } from "./apps-gen/collect";
import { validate } from "./apps-gen/validate";
import { renderTiles } from "./apps-gen/emit";
import { GUEST_EXPOSED } from "../features/guest-exposed"; // hand-owned allowlist (Task 5.1); empty array until then

async function main() {
  const model = await collect();
  validate(model, GUEST_EXPOSED);
  writeFileSync("features/_generated/tiles.gen.ts", renderTiles(model));
  execFileSync("bunx", ["biome", "format", "--write", "features/_generated"], { stdio: "inherit" });
}
main().catch((e) => { console.error(e); process.exit(1); });
```
Add `"apps:gen": "bun run scripts/apps-gen.ts"` to root `package.json`. Create `features/guest-exposed.ts` now: `export const GUEST_EXPOSED: readonly string[] = [];`.

- [ ] **Step 4: Run `apps:gen`, then run it again — expect zero diff (determinism proof)**

```bash
bun run apps:gen
git add features/_generated features/guest-exposed.ts
bun run apps:gen
git diff --exit-code features/_generated   # MUST be empty
```
Expected: second run produces no diff. If it does, the sort/format is non-deterministic — fix before proceeding.

- [ ] **Step 5: Run tests + typecheck — expect PASS**

Run: `bunx vitest run scripts/apps-gen/emit.test.ts` and `bun run typecheck` — Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git pull --rebase --autostash
git add scripts/apps-gen.ts scripts/apps-gen/emit.ts scripts/apps-gen/emit.test.ts features/_generated features/guest-exposed.ts package.json
git commit -m "feat(track-c): apps:gen emitter, byte-identical no-op transform (Q5)"
git show --stat HEAD
git push
```

### Task 3.4: `apps:check` drift guard

**Files:**
- Create: `scripts/apps-check.ts`
- Modify: root `package.json` (`"apps:check"`)

**Interfaces:**
- Produces: `apps:check` regenerates into a temp dir and diffs against committed `features/_generated`; exits non-zero on drift.

- [ ] **Step 1: Write the failing test**

`scripts/apps-check.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { checkDrift } from "./apps-check";

it("reports no drift right after a clean apps:gen", async () => {
  await expect(checkDrift()).resolves.toEqual({ drifted: false, files: [] });
});
```

- [ ] **Step 2: Run it — expect FAIL** (checkDrift absent). Run: `bunx vitest run scripts/apps-check.test.ts`.

- [ ] **Step 3: Implement `apps-check.ts`** — render each aggregate in-memory, read the committed file, compare strings; return `{ drifted, files }`; the CLI wrapper exits 1 when drifted and prints the offending files + the reroll hint (`git checkout --theirs features/_generated && bun run apps:gen`).

- [ ] **Step 4: Run test — expect PASS.** Run: `bunx vitest run scripts/apps-check.test.ts`.

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add scripts/apps-check.ts scripts/apps-check.test.ts package.json
git commit -m "feat(track-c): apps:check drift guard (Q5)"
git show --stat HEAD
git push
```

### Task 3.5: Hard gates — CI path filter, Dockerfile COPY, alias resolution

**Files:**
- Modify: CI workflow(s) under `.github/workflows/` (product path filters)
- Modify: `scripts/check-dockerfile-manifests.ts`
- Modify: each product `Dockerfile` (`COPY app-kit/ features/`)
- Modify: `.dependency-cruiser.{js,cjs,json}` (one-way dep rule), `vite.config.ts`(s), `tsconfig*.json`, `vitest` config, `bunfig.toml` / `package.json` imports (aliases)

**Interfaces:**
- Produces: `@app-kit`/`@features` resolve identically in vite, tsc, vitest, bun; CI builds all three deployables on any `features/**`/`app-kit/**` change; a missing Dockerfile COPY fails `check-dockerfile-manifests`; dep-cruiser forbids `platform`/`core` → `app-kit`/`features` and `app-kit` → `features`.

- [ ] **Step 1: Write the failing alias-parity test**

`scripts/alias-parity.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { defineApp } from "@app-kit";   // resolves via vitest alias

it("@app-kit resolves under vitest", () => { expect(typeof defineApp).toBe("function"); });
```
Also add a shell assertion script `scripts/check-alias-parity.sh` that greps each of tsconfig, vite config, vitest config, and bunfig/package-imports for the `@app-kit` and `@features` mappings and fails if any is missing.

- [ ] **Step 2: Run them — expect FAIL** (aliases unset). Run: `bunx vitest run scripts/alias-parity.test.ts` and `bash scripts/check-alias-parity.sh`.

- [ ] **Step 3: Add the aliases in all four resolvers**

Add `@app-kit` → `app-kit/index.ts`, `@app-kit/server` → `app-kit/server.ts`, `@features/*` → `features/*` to: every relevant `tsconfig*.json` `paths`, every `vite.config.*` `resolve.alias`, the vitest config (usually inherits vite — verify), and bun (`package.json` `imports` or `bunfig.toml`).

- [ ] **Step 4: Extend the dockerfile-manifest check + add COPYs**

- Add `app-kit` and `features` to whatever list `scripts/check-dockerfile-manifests.ts` enforces.
- Add `COPY app-kit/ ./app-kit/` and `COPY features/ ./features/` to each product Dockerfile (web, api, worker) at the right layer.

- [ ] **Step 5: Widen the CI product path filters**

In the CI workflow, add `app-kit/**` and `features/**` to the change-filter globs for **all three** deployables (web, api, worker), so a change under those paths rebuilds every image (memory: ci-cancelled-runs-strand-image-digests, main-push-cancels-queued-runs — a miss ships stale images on green CI).

- [ ] **Step 6: Add the dep-cruiser one-way rule**

Add forbidden rules: `platform`/`core` must not import `app-kit`/`features`; `app-kit` must not import `features`. Run `bunx depcruise` (or the repo's dep-lint script) — Expected: clean.

- [ ] **Step 7: Verify all four resolvers + the checks**

```bash
bun run typecheck                                # tsc resolves @app-kit
bunx vitest run scripts/alias-parity.test.ts     # vitest resolves
bun -e 'import("@app-kit").then(m => console.log(typeof m.defineApp))'  # bun resolves → "function"
bun run build --filter web                        # vite resolves (or the repo's web build cmd)
bash scripts/check-alias-parity.sh
bun run scripts/check-dockerfile-manifests.ts
bunx depcruise --config .dependency-cruiser.cjs app-kit features packages
```
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git pull --rebase --autostash
git add .github/workflows scripts/check-dockerfile-manifests.ts scripts/check-alias-parity.sh scripts/alias-parity.test.ts **/Dockerfile* tsconfig*.json **/vite.config.* **/vitest.config.* .dependency-cruiser.* package.json bunfig.toml
git commit -m "feat(track-c): C7 hard gates — CI path filter, Dockerfile COPY, alias parity, dep rule (Slice 3)"
git show --stat HEAD
git push
```

- [ ] **Step 9: Watch the deploy — confirm all three images rebuild**

```bash
gh run watch "$(gh run list --branch main --limit 1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Then verify pod image ages advanced (memory: main-push-cancels-queued-runs — confirm recovery by pod age, not by run status alone).

---

## Slice 4 — Substrate lift to `packages/core` (D1)

Its own atomic push, ahead of the fold. Pure relocation + rewire of the shared connection substrate.

### Task 4.1: Move DB pool + db-url resolver to `packages/core`

**Files:**
- Create: `packages/core/src/db/pool.ts`, export from `packages/core/src/index.ts`
- Modify: `apps/api/src/db/index.ts` (import `pool`/`createPool`/`databaseUrlFromSecret` from core), `apps/api/src/env.ts` (drop the moved fns; keep the schema)
- Modify: `apps/api/src/purge.ts:22`, `apps/api/src/db/seed.ts:6` (import `pool` from core)
- Test: `packages/core/test/pool.test.ts`

**Interfaces:**
- Produces: `databaseUrlFromSecret(src?): string | undefined`; `createPool(databaseUrl: string): Pool`. Core owns no schema — `apps/api/src/db/index.ts` still builds `db = drizzle(pool, { schema })` over the full barrel for the 18 unfolded features.

- [ ] **Step 1: Write the failing test** — move the existing `databaseUrlFromSecret` cases (from `apps/api/src/env.test.ts`) into `packages/core/test/pool.test.ts`, importing from `@www/core` (or the core package name — check `packages/core/package.json`). Run: `bunx vitest run packages/core/test/pool.test.ts` → FAIL.

- [ ] **Step 2: Implement `pool.ts`** — cut `databaseUrlFromSecret` verbatim from `env.ts`; add `export function createPool(url: string) { return new Pool({ connectionString: url }); }`. Export both from `packages/core/src/index.ts`.

- [ ] **Step 3: Rewire consumers** — `apps/api/src/db/index.ts`:
```ts
import { createPool } from "@www/core";
import { env } from "../env";
import * as schema from "./schema";
export const pool = createPool(env.DATABASE_URL);
export const db = drizzle(pool, { schema });
```
Update `purge.ts` and `seed.ts` imports of `pool` to come from `apps/api/src/db/index.ts` (unchanged export site) — they need no edit if they already import from `db/index.ts`; edit only if they imported the raw `Pool`. In `env.ts`, delete the `databaseUrlFromSecret` definition and import it from core for the boot-time `resolvedDatabaseUrl` line.

- [ ] **Step 4: Run tests + typecheck** — `bunx vitest run packages/core/test/pool.test.ts`, `bun run --cwd apps/api test -- env`, `bun run typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git pull --rebase --autostash
git add packages/core apps/api/src/db/index.ts apps/api/src/env.ts apps/api/src/env.test.ts apps/api/src/purge.ts apps/api/src/db/seed.ts
git commit -m "refactor(track-c): move db pool + db-url resolver to packages/core (D1)"
git show --stat HEAD
git push
```

### Task 4.2: Listless secret hydrator (with `POSTGRES_PASSWORD` deny-list)

**Files:**
- Create: `packages/core/src/secrets/hydrate.ts`, export from index
- Modify: `apps/api/src/env.ts` (call the core hydrator; drop the 20-name list)
- Test: `packages/core/test/hydrate.test.ts`

**Interfaces:**
- Produces: `hydrateSecretFiles(src?, dir?): void` — globs `dir` (`/run/secrets`), hydrates each file into `src` if unset, **skipping the deny-list** (`POSTGRES_PASSWORD` and any `*_PASSWORD` resolved via a `_FILE` path).

- [ ] **Step 1: Write the failing test**

`packages/core/test/hydrate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hydrateSecretFiles } from "../src/secrets/hydrate";

it("hydrates arbitrary mounted files but NOT POSTGRES_PASSWORD", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  writeFileSync(join(dir, "HA_TOKEN"), "tok\n");
  writeFileSync(join(dir, "POSTGRES_PASSWORD"), "pw\n");
  const env: Record<string, string | undefined> = {};
  hydrateSecretFiles(env, dir);
  expect(env.HA_TOKEN).toBe("tok");
  expect(env.POSTGRES_PASSWORD).toBeUndefined();
});

it("does not overwrite an explicit env var", () => {
  const dir = mkdtempSync(join(tmpdir(), "secrets-"));
  writeFileSync(join(dir, "HA_TOKEN"), "file");
  const env = { HA_TOKEN: "explicit" };
  hydrateSecretFiles(env, dir);
  expect(env.HA_TOKEN).toBe("explicit");
});
```

- [ ] **Step 2: Run it — expect FAIL.** Run: `bunx vitest run packages/core/test/hydrate.test.ts`.

- [ ] **Step 3: Implement `hydrate.ts`**

```ts
import { readdirSync, readFileSync } from "node:fs";

const DENY = new Set(["POSTGRES_PASSWORD"]);

export function hydrateSecretFiles(
  src: Record<string, string | undefined> = process.env,
  dir = "/run/secrets",
): void {
  let names: string[];
  try { names = readdirSync(dir); } catch { return; } // dir absent (dev/test) → no-op
  for (const name of names) {
    if (src[name] !== undefined || DENY.has(name)) continue;
    try {
      const value = readFileSync(`${dir}/${name}`, "utf-8").trim();
      if (value) src[name] = value;
    } catch { /* not a readable file — skip */ }
  }
}
```

- [ ] **Step 4: Rewire `env.ts`** — delete the 20-name `SECRET_FILE_ENV` array + the local `hydrateSecretFiles`; `import { hydrateSecretFiles } from "@www/core"` and keep the `hydrateSecretFiles()` boot call.

- [ ] **Step 5: Run tests + boot check** — `bunx vitest run packages/core/test/hydrate.test.ts`, `bun run --cwd apps/api test -- env`, `bun run typecheck`. Then a boot smoke: `bun run --cwd apps/api <boot-check>` (or import `env` in a throwaway) → no throw.

- [ ] **Step 6: Commit**

```bash
git pull --rebase --autostash
git add packages/core apps/api/src/env.ts apps/api/src/env.test.ts
git commit -m "refactor(track-c): listless secret hydrator, deny-list POSTGRES_PASSWORD (D1)"
git show --stat HEAD
git push
```

### Task 4.3: Move the UniFi client to core; add apps/api-side singleton

**Files:**
- Create: `packages/core/src/unifi/client.ts`, `packages/core/src/unifi/index.ts` (+ export from core index)
- Create: `apps/api/src/integrations/unifi.ts` (configured singleton from `env`)
- Modify: `apps/api/src/services/network-service.ts:3` (import the singleton), `apps/api/src/services/portal-*` only if they referenced the module singleton (they take a `UnifiGuestClient` param, so likely unaffected)
- Move/Modify tests: `apps/api/src/__tests__/unifi-guest.test.ts`, `network.test.ts`
- Delete: `apps/api/src/integrations/unifi/index.ts` (old singleton + env fallback)

**Interfaces:**
- Produces: `createUnifiClient({ apiKey, baseUrl, siteId }): UnifiClient` (no env import; `UNIFI_REQUEST_TIMEOUT_MS` stays a module const in core). `UnifiClient` implements both `UnifiGuestClient` (`authorizeGuest`, `findActiveAuthorization`) and `UnifiStatsClient` (traffic/health). `apps/api/src/integrations/unifi.ts` exports `export const unifi = createUnifiClient({ apiKey: env.UNIFI_API_KEY, baseUrl: env.UNIFI_CONTROLLER_URL, siteId: env.UNIFI_SITE_ID })`.

- [ ] **Step 1: Write the failing test** — move `unifi-guest.test.ts` to construct via `createUnifiClient({ apiKey, baseUrl, siteId })` imported from `@www/core`. Run: `bunx vitest run apps/api/src/__tests__/unifi-guest.test.ts` → FAIL (import path).

- [ ] **Step 2: Move the client to core** — copy `integrations/unifi/index.ts` to `packages/core/src/unifi/client.ts`; replace the `import { env }` + `env`-fallback constructor with mandatory `{ apiKey, baseUrl, siteId }` args; keep `UNIFI_REQUEST_TIMEOUT_MS` as a module const; split the exported interface into `UnifiGuestClient` + `UnifiStatsClient` in `unifi/index.ts`. Export from `packages/core/src/index.ts`.

- [ ] **Step 3: Add the apps/api singleton + rewire Network** — create `apps/api/src/integrations/unifi.ts` (singleton from `env`); change `network-service.ts:3` to `import { unifi } from "../integrations/unifi"`. Delete the old `integrations/unifi/index.ts`.

- [ ] **Step 4: Run tests + typecheck** — `bunx vitest run apps/api/src/__tests__/unifi-guest.test.ts apps/api/src/__tests__/network.test.ts` (adjust path) and `bun run typecheck` → PASS.

- [ ] **Step 5: Boot both entrypoints** — quick smoke that api + worker import graphs resolve (`bun run typecheck` covers static; optionally `bun run --cwd apps/api <boot>`).

- [ ] **Step 6: Commit**

```bash
git pull --rebase --autostash
git add packages/core apps/api/src/integrations apps/api/src/services/network-service.ts apps/api/src/__tests__/unifi-guest.test.ts apps/api/src/__tests__/network.test.ts
git commit -m "refactor(track-c): move UniFi client to core, add apps/api singleton for Network (D1)"
git show --stat HEAD
git push
```

### Task 4.4: Slice-4 gate — full suite + drizzle no-op

- [ ] **Step 1: Run the full backend suite** — `bun run --cwd apps/api test` and `bun run --cwd packages/core test` → green.
- [ ] **Step 2: Prove schema is untouched this slice** — `bun run --cwd apps/api db:generate` → Expected: **no new migration** (empty diff). If a migration appears, a schema import path changed unintentionally — fix before proceeding.
- [ ] **Step 3: Watch the deploy** — `gh run watch <id> --exit-status`; verify pod ages advanced.

---

## Slice 5 — guest-wifi fold (Q8/Q9/Q11) — the canary

One **atomic** push (do the moves, then a single commit for the whole fold; the validator makes any half-move un-pushable). Done inline.

### Task 5.1: Hand-owned `GUEST_EXPOSED` allowlist + guest-wifi in it

**Files:**
- Modify: `features/guest-exposed.ts` (add `"guest_wifi"` — match the real tile id)

**Interfaces:**
- Produces: `GUEST_EXPOSED: readonly string[] = ["guest_wifi"]` — the single hand-owned, security-reviewed list the validator checks `guestExposed` against.

- [ ] **Step 1: Confirm the real guest-wifi tile id** — `rg -n "guest.?wifi|guest_wifi" apps/web/src/lib/tile-registry.ts`. Use that exact id.
- [ ] **Step 2: Add it to the allowlist**
```ts
// SECURITY BOUNDARY (ADR-0006): every id here is reachable by unauthenticated
// guests on the LAN captive portal. Adding an id widens the guest attack surface
// — it must be a deliberate, security-reviewed edit. The codegen validator throws
// if any manifest's guestExposed flag disagrees with this list.
export const GUEST_EXPOSED: readonly string[] = ["guest_wifi"];
```
- [ ] **Step 3: Commit** (with the fold, or standalone — standalone is fine as a reviewable 1-liner):
```bash
git pull --rebase --autostash
git add features/guest-exposed.ts
git commit -m "feat(track-c): add guest_wifi to GUEST_EXPOSED allowlist (Q8)"
git show --stat HEAD
git push
```

### Task 5.2: Relocate the guest-wifi files into `features/guest-wifi/`

**Files:**
- `git mv` the seamed files:
  - `apps/api/src/services/portal-service.ts` → `features/guest-wifi/service.ts`
  - `apps/api/src/services/portal-repo.ts` → `features/guest-wifi/repo.ts`
  - `apps/api/src/__tests__/helpers/in-memory-portal-repo.ts` → `features/guest-wifi/repo.fake.ts`
  - `apps/api/src/trpc/routers/portal.ts` → `features/guest-wifi/api.ts` (becomes the branded facet)
  - `apps/api/src/services/portal-purge-service.ts` → `features/guest-wifi/jobs.ts` (branded)
  - `apps/web/src/tiles/guest-wifi/*` (the tile components) → `features/guest-wifi/web.tsx`
  - the `portalAuthorization` + `portalRateLimit` tables from `apps/api/src/db/schema.ts` → `features/guest-wifi/schema.ts`

**Interfaces:**
- Produces: all guest-wifi code under `features/guest-wifi/`; the portal tests move alongside (or keep importing via the new paths).

- [ ] **Step 1: `git mv` each file** (preserves history). Do NOT edit contents yet.
- [ ] **Step 2: Move the two tables** out of `schema.ts` into `features/guest-wifi/schema.ts` (cut the `pgTable` blocks + their imports).
- [ ] **Step 3: Fix import paths** in the moved files so they resolve from the new location (relative → `@www/core`, `@app-kit`, etc.). Do NOT add facet branding yet.
- [ ] **Step 4: typecheck** — `bun run typecheck`. Expect errors only where old import sites reference the moved modules; fix those import sites to the new paths. Iterate until clean.
- [ ] **Step 5: Do NOT commit yet** — the fold commits atomically after facets + regen (Task 5.5). Keep going.

### Task 5.3: Add manifest + branded facets + feature config slice

**Files:**
- Create: `features/guest-wifi/manifest.ts`, `features/guest-wifi/config.ts`
- Modify: `features/guest-wifi/api.ts`, `jobs.ts`, `schema.ts`, `web.tsx` (add branding / wire config)

**Interfaces:**
- Produces:
  - `manifest.ts`: `export default defineApp({ id: "guest_wifi", tile: { label, component: GuestWifiTile, view: GuestWifiTileView, worldCol, worldRow, cols, rows }, guestExposed: true })` (coords copied from the old registry entry).
  - `config.ts`: `export const config = z.object({ WIFI_PASSWORD: z.string().default(""), UNIFI_API_KEY: z.string().default(""), UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"), UNIFI_SITE_ID: z.string().default("default"), DATABASE_URL: z.string().url() }).parse(process.env)`.
  - `api.ts`: `export const api = defineApi(router({ portal: ... }))`.
  - `jobs.ts`: `export const jobs = defineJobs([...])` / `export const purgeCron = defineCron({...})`.
  - `schema.ts`: exports `portalAuthorization`, `portalRateLimit` (self-branded pgTables — codegen collects every exported `pgTable`).
  - the feature builds its own db handle: `const db = drizzle(createPool(config.DATABASE_URL), { schema })` and its own UniFi client from `config`.

- [ ] **Step 1: Write the manifest** (copy tile coords/label from the pre-move registry entry recorded in Task 5.1 Step 1).
- [ ] **Step 2: Write `config.ts`** (the feature-local zod slice off already-hydrated `process.env`).
- [ ] **Step 3: Brand the facets** — wrap the api router in `defineApi`, the jobs in `defineJobs`/`defineCron`; ensure `schema.ts` exports the pgTables directly.
- [ ] **Step 4: Wire the feature's own db + unifi** — in `api.ts`/`service.ts` wiring, construct `db` and `createUnifiClient(config)` from `config` (not from `apps/api`).
- [ ] **Step 5: typecheck** — `bun run typecheck` → clean.

### Task 5.4: Extend the collector + validator for facets; wire the guest router

**Files:**
- Modify: `scripts/apps-gen/collect.ts` (union: glob `features/*/manifest.ts` ∪ registry leftovers; collect schema tables + router keys from facets)
- Modify: `scripts/apps-gen/validate.ts` (fill the dup-router-key + dup-table branches stubbed in Task 3.2)
- Modify: `scripts/apps-gen/emit.ts` (emit `router.gen.ts`, `guest-router.gen.ts`, `schema.gen.ts`, `crons.gen.ts`)
- Modify: `apps/web/src/lib/tile-registry.ts` (remove the guest-wifi entry)

**Interfaces:**
- Consumes: branded facets from `features/guest-wifi/*`.
- Produces: `router.gen.ts` = `appRouter` merging every feature `api` facet; `guest-router.gen.ts` = router built from `guestExposed ∩ GUEST_EXPOSED`; `schema.gen.ts` = union of `features/*/schema.ts` tables ∪ leftover `apps/api/src/db/schema.ts` tables; `crons.gen.ts` = collected `defineCron`s.

- [ ] **Step 1: Write failing tests** — extend `validate.test.ts` with dup-router-key + dup-table cases; add a `collect.test.ts` asserting the guest-wifi manifest is picked up from `features/` and NOT double-counted from the registry (source === "feature"). Run → FAIL.
- [ ] **Step 2: Implement the union in `collect.ts`** — glob `features/*/manifest.ts` (dynamic import default export), plus remaining `TILE_REGISTRY` entries; import each `schema.ts` and collect exported `pgTable`s; import each `api.ts` and read the router keys. Mark `source`.
- [ ] **Step 3: Fill the validator branches** — dup router-key across features → throw; dup table name → throw.
- [ ] **Step 4: Emit the four aggregates** in `emit.ts` (sorted, deterministic).
- [ ] **Step 5: Remove the guest-wifi registry entry** so the union has exactly one source for it (the folder). If left in, the validator's dup-`id` throws — which is the intended safety net, but the fold's job is to remove it.
- [ ] **Step 6: Run validator/collector tests** → PASS.

### Task 5.5: Repoint drizzle-kit, regen, prove no DROP, atomic commit

**Files:**
- Modify: `apps/api/drizzle.config.ts` (`schema: "../../features/_generated/schema.gen.ts"`)
- Modify (generated): `features/_generated/*.gen.ts`
- Modify: the guest-server / app-router wiring to consume `router.gen.ts` + `guest-router.gen.ts`

**Interfaces:**
- Produces: runtime app router + guest router come from the generated aggregates; drizzle-kit reads the generated schema barrel.

- [ ] **Step 1: Repoint `drizzle.config.ts`** at `features/_generated/schema.gen.ts`.
- [ ] **Step 2: Regen** — `bun run apps:gen && bunx biome format --write features/_generated`.
- [ ] **Step 3: Prove NO table is dropped** — `bun run --cwd apps/api db:generate` → Expected: **empty diff / no migration**. If it emits `DROP TABLE portal_*`, the barrel is missing those tables — fix `schema.gen.ts`'s union before continuing. This is the BLOCKER guard.
- [ ] **Step 4: Wire runtime to the generated routers** — point the app-router entry + `guest-server.ts`/`guest-router.ts` at `router.gen.ts` / `guest-router.gen.ts`. Confirm the guest router still mounts only `portal`.
- [ ] **Step 5: Run everything** — `bun run typecheck`; `bun run --cwd apps/api test` (portal service/router/schema/purge tests pass **unchanged** — they inject fakes); the guest-router mount test shows only `portal`; `bun run apps:check` → clean; `bun run --cwd apps/web test -- placeholder-tiles` → PASS.
- [ ] **Step 6: Verify on the real panel** — launch, confirm the guest-wifi tile renders and works; screenshot for the record.
- [ ] **Step 7: Atomic commit — the whole fold in one push**

```bash
git pull --rebase --autostash
git add features/guest-wifi features/_generated apps/api/drizzle.config.ts apps/api/src/db/schema.ts apps/web/src/lib/tile-registry.ts scripts/apps-gen apps/api/src/trpc apps/api/src/guest-server.ts
git commit -m "feat(track-c): fold guest-wifi into features/ — the C7 canary (Q8/Q9/Q11)

- git mv seamed portal files into features/guest-wifi/ + branded facets
- feature owns its config slice + db handle + UniFi client (D1)
- codegen union(features/*, registry leftovers) for tiles AND schema barrel (D2)
- drizzle.config repointed at schema.gen.ts; db:generate empty diff (no DROP)
- guestRouter from guestExposed ∩ GUEST_EXPOSED"
git show --stat HEAD
git push
```

- [ ] **Step 8: Watch the deploy** — `gh run watch <id> --exit-status`; verify all three pod image ages advanced.

### Task 5.6: Doc updates owed on land

**Files:**
- Modify: `docs/superpowers/plans/2026-07-21-consolidation-roadmap.md`, `docs/adr/0001-*`, `docs/adr/0002-*`, `CLAUDE.md`/`AGENTS.md`

- [ ] **Step 1:** Roadmap + ADR-0001: "consistency test" → "codegen validation".
- [ ] **Step 2:** ADR-0001: retire the `tile-registry.ts` tile-placement invariant; update `CLAUDE.md`/`AGENTS.md` (note: `CLAUDE.md` is a symlink to `AGENTS.md` — edit the target, never `sed -i` the symlink).
- [ ] **Step 3:** ADR-0002: record the lazy-ref → eager (Q10) deviation + why.
- [ ] **Step 4:** Roadmap decision 16: canary coverage is 3-of-4 (guest-wifi is NOT `sensitive`).
- [ ] **Step 5:** Commit + push each doc change (or one docs commit).

```bash
git pull --rebase --autostash
git add docs CLAUDE.md AGENTS.md
git commit -m "docs(track-c): C7 landed — codegen-validation, eager deviation, coverage 3-of-4"
git show --stat HEAD
git push
```

---

## Self-Review (author's checklist — completed)

**Spec coverage:** Every spec section maps to a task — Q4 → Slice 1; Q10 → Slice 2; Q5/Q6/Q7/Q12 → Slice 3; D1 → Slice 4; Q8/Q9/Q11 + D2 → Slice 5; doc-updates-owed → Task 5.6. The two resolved decisions (D1 substrate seam, D2 union flip incl. the schema-barrel/drizzle-kit BLOCKER) are pinned in Tasks 4.1–4.3 and 5.4–5.5.

**Placeholder scan:** No "TBD/TODO/handle edge cases". Code steps carry real code; the few "match the real shape" notes point at a named file to read, not an unspecified blank.

**Type consistency:** `defineApp`/`defineApi`/`defineJobs`/`defineCron` signatures in Task 3.1 match their use in Task 5.3; `collect()`/`validate()`/`renderTiles()` signatures in 3.2–3.3 match their extension in 5.4; `createPool`/`createUnifiClient`/`hydrateSecretFiles`/`databaseUrlFromSecret` signatures in Slice 4 match their consumption in Slice 5. `GUEST_EXPOSED` is defined in 3.3 (empty) and populated in 5.1.

**Known adaptation points** (real names to confirm at execution, flagged inline, not placeholders): the tRPC init module path in `app-kit/server.ts`; the real `TILE_REGISTRY` field accessors in `collect.ts`; the core package import specifier (`@www/core` vs actual); exact camera/session coupling files (mapped in Task 1.1).
