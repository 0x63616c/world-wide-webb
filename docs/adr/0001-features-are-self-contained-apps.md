# Features are self-contained Apps; the central tile-registry is superseded

Each user-facing feature becomes one **App** — a folder under `features/<id>/`
holding its Tile(s), tRPC router slice, Worker Cycles/Queue Jobs, owned tables, and Chrome, wired
together by an `AppManifest`. The folder existing *is* the App's registration. This replaces
today's arrangement where a feature is scattered across the central `TILE_REGISTRY`
(`web/src/lib/tile-registry.ts`), the `appRouter` object literal, the worker `Worker[]` array, and
the Drizzle schema barrel, tied together only by convention.

**This deliberately supersedes the `CLAUDE.md` invariant "Tile placement belongs in
`products/control-center/web/src/lib/tile-registry.ts`."** After the migration, a Tile's default
placement is declared in its App's `manifest.ts`; `board_tile_placement` rows still override at
runtime via `resolveLayout`. Update that invariant when the migration lands.

## Why (the trade-off)

The central registries give one obvious place to look but force every new feature to edit 4–5
hand-maintained composition roots, and no single location owns a feature — the deletion test fails
(you cannot delete a feature by deleting one thing). App folders trade the single-index convenience
for **locality**: `grep features/weather/` returns the whole feature, and deleting the folder deletes
the feature. Ownership is enforced by a consistency test (one owning App per router key / table;
exactly one `home` Tile).

## Why it is recorded

Hard to reverse — redistributing 19 tiles + routers + workers + tables into folders and deleting
the central registries is a multi-slice migration that is not casually undone. Surprising without
context — a future reader will find the `CLAUDE.md` tile-registry invariant and wonder why features
now declare themselves in folders instead. A real trade-off — central index vs. per-feature
locality, with the deletion test as the deciding lens.

See ADR-0002 for *how* an App folder becomes runtime wiring (committed codegen, not a runtime
registry).
