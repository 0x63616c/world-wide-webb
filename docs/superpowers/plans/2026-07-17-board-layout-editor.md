# Board Layout Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User-editable tile layout for the wall-panel board — drag tiles in a zoomed-out edit mode, persist positions to Postgres, sync across devices by polling, with code-owned defaults (V4B "Hourly Left").

**Architecture:** A new `board_tile_placement` table stores per-tile world coords (row per tile, positions only — the tile set, sizes, labels stay code-owned in `tile-registry.ts`). A `layout` tRPC router exposes `get`/`save`. The web board blocks first render until layout resolves, merges DB placements over registry defaults (scanline fallback for new tiles), recomputes the bento fill from the merged layout, and polls every 5s outside edit mode (last-write-wins). Edit mode is a full-screen zoomed-out overlay (no panning) entered from the settings panel: drag-to-snap, overlap drops spring back, Save gated on the bento generator succeeding, Reset-to-default/Cancel/Save controls.

**Tech Stack:** Bun, Drizzle + Postgres, tRPC v11, Zod, React 19, React Query, Storybook 10 + addon-vitest, Vitest.

## Global Constraints

- Fixed wall panel `1366x1024`; board content constants in `products/control-center/web/src/lib/grid-constants.ts` (`BOARD_W = 1366`, `BOARD_H = 1000`).
- Tile placement belongs in `products/control-center/web/src/lib/tile-registry.ts`.
- No fake or placeholder data — unavailable data shimmers or errors.
- Storybook-first for new UI; shared primitives from `products/control-center/web/src/components/ui/`.
- IDs default to `prefix_<id>` (tile ids are `tile_<slug>`, already in the registry).
- Backend code uses structured logging via `@www/logger` (`getLogger()`), never `console.*`.
- Use `bun`/`bunx`; run tests with `bun run test`, never bare `bun test`.
- Keep docs current: update `CODEBASE_OVERVIEW.md` in the same change.
- Decisions locked with the user: clock is MOVABLE in edit mode; startup fetch failure renders registry defaults + existing connection-lost affordances (do not block forever); concurrent edits are last-write-wins; default layout = V4B; trigger = settings panel entry (no long-press in v1); one global layout for all devices; save via explicit Save button; edit bar = Reset to default / Cancel / Save (Save bottom right); no auth.

---

### Task 1: Registry defaults become V4B "Hourly Left"

**Files:**
- Modify: `products/control-center/web/src/lib/tile-registry.ts` (the 16 `worldCol`/`worldRow` values + the placement comment)

**Interfaces:**
- Produces: `TILE_REGISTRY` entries whose `worldCol`/`worldRow` now mean *default* position (V4B values below). All later tasks read defaults from here.

V4B coordinates (validated gap-free against the bento generator):

| id | worldCol | worldRow |
|---|---|---|
| tile_clock | 26 | 27 |
| tile_weath | 26 | 24 |
| tile_wifi | 35 | 27 |
| tile_tesla | 22 | 30 |
| tile_hourly | 22 | 24 |
| tile_ctrl | 31 | 27 |
| tile_sched | 34 | 30 |
| tile_dogcam | 38 | 27 |
| tile_ac | 30 | 24 |
| tile_dogmode | 18 | 27 |
| tile_event | 30 | 30 |
| tile_tv | 18 | 24 |
| tile_sound | 22 | 27 |
| tile_tvapps | 30 | 32 |
| tile_quickplay | 26 | 32 |
| tile_felogs | 26 | 30 |

- [ ] **Step 1: Edit the 16 coord pairs** in `TILE_REGISTRY` to the table above (sizes, ids, flags unchanged). Update the free-placement comment block above the array to note these are *defaults* that `board_tile_placement` rows override (Task 5 wires that).
- [ ] **Step 2: Verify the layout is bento-fillable** — the existing placeholder validation test covers this:

Run: `bun run test -- placeholder-tiles`
Expected: PASS (placeholder-tiles.test.ts asserts gap-free/overlap-free/sliver-free around the new coords)

- [ ] **Step 3: Visual sanity** — `bun run --filter @cc/web storybook` still boots; tile stories unaffected (BoardDecorator reads sizes only).
- [ ] **Step 4: Commit** `feat(control-center/web): default tile layout becomes V4B hourly-left`

