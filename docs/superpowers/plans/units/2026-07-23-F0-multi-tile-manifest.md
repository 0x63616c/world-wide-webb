# F0 — Multi-tile support in the App manifest

**Unit:** F0 (Track C migration, Wave 1 keystone). Contract widening only — no
tile folds. Blocks every multi-tile fold: F-weather (weath+hourly), F-calendar
(clock+event), and is a prerequisite the media splits ride on.

**Planner note:** this is a CONTRACT/interface change. It is authored once and
consumed by every later fold, so the shape is designed for 10x-100x growth
(CLAUDE.md invariant), not for the six manifests that exist today.

**Implementer:** a DIFFERENT agent. This file is the whole brief. Do not deviate
from the resolved shape below without flagging back.

---

## 1. Problem (confirmed)

Today `AppManifest.tile` is SINGULAR — one App declares exactly one tile
(`app-kit/define-app.ts:17-23`). `home?: boolean` is APP-level (`define-app.ts:21`).
The codegen and validator model exactly one tile per app. The locked end-state
(roadmap `~/.claude/plans/merry-hugging-river.md` "End state" #1) requires an App
to own MULTIPLE tiles in one feature folder:

- Weather → one `features/weather`, two tiles (`tile_weath` + `tile_hourly`).
- Calendar → one `features/events`, two tiles (`tile_event` + the clock tile);
  only the clock tile is `home`. **This is impossible while `home` is app-level.**

F0 makes the manifest support N tiles per App and moves `home` to tile level, so
those clusters can fold in later waves. F0 folds nothing itself.

---

## 2. Current state (verified in-tree, 2026-07-23)

- `AppManifest` = `{ id, tile: TileSpec, guestExposed?, home?, sensitive? }`
  (`app-kit/define-app.ts:17-23`).
- `TileSpec` = `{ label, component, viewComponent?, worldCol, worldRow, cols, rows }`
  (`define-app.ts:5-16`). It has NO id — the App `id` doubles as the tile id.
- `AppManifest.tile` has exactly TWO readers (grep-confirmed): `collect.ts:124-131`
  and `manifestToEntry` in `tile-registry.ts:239-251`. Nothing else.
- `AppManifest.home` readers: `collect.ts:133` and `tile-registry.ts:252`.
  `validate.ts:106` counts `a.home` on the collected app.
- `TileRegistryEntry` (`tile-registry.ts:37-58`) ALREADY carries `home?` at
  tile level — the 14 hand-placed registry entries set it there (clock at
  `tile-registry.ts:79`). `HOME_TILE` (`tile-registry.ts:263`) already does
  `TILE_REGISTRY.find((t) => t.home)`, i.e. tile-level. So the registry side is
  already tile-level; only the manifest/app side is app-level and needs moving.
- `GENERATED_TILES` (emitted into `features/_generated/tiles.gen.ts`) is consumed
  by NOTHING outside `emit.ts` itself (grep-confirmed). It is purely a drift
  artifact that `apps:check` diffs. **Its shape is therefore free to change** with
  zero runtime behaviour impact — only the committed `.gen.ts` bytes change, in the
  same commit.
- **Manifests that exist and author `tile:` TODAY (six, not two):** `guest-wifi`,
  `network`, `tesla`, `dogcam`, `weight`, `deploys`. (The master execution plan's
  F0 note says "only network + guest-wifi author `tile`" — that was written before
  Wave 2 landed and is now STALE. All six migrate. See §7.)
- No `notif` feature folder exists yet (`features/` holds exactly the six above +
  `_generated`). The task brief's "+notif landing" is not in-tree. See PLACEHOLDER-A.

---

## 3. Resolved shape

### 3.1 `tiles: TileSpec[]` — clean array, drop `tile` entirely (RECOMMENDED)

Replace the singular `tile: TileSpec` with a single `tiles: TileSpec[]`. Do NOT
keep `tile` as sugar for `tiles: [tile]`, and do NOT let the two coexist.

**Churn analysis (why clean array wins):** the singular field has exactly two
consumers (collect + manifestToEntry) and is authored by six manifests. Migrating
all six to a one-element `tiles: [...]` is purely mechanical and touches ~6 lines
each. A `tile`-sugar escape hatch would permanently double the codegen read paths
(every consumer forks "singular or array?") for the entire life of the repo, to
save a one-time six-file edit — a bad trade at 10x-100x. Master-plan M4 already
resolved this to a single array; this plan confirms it.

### 3.2 `home` moves onto `TileSpec` (per-tile)

Remove `home?` from `AppManifest`. Add `home?: boolean` to `TileSpec`. The
"exactly one home tile" invariant becomes "exactly one home tile across ALL tiles
of ALL apps" (not one-home-per-app). This matches how the registry side already
works and is what F-calendar needs (clock tile home, event tile not).

### 3.3 `TileSpec` gains a required `id` (the load-bearing new field)

Today the App `id` IS the tile id: `manifestToEntry` sets `entry.id = m.id`, and
the board, `board_tile_placement` DB rows, `placeholder-tiles`, and the minimap all
key on that tile id. A multi-tile App has N tiles that CANNOT all share the App id
— each tile must self-identify. So:

- Add `id: string` to `TileSpec` (the TILE id, e.g. `tile_weath`).
- `AppManifest.id` stays (the APP / domain id: owns the router-key namespace, the
  table(s), the `guestExposed` allowlist match, and the feature folder). For a
  single-tile App the two ids coincide (see migration §7) — that is expected and
  explicit, not magic.

Make `id` REQUIRED, not optional-defaulting-to-app-id. An implicit default would
reintroduce the "which id is this?" ambiguity the whole change is trying to kill,
and the validator needs every tile to carry its own id to dedupe. Every tile
self-identifies. (Decided; PLACEHOLDER-B records the one residual question.)

### 3.4 What stays APP-level

`guestExposed` and `sensitive` remain on `AppManifest` (per-app). `guestExposed`
gates the whole feature's guest router (ADR-0006), and `sensitive` is an app-level
concern (panel-session PIN unlock). Only `home` moves to the tile. `label`,
`component`, `viewComponent`, `worldCol/Row`, `cols/rows`, `home`, `id` are
tile-level.

---

## 4. Real code sketches

### 4.1 `app-kit/define-app.ts` (new types)

```ts
import type { ComponentType } from "react";

export const APP_BRAND = Symbol.for("app-kit.app");

export interface TileSpec {
  /** The TILE id (e.g. "tile_weath"). Distinct from the owning App id; a
   *  multi-tile App's tiles each carry their own. The board, board_tile_placement
   *  rows, placeholder-tiles bento, and minimap all key on this. */
  id: string;
  label: string;
  component: ComponentType;
  viewComponent?: ComponentType<never>;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  /** The one tile the board opens on and idles back to. Exactly one tile across
   *  ALL apps sets this (validator-enforced). */
  home?: boolean;
}

export interface AppManifest {
  /** The APP / domain id: owns the router-key namespace, its table(s), the
   *  guestExposed allowlist match, and the feature folder. For a single-tile App
   *  this equals its one tile's id. */
  id: string;
  tiles: TileSpec[];
  guestExposed?: boolean;
  sensitive?: boolean;
}

export function defineApp(m: AppManifest): AppManifest {
  return Object.assign(Object.create(null), m, { [APP_BRAND]: true }) as AppManifest;
}
```

### 4.2 `scripts/apps-gen/validate.ts` (home + overlap + dup-tile-id over ALL tiles)

The model changes from one-rect-per-app to N-tiles-per-app. Flatten once, then run
home-count / dup-tile-id / overlap over the flat tile list; keep dup-app-id,
dup-table, dup-router-key, dup-job, guestExposed exactly as they are.

```ts
interface TileRect {
  id: string;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  home?: boolean;
}
interface ValApp {
  id: string;
  guestExposed?: boolean;
  tiles: TileRect[];
}
// ... Model, overlaps() unchanged ...

export function validate(model: Model, guestExposed: readonly string[]): void {
  const allow = new Set(guestExposed);

  // (dup table / router key / job checks unchanged)

  // dup APP id + guestExposed agreement (app-level, unchanged loop body)
  const seenApp = new Set<string>();
  for (const a of model.apps) {
    if (seenApp.has(a.id)) throw new CodegenError(`duplicate app id: ${a.id}`);
    seenApp.add(a.id);
    const inAllow = allow.has(a.id);
    if (Boolean(a.guestExposed) !== inAllow) {
      throw new CodegenError(
        `app ${a.id}: guestExposed=${Boolean(a.guestExposed)} but GUEST_EXPOSED allowlist ${
          inAllow ? "contains" : "omits"
        } it — widening the guest surface needs an explicit, security-reviewed edit to the allowlist`,
      );
    }
  }

  // Flatten to all tiles of all apps.
  const tiles = model.apps.flatMap((a) => a.tiles.map((t) => ({ ...t, appId: a.id })));

  // dup TILE id across every tile of every app (board / DB placement key on this).
  const seenTile = new Map<string, string>();
  for (const t of tiles) {
    const prev = seenTile.get(t.id);
    if (prev) {
      throw new CodegenError(
        `duplicate tile id '${t.id}' (declared by app ${prev} and app ${t.appId})`,
      );
    }
    seenTile.set(t.id, t.appId);
  }

  // exactly one home across ALL tiles of ALL apps.
  const homes = tiles.filter((t) => t.home).length;
  if (homes !== 1) throw new CodegenError(`expected exactly one home tile, found ${homes}`);

  // no tile-rect overlap across every pair of tiles — INCLUDING two tiles owned by
  // the same app (a multi-tile app must not self-overlap).
  for (let i = 0; i < tiles.length; i++)
    for (let j = i + 1; j < tiles.length; j++)
      if (overlaps(tiles[i], tiles[j]))
        throw new CodegenError(`tiles ${tiles[i].id} and ${tiles[j].id} overlap`);
}
```

Note: the overlap loop now naturally covers intra-app pairs because tiles are
flattened before pairing — no special case needed; two tiles of the same app are
just two entries in the flat list.

### 4.3 `scripts/apps-gen/collect.ts` (emit each tile)

`CollectedApp` carries `tiles: CollectedTile[]` instead of one `tile`. `home` moves
off the app onto each tile; `guestExposed`/`sensitive`/`source` stay app-level.

```ts
interface CollectedTile {
  id: string;
  label: string;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  home: boolean;
}
export interface CollectedApp {
  id: string;
  tiles: CollectedTile[];
  guestExposed: boolean;
  sensitive: boolean;
  source: "feature" | "registry";
}
```

Feature loop (replaces `collect.ts:123-136`):

```ts
featureApps.push({
  id: m.id,
  tiles: m.tiles.map((t) => ({
    id: t.id,
    label: t.label,
    worldCol: t.worldCol,
    worldRow: t.worldRow,
    cols: t.cols,
    rows: t.rows,
    home: Boolean(t.home),
  })),
  guestExposed: Boolean(m.guestExposed),
  sensitive: Boolean(m.sensitive),
  source: "feature",
});
```

Registry leftovers (replaces `collect.ts:189-204`): each registry entry is a
single-tile app whose tile id == the entry id.

```ts
const registryApps: CollectedApp[] = TILE_REGISTRY.filter((t) => !featureIds.has(t.id)).map(
  (t) => ({
    id: t.id,
    tiles: [
      {
        id: t.id,
        label: t.label,
        worldCol: t.worldCol,
        worldRow: t.worldRow,
        cols: t.cols,
        rows: t.rows,
        home: Boolean((t as { home?: boolean }).home),
      },
    ],
    guestExposed: false,
    sensitive: Boolean((t as { sensitive?: boolean }).sensitive),
    source: "registry",
  }),
);
```

### 4.4 `scripts/apps-gen/emit.ts` (`renderTiles` flattens to a per-tile list)

`GENERATED_TILES` becomes a FLAT, per-tile list sorted by TILE id (nothing consumes
it yet, so the shape is free — flat is cleanest for the eventual Slice-5 board
consumer). Each entry carries `appId` + the tile fields + app-level flags.

```ts
export interface GeneratedTile {
  id: string;        // tile id
  appId: string;     // owning App / domain id
  label: string;
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  home: boolean;
  guestExposed: boolean;
  sensitive: boolean;
  source: "feature" | "registry";
}

export function renderTiles(model: AppModel): string {
  const tiles = model.apps.flatMap((a) =>
    a.tiles.map((t) => ({
      id: t.id,
      appId: a.id,
      label: t.label,
      worldCol: t.worldCol,
      worldRow: t.worldRow,
      cols: t.cols,
      rows: t.rows,
      home: t.home,
      guestExposed: a.guestExposed,
      sensitive: a.sensitive,
      source: a.source,
    })),
  );
  const sorted = [...tiles].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // ... render each in fixed key order, deterministic (unchanged discipline) ...
}
```

`emit.test.ts`'s determinism + sorted-by-id assertion still holds (now sorts by
tile id, which for the current single-tile set is identical to the old app-id
sort). Keep the `GENERATED_TILES: readonly GeneratedTile[]` export name; consumers
in Slice 5 will read the flat list.

### 4.5 `apps/web/src/lib/tile-registry.ts` (`manifestToEntry` → N entries)

`manifestToEntry` returns `TileRegistryEntry[]` (one per tile); the union uses
`flatMap`. `home` now comes from the tile, not the app. `HOME_TILE` is UNCHANGED
(it already does `find((t) => t.home)` on tile-level entries).

```ts
function manifestToEntries(m: AppManifest): TileRegistryEntry[] {
  return m.tiles.map((tile) => {
    const viewComponent = tile.viewComponent;
    if (!viewComponent) {
      throw new Error(`feature manifest ${m.id} tile ${tile.id} has no viewComponent`);
    }
    return {
      id: tile.id,
      label: tile.label,
      component: tile.component,
      viewComponent,
      worldCol: tile.worldCol,
      worldRow: tile.worldRow,
      cols: tile.cols,
      rows: tile.rows,
      ...(tile.home ? { home: true as const } : {}),
    };
  });
}

export const TILE_REGISTRY: TileRegistryEntry[] = [
  ...REGISTRY_ENTRIES,
  ...FEATURE_MANIFESTS.flatMap(manifestToEntries),
];
```

### 4.6 A single migrated manifest (weight — proves zero behaviour change)

```ts
export default defineApp({
  id: "tile_weight",
  tiles: [
    {
      id: "tile_weight",
      label: "Weight",
      component: WeightTile,
      viewComponent: WeightTileView,
      worldCol: 34,
      worldRow: 22,
      cols: 3,
      rows: 2,
    },
  ],
});
```