---

### Task 2: `board_tile_placement` schema + migration

**Files:**
- Modify: `products/control-center/api/src/db/schema.ts`
- Create: `products/control-center/api/src/db/migrations/0012_add_board_tile_placement.sql` (via drizzle-kit)

**Interfaces:**
- Produces: `boardTilePlacement` Drizzle table `{ tileId: text PK, worldCol: integer, worldRow: integer, updatedAtUtc: timestamptz default now }`.

- [ ] **Step 1: Add the table** to `schema.ts`, modeled on the existing keyed-singleton comment style:

```ts
// Per-tile board placement , where each REAL tile sits in the 64×64 pannable
// world. Row per tile keyed by the registry tile id (e.g. "tile_clock"). The
// tile SET (component, size, label) is code-owned in the web tile-registry;
// this table only overrides positions. A missing row means "use the registry
// default", so a never-edited board stores nothing. Whole-layout saves replace
// all rows in one transaction (services/board-layout-service.ts).
export const boardTilePlacement = pgTable("board_tile_placement", {
  tileId: text("tile_id").primaryKey(),
  worldCol: integer("world_col").notNull(),
  worldRow: integer("world_row").notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).defaultNow().notNull(),
});
```

- [ ] **Step 2: Generate the migration**

Run: `cd products/control-center/api && bunx drizzle-kit generate --name add_board_tile_placement`
Expected: `0012_add_board_tile_placement.sql` with `CREATE TABLE "board_tile_placement" (...)` + `meta/_journal.json` entry.

- [ ] **Step 3: Boot check** — migrations run at API boot; `bun run test` (api package tests boot the migration path where applicable). Expected: PASS.
- [ ] **Step 4: Commit** `feat(control-center/api): board_tile_placement table`

---

### Task 3: board-layout service

**Files:**
- Create: `products/control-center/api/src/services/board-layout-service.ts`
- Test: `products/control-center/api/src/services/board-layout-service.test.ts` (mirror the test style of `settings-service` / `schedule-service` tests — in-memory/mock db or pg-mem per existing repo pattern; follow whichever those tests use)

**Interfaces:**
- Produces:
  - `placementSchema = z.object({ tileId: z.string().regex(/^tile_[a-z0-9]+$/), worldCol: z.number().int().min(0).max(63), worldRow: z.number().int().min(0).max(63) })`
  - `layoutSchema = z.object({ placements: z.array(placementSchema), revision: z.string().nullable() })` — `revision` is the max `updated_at_utc` ISO string (null when table empty); clients compare it to skip no-op re-renders.
  - `getBoardLayout(db): Promise<Layout>`
  - `saveBoardLayout(db, placements: Placement[]): Promise<Layout>` — validates unique tileIds, then in one transaction `DELETE FROM board_tile_placement` + bulk insert; returns fresh layout.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