App id and the one tile id both stay `tile_weight` → `manifestToEntries` yields the
byte-identical `TileRegistryEntry` it did before. Same for the other five.

### 4.7 A multi-tile manifest sketch (weather — PROVES the shape; NOT authored in F0)

This is illustrative only — F-weather (a later wave) writes it. Included here to
prove the F0 contract actually supports the target end-state.

```ts
export default defineApp({
  id: "weather",
  tiles: [
    {
      id: "tile_weath",
      label: "Weather Now",
      component: WeatherNow,
      viewComponent: WeatherNowView,
      worldCol: 26, worldRow: 24, cols: 4, rows: 3,
    },
    {
      id: "tile_hourly",
      label: "Next 12 Hours",
      component: Next12Hours,
      viewComponent: Next12HoursView,
      worldCol: 22, worldRow: 24, cols: 4, rows: 3,
    },
  ],
});
```

One App (`weather`), two tiles with distinct ids, distinct rects (validator's
intra-app overlap check passes), neither `home`. This is exactly what F0 must
enable — and does.

---

## 5. Tests (the multi-tile proof)

Since `collect()` reads the REAL `features/` dir (which stays all-single-tile after
F0), the multi-tile proof lives at the validate / emit / define-app unit level over
SYNTHETIC models — do NOT add a throwaway feature folder (it would pollute
`features/`, the codegen, and the board). Concretely:

1. **`app-kit/define-app.test.ts`** — add: authoring a two-tile manifest passes
   through and brands; `home` is readable on a tile. Update the existing single-tile
   test to the `tiles: [...]` shape.
2. **`scripts/apps-gen/validate.test.ts`** — update the `app()` helper to build
   `tiles: [...]`, then ADD:
   - a single App with TWO non-overlapping tiles, exactly one `home` → passes.
   - the same App with a SECOND `home` tile → throws `/exactly one home/`.
   - two tiles of the SAME app that overlap → throws `/overlap/` (proves intra-app
     overlap is caught).
   - two tiles (any apps) sharing a tile id → throws `/duplicate tile id/`.
   - keep the existing dup-app-id / guestExposed / dup-table / dup-router-key cases
     passing under the new shape.
3. **`scripts/apps-gen/emit.test.ts`** — determinism/sorted-by-id still asserted;
   optionally add a synthetic two-tile model asserting BOTH tiles render, flattened
   and sorted by tile id.
4. **`scripts/apps-gen/collect.test.ts`** — unchanged in intent; adjust any field
   access that moved (`.tile` → `.tiles[0]`, app-level `home` gone). Still asserts
   the real model validates.

---

## 6. Validator changes summary

| Check | Before | After |
|---|---|---|
| dup app id | over `model.apps` | UNCHANGED |
| dup tile id | (none — app id was tile id) | NEW: over all tiles of all apps |
| exactly one home | count `a.home` per app | count `t.home` over ALL tiles of ALL apps |
| no tile-rect overlap | over apps (one rect each) | over ALL tiles of ALL apps incl. intra-app |
| dup table / router key / job | unchanged | UNCHANGED |
| guestExposed ↔ allowlist | per app | UNCHANGED (stays app-level) |

---

## 7. Migration of existing manifests (ATOMIC — same commit)

All SIX current single-tile manifests migrate `tile: {...}` → `tiles: [{ id, ...}]`,
tile id == current app id, verbatim coords, no `home` (none are home):

1. `features/guest-wifi/manifest.ts` — id/tile `tile_guestwifi`, keeps `guestExposed: true`.
2. `features/network/manifest.ts` — `tile_wifi`.
3. `features/tesla/manifest.ts` — `tile_tesla`.
4. `features/dogcam/manifest.ts` — `tile_dogcam`.
5. `features/weight/manifest.ts` — `tile_weight`.
6. `features/deploys/manifest.ts` — `tile_deploys`.

**All of the following MUST land in ONE commit** or `tsc` / `apps:check` breaks
mid-way (the type change makes every un-migrated manifest a type error, and the
regenerated `_generated` would drift from an un-regenerated committed copy):

- `app-kit/define-app.ts` (types) + `app-kit/define-app.test.ts`
- `scripts/apps-gen/{collect,emit,validate}.ts` + their `.test.ts`
- `apps/web/src/lib/tile-registry.ts` (`manifestToEntries` + union; `HOME_TILE`
  untouched)
- the six `features/*/manifest.ts`
- regenerated `features/_generated/tiles.gen.ts` (via `bun run apps:gen` — NEVER
  hand-edited). Only `tiles.gen.ts` changes shape; router/guest-router/schema/
  crons/jobs gen files are unaffected by F0 but re-run them anyway (apps:gen writes
  all of them) and commit whatever `apps:gen` produces.

**If a `notif` manifest has landed by implementation time (PLACEHOLDER-A), migrate
it in the same commit too.**

---

## 8. Zero behaviour change to the existing tiles — YES

F0 is pure contract widening + mechanical migration:

- Every existing app id is unchanged; every tile id == its old app id; every
  coord/label/component unchanged; no tile's `home` changes (clock stays home via
  the registry, which F0 does not touch).
- `manifestToEntries` yields byte-identical `TileRegistryEntry` objects → identical
  `TILE_REGISTRY` → identical board, minimap, placeholder-tiles bento,
  `board_tile_placement` matching, and `HOME_TILE`.
- `tiles.gen.ts` bytes change (new flat per-tile shape) but nothing consumes that
  file, so there is no runtime effect — it is a drift artifact only.

The only observable diff is the regenerated `tiles.gen.ts` and the source edits.
No user-facing behaviour moves.

---

## 9. Verify chain (run in order, all green before push)

```
bun run apps:gen        # regenerate _generated (writes tiles.gen.ts new shape)
bun run typecheck       # every manifest + collect/emit/validate/tile-registry type-clean
bun run test -- scripts/apps-gen app-kit          # validator + emit + collect + define-app unit tests
bun run test -- placeholder-tiles                 # bento 1x1 clearance unaffected (memory: bento-tiler-1x1-clearance)
bun run test -- tile-title-sync                   # label<->title guard still holds
bun run apps:check      # committed _generated matches a fresh render (no drift)
bun run knip            # zero-tolerance: no unused export left by the rename (manifestToEntry -> manifestToEntries)
bun run lint            # biome (note: _generated is biome-ignored; source must pass)
```