// db harness per existing service tests
describe("board-layout-service", () => {
  it("returns empty placements + null revision on fresh table", async () => {
    const layout = await getBoardLayout(db);
    expect(layout.placements).toEqual([]);
    expect(layout.revision).toBeNull();
  });
  it("save replaces the whole layout atomically and bumps revision", async () => {
    await saveBoardLayout(db, [{ tileId: "tile_clock", worldCol: 26, worldRow: 27 }]);
    const after = await saveBoardLayout(db, [{ tileId: "tile_weath", worldCol: 26, worldRow: 24 }]);
    expect(after.placements).toEqual([{ tileId: "tile_weath", worldCol: 26, worldRow: 24 }]);
    expect(after.revision).not.toBeNull();
  });
  it("rejects duplicate tile ids", async () => {
    await expect(
      saveBoardLayout(db, [
        { tileId: "tile_clock", worldCol: 1, worldRow: 1 },
        { tileId: "tile_clock", worldCol: 2, worldRow: 2 },
      ]),
    ).rejects.toThrow(/duplicate/i);
  });
  it("rejects out-of-bounds coords via schema", () => {
    expect(placementSchema.safeParse({ tileId: "tile_x", worldCol: 64, worldRow: 0 }).success).toBe(false);
    expect(placementSchema.safeParse({ tileId: "Tile_X", worldCol: 0, worldRow: 0 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `bun run test -- board-layout-service` → module not found.
- [ ] **Step 3: Implement service** (drizzle select / tx delete+insert, structured logging via `getLogger()` on save with placement count). Bounds live in the zod schema; the service only adds the duplicate-id check (server does NOT know tile sizes — geometry validity is client-owned by design).
- [ ] **Step 4: Run tests** → PASS.
- [ ] **Step 5: Commit** `feat(control-center/api): board layout service`

---

### Task 4: `layout` tRPC router

**Files:**
- Create: `products/control-center/api/src/trpc/routers/layout.ts`
- Modify: `products/control-center/api/src/trpc/routers/index.ts` (add `layout: layoutRouter`)

**Interfaces:**
- Produces: `trpc.layout.get` (query → `layoutSchema`), `trpc.layout.save` (mutation, input `z.object({ placements: z.array(placementSchema) })` → `layoutSchema`).

- [ ] **Step 1: Write router** mirroring `settings.ts`:

```ts
import { getBoardLayout, layoutSchema, placementSchema, saveBoardLayout } from "../../services/board-layout-service";
import { publicProcedure, router } from "../init";
import { z } from "zod";

export const layoutRouter = router({
  /** Current board layout: per-tile placements + a revision (max updated_at). */
  get: publicProcedure.output(layoutSchema).query(({ ctx }) => getBoardLayout(ctx.db)),
  /** Replace the whole layout (last-write-wins across devices). */
  save: publicProcedure
    .input(z.object({ placements: z.array(placementSchema) }))
    .output(layoutSchema)
    .mutation(({ ctx, input }) => saveBoardLayout(ctx.db, input.placements)),
});
```

- [ ] **Step 2: Wire into root router index**; `bun run typecheck` → PASS.
- [ ] **Step 3: Commit** `feat(control-center/api): layout tRPC router`

---

### Task 5: Web placement resolution (merge + scanline)

**Files:**
- Create: `products/control-center/web/src/lib/board-layout.ts`
- Test: `products/control-center/web/src/lib/board-layout.test.ts`

**Interfaces:**
- Consumes: `TILE_REGISTRY` (defaults + sizes), `WORLD_COLS/WORLD_ROWS` + wall thickness 2.
- Produces:
  - `type TilePlacement = { tileId: string; worldCol: number; worldRow: number }`
  - `type ResolvedLayout = { tiles: (TileRegistryEntry & { worldCol: number; worldRow: number })[]; unplaced: string[] }`
  - `resolveLayout(saved: TilePlacement[]): ResolvedLayout` — for each registry tile: saved row wins; else registry default; if the default collides with an already-resolved tile, scanline (row-major from the default position, wrapping the 60×60 inner world, wall ring excluded) to the first non-overlapping slot; truly no slot (unreachable in practice) → tile id goes in `unplaced`, tile not rendered. Saved rows for ids not in the registry are ignored (pruned on next save).

- [ ] **Step 1: Failing tests**

```ts
describe("resolveLayout", () => {
  it("uses saved placement over registry default", () => { /* one tile moved */ });
  it("falls back to registry default when no row", () => { /* empty saved */ });
  it("ignores unknown tile ids", () => { /* saved contains tile_ghost */ });
  it("scanlines a new tile whose default is occupied", () => {
    // saved layout parks another tile exactly on tile_felogs's default; felogs
    // must resolve to the first free row-major slot, no overlap with anything
  });
  it("reports unplaced when the world genuinely has no slot", () => {
    // trick: pass a saved layout that tiles the whole inner world via a
    // synthetic registry — use the exported internals seam or accept skipping
    // this via a size-720 grid fixture; MUST assert unplaced.length === 1
  });
});
```

- [ ] **Step 2: Run → FAIL.** **Step 3: Implement** (pure functions, no React). **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** `feat(control-center/web): board layout resolution (merge + scanline)`

---

### Task 6: Board consumes the layout (blocking load, poll, computed bento)

**Files:**
- Create: `products/control-center/web/src/lib/useBoardLayout.ts`
- Modify: `products/control-center/web/src/lib/placeholder-tiles.ts` — export `bentoFor(tiles: {col,row,cols,rows}[]): PlaceholderTile[]` (the existing module-load pipeline refactored into a function; module-load consts remain for the test + as the default-layout fill).
- Modify: `products/control-center/web/src/components/Board.tsx` — `BOARD_CELLS`, `HOME_CX/CY`, `cellAt`, minimap inputs become derived from the resolved layout via `useMemo`; board renders a full-screen shimmer (existing skeleton styling, no tiles) until the first `layout.get` settles (success OR error → error falls back to registry defaults; the existing `ConnectionLostBanner` already covers the API-down signal).
- Test: covered by existing placeholder validation test (now parameterized through `bentoFor`) + a new `useBoardLayout` hook test if the repo has hook-test precedent; otherwise logic stays in tested `board-layout.ts` and the hook is thin wiring.

**Interfaces:**
- Produces: `useBoardLayout(): { status: "loading" | "ready"; layout: ResolvedLayout; revision: string | null; refetch(): void }`
  - `trpc.layout.get.useQuery(undefined, { refetchInterval: POLL.settings, enabled: !editOpen })` — reuse the `POLL` constant table in `lib/hooks.ts` (add `layout: 5_000` entry).
  - Applies new data only when `revision` changed.
- Consumes: `resolveLayout` (Task 5), `bentoFor`.

- [ ] **Step 1: Add `bentoFor`** to placeholder-tiles.ts, re-express `BENTO_TILES` as `bentoFor(clusterWorldCells())`, keep `placeholderViolations()` green: `bun run test -- placeholder-tiles` → PASS.
- [ ] **Step 2: Write `useBoardLayout`** with the blocking/ready state + revision-gated apply.
- [ ] **Step 3: Rewire Board** — every use of the old module-load `BOARD_CELLS`/`HOME_RECT` goes through the memoized derivation; loading state renders `var(--bg)` stage + shimmer only (no fake tiles). Unplaced tiles (Task 5) render a fixed banner: reuse the banner styling of `ConnectionLostBanner` with copy `New tile has no space — edit layout to place it`.
- [ ] **Step 4:** `bun run typecheck && bun run test` → PASS. Manual: `bun run dev`, board waits for layout then shows V4B; kill API → refresh: defaults + connection-lost banner.
- [ ] **Step 5: Commit** `feat(control-center/web): board loads layout from server (blocking first paint + 5s poll)`

---

### Task 7: Layout editor (storybook-first)

**Files:**
- Create: `products/control-center/web/src/components/layout-editor/LayoutEditorView.tsx` (pure view)
- Create: `products/control-center/web/src/components/layout-editor/LayoutEditorView.stories.tsx`
- Create: `products/control-center/web/src/components/layout-editor/LayoutEditor.tsx` (data wiring: staging state, save mutation)
- Create: `products/control-center/web/src/lib/layout-edit-store.ts` (open/close store, modeled on `modal-open-store`)

**Interfaces:**
- Produces:
  - `LayoutEditorViewProps = { tiles: (TileRegistryEntry & {worldCol; worldRow})[]; renderTile(entry): ReactNode; onMove(tileId, col, row): void; onReset(): void; onCancel(): void; onSave(): void; saving: boolean; valid: boolean; invalidReason: string | null; dirty: boolean }`
  - View owns: fit-to-cluster camera (bbox + 2-cell margin, `scale = min((1366-32)/w, (1024-120)/h, 0.8)`, refit on drop, never during a drag), lattice snap on drop, **overlap drop springs back** (drop is simply not committed — `onMove` only fires for legal drops), at-rest dashed frame centered on the CURRENT clock tile (clock movable, no pin), dimmed live `bentoFor` fill behind, edit bar bottom: `Reset to default` (left) · `Cancel` · `Save` (right, disabled when `!valid || !dirty || saving`), invalid reason line ("board can't fill around this arrangement") when the bento generator throws.
  - `LayoutEditor` owns: staging copy of placements (`useState` seeded from resolved layout), `valid` = `bentoFor` succeeds (try/catch memo), Reset = stage registry defaults, Save = `trpc.layout.save` → on success invalidate `layout.get` + close; on error stay open and surface the mutation error inline (never drop the staged arrangement).
- Consumes: `resolveLayout`, `bentoFor`, `worldCellRect`, registry.

- [ ] **Step 1: Stories first** — `LayoutEditorView.stories.tsx` with `parameters: { boardWrapper: false, layout: "fullscreen" }`, `renderTile` mapping each entry to its `viewComponent` with the same populated story-args merge pattern used across tile stories. Stories: `Default` (V4B), `Dirty` (one tile staged elsewhere), `Invalid` (arrangement with a 1-cell slit; Save disabled + reason shown), `Saving`. Play tests: drag via pointer events moves a tile by one pitch and fires `onMove` with snapped coords; an overlapping drop fires nothing.
- [ ] **Step 2: Run story tests → FAIL** (`bun run test -- LayoutEditorView`).
- [ ] **Step 3: Implement view** — drag math is the proven playground approach: pointer capture on the tile wrapper, live px offset ÷ scale, snap `Math.round(d/PITCH)` on release, clamp to the inner world (wall ring excluded), inner tile content wrapped in `pointerEvents: "none"` + `transform: scale()`. No panning in edit mode by design (camera fits everything).
- [ ] **Step 4: Run story tests → PASS.**
- [ ] **Step 5: Implement `LayoutEditor` wiring + `layout-edit-store`.**
- [ ] **Step 6:** `bun run typecheck && bun run test` → PASS. **Commit** `feat(control-center/web): layout editor (drag, snap, bento-gated save)`

---

### Task 8: Entry point + board integration

**Files:**
- Modify: `products/control-center/web/src/components/SettingsPanel.tsx` — add `Edit layout` row/button → `layoutEditStore.open()`, closes the settings panel.
- Modify: `products/control-center/web/src/components/Board.tsx` — mount `<LayoutEditor/>` overlay when open; while open: treat as modal-open (freezes native scroll + drag-pan via the existing `modalOpen` OR-chain), disable idle-reset + idle-dim (`enabled: settings.recenterEnabled && !layoutEditOpen`), hide Minimap/CenteredTileLabel/SettingsButton, pause the layout poll (`enabled: !layoutEditOpen` on the query).

**Interfaces:**
- Consumes: `layout-edit-store` (Task 7), `useBoardLayout` (Task 6).

- [ ] **Step 1: Wire everything**; entering edit animates opacity/scale (simple CSS transition, 200ms).
- [ ] **Step 2: Manual E2E on `bun run dev`:** settings → Edit layout → drag Weather elsewhere → Save → reload page: persists. Second browser window: change propagates ≤5s. Cancel discards. Reset stages V4B. Overlap drop springs back. Slit arrangement disables Save with reason.
- [ ] **Step 3:** `bun run typecheck && bun run test && bun run lint` → PASS.
- [ ] **Step 4: Commit** `feat(control-center/web): layout edit mode entry + board integration`

---

### Task 9: Cleanup, docs, gate

**Files:**
- Delete: `products/control-center/web/src/components/LayoutPreview.stories.tsx` (scratch playground superseded by LayoutEditorView stories)
- Modify: `CODEBASE_OVERVIEW.md` — Frontend section: tile-registry coords are *defaults*, `board_tile_placement` overrides, layout tRPC router, edit mode summary; Database section: new table.

- [ ] **Step 1: Delete scratch story; update docs.**
- [ ] **Step 2: Full gate:** `bun run typecheck && bun run lint && bun run test && bun run knip` → all PASS (knip: confirm no orphan exports in new files).
- [ ] **Step 3: Commit** `docs(control-center): board layout editor docs + scratch cleanup`
- [ ] **Step 4: Merge worktree → main, push** (deploy is push-to-main; migration runs at boot).

---

## Self-Review Notes

- Spec coverage: trigger (T8), zoom-out no-pan editing (T7), overlap spring-back (T7), Save/Cancel/Reset placement (T7), bento gate (T7), blocking first paint + defaults-on-error (T6), 5s poll last-write-wins + revision gate (T3/T6), new-tile scanline + unplaceable banner (T5/T6), deleted-tile prune-on-save (T5 ignore + T7 save writes only registry ids), defaults-in-code/V4B/no seed migration (T1/T2), clock movable (T7), docs (T9).
- Type consistency: `TilePlacement`/`placementSchema` field names (`tileId`, `worldCol`, `worldRow`) identical across service, router, web lib.
- No placeholder steps: each code step carries real code or an exact existing pattern to mirror by path.