Then commit + push to `main` (pre-approved). If `apps:check` reports drift, it means
`apps:gen` was not re-run or its output not committed — re-run and re-stage the
`_generated` file; never hand-edit it.

**Full test suite** (`bun run test`) once before push, since `manifestToEntries`
touches the tile registry that many web tests import.

---

## 10. Commit message (no backticks)

```
feat(app-kit): support N tiles per App manifest; move home to tile level (F0)

Replace singular AppManifest.tile with tiles: TileSpec[] and add a required
per-tile id, so one feature can own multiple tiles (weather, calendar folds).
Move home? from the App onto TileSpec; the validator now enforces exactly one
home tile across all tiles of all apps and rejects tile-rect overlap across
every tile pair including two tiles of the same app, plus a new duplicate
tile-id check. collect/emit flatten to a per-tile model; manifestToEntry
returns N registry entries. Migrate all six folded manifests to the one-element
tiles array (ids and coords verbatim) and regenerate features/_generated. Pure
contract widening: zero behaviour change to existing tiles.
```

---

## 11. Gotchas (implementer MUST heed)

- **Atomic commit:** type change + six manifest migrations + collect/emit/validate
  + tile-registry + regenerated `_generated` in ONE commit. A partial commit
  red-builds CI.
- **Never hand-edit `features/_generated/*.gen.ts`** — run `bun run apps:gen`.
- **knip zero-tolerance:** renaming `manifestToEntry` → `manifestToEntries` must not
  strand the old name; grep for other importers first (there are none today, but
  confirm). Any newly-unused export fails `knip`.
- **`bun build`/codegen reads CWD tsconfig:** `apps:gen`/`apps:check` already `cd
  apps/web` (they import TILE_REGISTRY's `@/*` tiles). Do not run the script from
  repo root — use the package.json scripts.
- **`features/* → apps/api` boundary** (Biome `noRestrictedImports`): F0 touches
  only `app-kit`, `scripts`, `apps/web/src/lib`, and manifests — none may reach into
  `apps/api`. The manifests already only import `@app-kit` + `./web`. Keep it so.
- **Shared main checkout + peers push:** stage EXPLICIT paths (memory
  `never-git-add-all-shared-checkout`), never `git add -A` (concurrent sessions'
  dirty files). `git pull --rebase --autostash` before push. Absolute paths in
  Bash (agent-thread cwd resets). No backticks in `-m`. The lefthook format hook
  re-stages the tree — verify `git show --stat HEAD` after commit that only F0
  files rode along.
- **Do not fold any tile.** F0 is contract-only. Resist "while I'm here" folding
  weather — that is F-weather, a later wave.
- **`sensitive` and `guestExposed` stay app-level** — do not move them to the tile.
- **`HOME_TILE` and the 14 registry entries are already tile-level** — leave
  `HOME_TILE` and `TileRegistryEntry.home` alone; only the App/manifest side moves.

---

## 12. Open questions (PLACEHOLDER markers)

- **PLACEHOLDER-A (coordination):** the task brief lists a seventh "notif landing"
  manifest, but no `features/notif*` folder exists in-tree today (only the six).
  IF a notif manifest lands before/with F0, migrate it in the SAME atomic commit;
  if not, F0 migrates exactly six. Implementer: re-list `features/` at start and
  migrate whatever single-tile manifests exist.
- **PLACEHOLDER-B (tile id vs app id for single-tile registry entries):** this plan
  keeps App id == tile id for all single-tile apps and all 14 registry leftovers.
  That means `guestExposed` (keyed on App id) and the new dup-tile-id check both see
  `tile_guestwifi` etc. This is consistent today. The residual question for LATER
  folds (not F0): when `features/weather` uses App id `weather` (≠ any tile id),
  confirm `GUEST_EXPOSED` and any App-id-keyed consumer are unaffected (weather is
  not guest-exposed, so moot for weather — but F-media/F-calendar planners should
  re-confirm for any guest-exposed multi-tile App). F0 itself is unaffected.
```
