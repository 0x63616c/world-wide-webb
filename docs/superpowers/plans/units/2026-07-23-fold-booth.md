# Unit F-booth — Fold the Photo Booth tile into `features/booth`

Track C, final tile fold. **`tile_booth` is the LAST unfolded board tile** — after
this, `REGISTRY_ENTRIES` in `apps/web/src/lib/tile-registry.ts` is EMPTY and every
tile comes from a feature manifest.

Fold `tile_booth` ("Photo Booth") into one `features/booth/` App that owns:

- the `boothPhoto` table (`booth_photo`),
- the `boothPhotos` tRPC router (list / remove / clearFilter),
- the booth-photo service (save / list / soft-delete / clear-filter / read /
  default-root / group-id / mode+filter constants),
- the booth-photo **upload** http facet (`POST /media/booth-photo`, moved out of
  the interim `apps/api/src/http/booth.http.ts`),
- and the Photo Booth tile's full web closure (tile face + the full-bleed
  camera⇄gallery detail pager, the client-side capture/GIF pipeline, and the
  filter definitions).

**Direct template: the JUST-LANDED `features/wakes/` fold** (plan
`docs/superpowers/plans/units/2026-07-23-fold-wakes.md`). **Booth is wakes MINUS**:
the interaction-session service (no `service.ts` derivation layer), the
`sessions` second router key, the wake-photo-purge cron (**booth has NO purge — no
`jobs.ts`**), and the `@features/felogs/schema` cross-read. Booth adds nothing
wakes lacks except a client-side GIF encoder shim (`gifenc`). Also mirror
`features/network/` + `features/guest-wifi/` for single-tile shape and
`features/weather/{config,db}.ts` for the feature's own Postgres handle.

**ONE atomic commit.** Codegen only collects a facet once `manifest.ts` exists,
and the base router-key / table / http-route / interim-entry deletions must be
simultaneous with the feature's arrival or `apps:check` throws (dup router-key /
dup table / dup route). Do NOT split "add feature" then "delete base".

**START GATE — none.** Booth has no cross-feature dependency (unlike wakes→felogs).
`features/wakes/` is already landed (`photo-path-migration.ts` already imports
`@features/wakes/{photos,schema}` at HEAD), so `apps/api/src/startup/photo-path-migration.ts`
just gains a second `@features/booth/*` import. Implement immediately.

---

## The tile (verbatim, from `apps/web/src/lib/tile-registry.ts:68-77`)

| field          | value          |
| -------------- | -------------- |
| `id`           | `tile_booth`   |
| `label`        | `Photo Booth`  |
| `worldCol`     | `30`           |
| `worldRow`     | `22`           |
| `cols`         | `2`            |
| `rows`         | `2`            |
| `guestExposed` | **not set**    |
| `home`         | **not set**    |

- **NOT home.** Home is the Clock (`features/events`). A stray `home` makes two →
  `validate.ts` throws. Do NOT set it.
- **NOT guest-exposed.** `GUEST_EXPOSED` (`features/guest-exposed.ts`) is
  `["tile_guestwifi"]` only. Do NOT set `guestExposed`; do NOT touch the
  allowlist. `validate.ts` cross-checks flag⇔allowlist; both absent is consistent.
- **`component === viewComponent === PhotoBoothTile`.** Unlike wakes (which had a
  separate `WakesTileView`), the registry entry uses `PhotoBoothTile` for BOTH
  `component` and `viewComponent`. Keep that in the manifest.
- **Label MUST match the rendered `TileHeader` title** — `PhotoBoothTile` renders a
  standard `TileHeader` titled `"Photo Booth"`. `"Photo Booth"` matches; the
  `tile-title-sync` guard stays green.
- **Coords VERBATIM.** 2×2 at col 30 / row 22. Deleting the registry entry and
  re-adding the identical rect via the manifest nets to the SAME rect → board
  layout byte-identical. (Memory `bento-tiler-1x1-clearance` is about 1×1; this is
  2×2, lower risk, but run the placeholder-tiles / bento test regardless.)

---

## Target layout: `features/booth/`

```
features/booth/
  manifest.ts        # defineApp, id "tile_booth", single tile (VERBATIM coords), PhotoBoothTile for both slots
  api.ts             # defineApi(router({ boothPhotos }))
  service.ts         # booth-photo service (was booth-photo-service.ts)
  http.ts            # POST /media/booth-photo (was apps/api/src/http/booth.http.ts)
  schema.ts          # boothPhoto pgTable (from apps/api db/schema.ts:135-179)
  config.ts          # z.object({ DATABASE_URL, MEDIA_STORAGE_DIR }).parse(process.env) — COPY wakes verbatim
  db.ts              # drizzle(createPool(config.DATABASE_URL), { schema }) — COPY wakes verbatim
  web.tsx            # barrel: re-export PhotoBoothTile from ./web
  web/               # the 18-file Photo Booth web closure (see §Web move)
  service.test.ts    # moved from booth-photo-service.test.ts
```

**NO `jobs.ts`** — there is no booth purge (grep-confirmed: `apps/api/src/purge.ts`
has zero booth refs; no `purgeBooth*` anywhere). Booth photos are retained
indefinitely by design (deliberate captures, unlike the automatic wake burst).
Do NOT invent a cron. This is the single biggest simplification vs. wakes.

### `manifest.ts` (single-tile; `PhotoBoothTile` for both slots)

```ts
import { defineApp } from "@app-kit";
import { PhotoBoothTile } from "./web";

export default defineApp({
  id: "tile_booth",
  tiles: [
    {
      id: "tile_booth",
      label: "Photo Booth",
      component: PhotoBoothTile,
      viewComponent: PhotoBoothTile,
      worldCol: 30,
      worldRow: 22,
      cols: 2,
      rows: 2,
    },
  ],
});
```

App `id === tile id === "tile_booth"`. Use `tiles: [ … ]` (verified: every landed
single-tile feature uses the array form).

### `web.tsx` — barrel

```ts
// features/booth/web.tsx
export { PhotoBoothTile } from "./web/PhotoBoothTile";
```

### `api.ts` — ONE router key (`boothPhotos`)

Move `apps/api/src/trpc/routers/booth-photos.ts` verbatim, then:

- swap the tRPC runtime import `../init` → `@app-kit/server`
  (`import { publicProcedure, router } from "@app-kit/server";`),
- repoint `import { db } from "../../db/index"` → `./db`,
- repoint the service import
  `import { …, listBoothPhotos, softDeleteBoothGroup, clearBoothGroupFilter,
  BOOTH_PHOTO_MODES } from "../../services/booth-photo-service"` → `./service`,
- brand with `defineApi`. Follow `features/wakes/api.ts`'s exact shape (it wraps
  its router in `defineApi(router({ … }))`), but with a SINGLE key:

```ts
import { defineApi } from "@app-kit";
import { publicProcedure, router } from "@app-kit/server";
import { z } from "zod";
import { db } from "./db";
import {
  BOOTH_PHOTO_MODES,
  clearBoothGroupFilter,
  listBoothPhotos,
  softDeleteBoothGroup,
} from "./service";

const boothPhotosRouter = router({ /* list / remove / clearFilter — verbatim bodies + zod schemas */ });

export const api = defineApi(router({ boothPhotos: boothPhotosRouter }));
```

- `collect.ts` reads keys off `api._def.record` → `boothPhotos` merges into
  `featureAppRouter`. `validate.ts` rejects a dup router key → the base mount of
  `boothPhotos` MUST be deleted in the same commit (§Deletions).

### `service.ts` (booth-photo service)

Move `apps/api/src/services/booth-photo-service.ts` verbatim, then:

- `import { boothPhoto } from "../db/schema"` → `./schema`.
- `import type * as schema from "../db/schema"` → `./schema`.
- `import { env } from "../env"` → **delete**; read `config.MEDIA_STORAGE_DIR`
  from `./config` (`defaultBoothPhotoRoot()` uses
  `join(env.MEDIA_STORAGE_DIR, "booth-photos")` →
  `join(config.MEDIA_STORAGE_DIR, "booth-photos")`). Apps/api default is
  `/mnt/media` (`env.ts:59`); wakes `config.ts` already mirrors it — copy verbatim.
- `@www/core` (`nextFreeName`) + `@www/logger` (`getLogger`) — unchanged.
- Exports to KEEP (all have live consumers post-fold, so knip stays clean):
  `saveBoothPhoto` (http.ts), `listBoothPhotos` / `softDeleteBoothGroup` /
  `clearBoothGroupFilter` (api.ts), `newBoothGroupId` + `BOOTH_PHOTO_MODES` +
  `BOOTH_FILTER_PATTERN` + `BoothPhotoMode` (http.ts), `readBoothPhoto`
  (server.ts serve route via `@features`), `defaultBoothPhotoRoot`
  (photo-path-migration via `@features`).

### `http.ts` (the collected booth-photo upload route)

Move `apps/api/src/http/booth.http.ts` verbatim, then:

- `import { db } from "../db/index"` → `./db`.
- the service import (`BOOTH_FILTER_PATTERN`, `BOOTH_PHOTO_MODES`,
  `BoothPhotoMode`, `newBoothGroupId`, `saveBoothPhoto`) from
  `"../services/booth-photo-service"` → `./service`.
- `defineHttp` from `@app-kit` — unchanged.

`collect.ts:282-290` (Source A) scans `features/<dir>/http.ts` for the
`HTTP_FACET_BRAND` array and emits it with ident `${ident("booth")}Http` =
**`boothHttp`** (dir has no hyphens) and importPath `../booth/http`, source
`feature:booth`. **This replaces the interim collection** — delete the interim
entry (§Deletions).

### `config.ts` + `db.ts`

**Copy `features/wakes/{config,db}.ts` VERBATIM** (same two keys, same defaults,
same lazy `createPool`). Only the doc-comment "wakes"→"booth" wording differs.
`db.ts`'s `schema` is booth-only (`boothPhoto`).

### `schema.ts`

Move `boothPhoto` (`apps/api/src/db/schema.ts:135-179`) verbatim — same SQL table
name (`booth_photo`), same columns, same indexes (`booth_photo_group_idx`,
`booth_photo_captured_at_idx`). A rename would be a migration; do not rename.
Delete from `apps/api/src/db/schema.ts`. `boothPhoto` has NO FK.

- `drizzle db:generate` NOT needed (no DDL change; table moves packages, identical
  SQL). If the drizzle snapshot picks up the relocation, `bunx biome format --write`
  the meta dir before lint (memory `drizzle-generate-needs-biome-format`). Verify
  no unintended migration is emitted.
- When you delete `boothPhoto`, also delete the now-stale doc comment above it
  (`apps/api/src/db/schema.ts:114-133` — the wake/booth comparison prose). Grep for
  any remaining `boothPhoto` / `wakePhoto` reference left in `apps/api/src/db/`
  after the delete; both tables now live in features.

---

## Web move — the 18-file Photo Booth closure (FULL move, no shims)

Move the entire Photo Booth tile closure into `features/booth/web/` and DELETE the
originals (knip is zero-tolerance — no re-export shims). Verified closure (grep at
HEAD): no non-booth file imports any of these; the only three external importers
(`tile-registry.ts`, `detail/wiring/photo-booth.tsx`, `tile-title-sync.test.tsx`)
are handled in §External consumers.

**Group A — `apps/web/src/components/tiles/photo-booth/` (14):**
`BoothCamera.tsx`, `BoothCamera.stories.tsx`, `BoothCameraControls.tsx`,
`BoothCountdown.tsx`, `BoothGallery.tsx`, `BoothGallery.stories.tsx`,
`CameraStage.tsx`, `PhotoBoothPager.tsx`, `PhotoBoothPager.stories.tsx`,
`PhotoBoothTile.tsx`, `PhotoBoothTile.stories.tsx`, `camera-model.ts`,
`useBoothCapture.ts`, `useCameraPreview.ts`.

**Group B — `apps/web/src/lib/` (2 + 1 test):**
`booth-capture.ts` (the client-side capture + GIF-assembly pipeline; consumers are
ALL booth: `BoothGallery`, `camera-model`, `useBoothCapture`) and `booth-filters.ts`
(the CSS filter catalog; consumers ALL booth: `camera-model`, `BoothGallery`,
`BoothCamera`). Plus its test `apps/web/src/lib/__tests__/booth-capture.test.ts`.

**Group C — `apps/web/src/components/tiles/detail/wiring/` (1):**
`photo-booth.tsx` (exports `photoBoothDetailEntry`) →
`features/booth/web/wiring/photo-booth.tsx`.

**= 18 files.** Suggested internal shape under `features/booth/web/`: the 14
photo-booth components at `web/` (drop the redundant `photo-booth/` nesting), the
two moved libs at `web/lib/`, the detail wiring at `web/wiring/photo-booth.tsx`,
tests beside their subjects.

### DO NOT MOVE — shared infra that STAYS in `apps/web` (scope guard)

- **`apps/web/src/types/gifenc.d.ts` — STAYS.** It is a package-type shim for the
  `gifenc` npm module, resolved by an explicit `paths` mapping in
  `apps/web/tsconfig.json:11` (`"gifenc": ["./src/types/gifenc.d.ts"]`), NOT by
  file location. The feature web closure is typechecked BY apps/web (see
  `tsconfig.config.json`'s `exclude: features/**/web/**` + its comment: web-coupled
  feature files are typechecked through apps/web's program). The moved
  `booth-capture.ts` keeps its bare `import … from "gifenc"`; apps/web's paths
  mapping resolves it. **Moving the .d.ts would break that mapping for no gain** —
  leave it. (Analogous to how wakes left `wake-capture.ts`.)
- **`apps/web/src/lib/device-id.ts` — STAYS** (`getDeviceId`, shared panel infra;
  `booth-capture.ts` imports it → repoint to `@/lib/device-id`).
- Everything under `@/components/ui`, `@/components/Icon`,
  `@/components/gallery/{PhotoGrid,group-by-day}`, `@/lib/{trpc,sound,hooks,tile-detail-store}`
  — shared, STAYS.

### Import-repoint rules (moved files use `@/` + relative imports internally)

**`@/` or relative import pointing at a MOVED file → feature-local relative:**

- Cross-references among the 14 components stay relative (all move together):
  `./camera-model`, `./BoothGallery`, `./useCameraPreview`, `./BoothCamera`,
  `./useBoothCapture`, `./PhotoBoothTile`, `./PhotoBoothPager`, `./CameraStage`,
  `./BoothCountdown`, `./BoothCameraControls` — unchanged.
- `../../../lib/booth-capture` and `../../../lib/booth-filters` (from the
  components) → feature-local (`../lib/booth-capture` / `../lib/booth-filters` per
  chosen `web/lib/` structure). Also the `@/lib/booth-capture` / `@/lib/booth-filters`
  variants (used by `PhotoBoothPager` / `BoothGallery`) → same feature-local path.
- `detail/wiring/photo-booth.tsx`:
  `@/components/tiles/photo-booth/PhotoBoothPager` → relative to the moved
  `PhotoBoothPager`; `../types` (detail types, STAYS in apps/web) →
  `@/components/tiles/detail/types`.
- `booth-capture.ts`: `./device-id` → `@/lib/device-id`; `gifenc` bare → unchanged.

**`@/` or relative import pointing at a file that STAYS → `@/`:**

- `@/components/ui` and `../../ui/Segmented` → `@/components/ui/Segmented`,
  `../../ui/Modal` → `@/components/ui/Modal`.
- `@/components/Icon` and `../../Icon` → `@/components/Icon`.
- `@/components/gallery/PhotoGrid`, `@/components/gallery/group-by-day` — keep `@/`.
- `@/lib/trpc`, `@/lib/hooks` (`POLL.wakePhotos`), `@/lib/tile-detail-store`
  (`closeTileDetail`) — keep `@/`.
- `../../../lib/sound` (`playCue`, from `useBoothCapture` + `PhotoBoothPager`) →
  `@/lib/sound`.
- npm specifiers (`react`, `lucide-react`, `gifenc`, `@capacitor/share`,
  `@capacitor/core`, `storybook/test`, `@storybook/react-vite`) — unchanged.

`features/tsconfig.json` maps `@/*` → `../apps/web/src/*`, so moved web files keep
importing shared UI via `@/`.

### External consumers that STAY in apps/web and repoint TO the feature

1. **`apps/web/src/lib/tile-registry.ts`** —
   - delete the `PhotoBoothTile` import (`:19`),
   - delete the `tile_booth` `REGISTRY_ENTRIES` entry (`:68-77`) — this leaves
     `REGISTRY_ENTRIES` an **EMPTY array** (`const REGISTRY_ENTRIES: TileRegistryEntry[] = []`);
     booth is the last hand-placed tile. Keep the `TileRegistryEntry` type +
     annotation. Replace the booth prose comment (`:63-67`) with a one-line note
     that booth folded into `features/booth/manifest.ts` (mirror the existing
     wakes/notif "used to live here" comments),
   - add `import boothManifest from "@features/booth/manifest"` (alphabetical among
     the other `@features/*/manifest` imports) and push `boothManifest` into
     `FEATURE_MANIFESTS` (mirror `weatherManifest` etc).
2. **`apps/web/src/components/tiles/detail/registry.ts`** — repoint the
   `photoBoothDetailEntry` import from `./wiring/photo-booth` (`:27`) to
   `@features/booth/web/wiring/photo-booth`. The `photoBoothDetailEntry` in the
   `ENTRIES` array (`:51`) is unchanged. Keeps `registry-entries.test.ts` green.
3. **`apps/web/.storybook/main.ts`** — its glob already includes
   `"../../../features/**/*.stories.@(ts|tsx)"` (weather/felogs verified). **No edit.**
4. **`apps/web/src/components/tiles/__tests__/tile-title-sync.test.tsx`** — already
   globs `features/*/web/**` for folded tiles (weather/felogs fixed this; do NOT
   re-fix). The moved `PhotoBoothTile.tsx` + its `"Photo Booth"` title are picked
   up automatically. Just confirm it stays green.

No other apps/web file imports any of the 18 moved files (verified by grep).

---

## Backend consumers outside the feature (repoint via `@features`, allowed)

`apps/api → @features` is permitted (`photo-path-migration.ts` already imports
`@features/wakes/*`). The `features/* → apps/api` ban is one-directional.

1. **`apps/api/src/server.ts`**
   - `:12` `import { readBoothPhoto } from "./services/booth-photo-service"` →
     `@features/booth/service`.
   - `:170-172` the `GET /media/booth-photos/*` serve branch calls `readBoothPhoto`
     — the import repoints; the branch itself STAYS in the server ladder (DEFER: GET
     serve route stays in apps/api this unit, same call wakes made for its GET).
   - `:59` `migrated.wake + migrated.booth + migrated.orphans` — `migrated` is the
     `photo-path-migration` return; unchanged.
2. **`apps/api/src/startup/photo-path-migration.ts`** (the wake⇔booth WELD)
   - `:10` `import { boothPhoto } from "../db/schema"` → `@features/booth/schema`.
   - `:11` `import { defaultBoothPhotoRoot } from "../services/booth-photo-service"`
     → `@features/booth/service`.
   - It already imports `@features/wakes/{photos,schema}` (`:3-4`) and `wakePhoto`;
     it now imports BOTH features. `db.update(boothPhoto)…` /
     `db.select().from(boothPhoto)` still typecheck (drizzle query builders accept
     any `pgTable`; the generic only types `db.query.*`). This module STAYS in
     `apps/api/src/startup/` — the master plan defers the un-weld to a
     `packages/platform` move (P1.6), out of scope here. Flag it, do not move it.
   - **Its test — NO booth change needed.**
     `apps/api/src/startup/photo-path-migration.test.ts` uses only `wakePhoto` as a
     table-identity token (`t === wakePhoto ? wake : booth` at `:31`) — already
     imported from `@features/wakes/schema` (wakes landed). The booth branch is the
     `else` and never references the `boothPhoto` object. So this test compiles and
     passes unchanged. (Confirm at implement time: `grep -n boothPhoto
     apps/api/src/startup/photo-path-migration.test.ts` returns nothing.)
3. **`apps/api/src/purge.ts`** — **NO edit.** Grep-confirmed it has zero booth
   refs; booth has no purge pass. Leave it.
4. **`apps/api/src/trpc/routers/index.ts`** — delete
   `import { boothPhotosRouter } from "./booth-photos"` (`:3`) and the mount
   `boothPhotos: boothPhotosRouter` (`:16`). The key now arrives via
   `featureAppRouter`.

No worker interval cycle or enforcer is involved. There is NO cross-feature runtime
dependency (booth reads only its own tables).

---

## Codegen-test repoints (the interim→feature http migration + last-tile registry)

Moving `booth.http.ts` into the feature and folding the last registry tile changes
these tests. All must be updated in the same commit or the codegen/collect suite is
red:

1. **`scripts/apps-gen/collect.ts:144-149`** — delete the `booth` entry from
   `INTERIM_HTTP_MODULES`. The list becomes **empty** (`[] as const`-shaped, keep
   the type annotation). The `for (const entry of INTERIM_HTTP_MODULES)` loop at
   `:307` then iterates nothing — fine. (The module's doc comment already says
   "Empty in commit 1 of S3"; it is empty again now, permanently.)
2. **`scripts/apps-gen/collect.test.ts`** — TWO edits:
   - **The last-registry-tile assertion (~`:22-25`):** the test asserts
     `model.apps.find((a) => a.id === "tile_booth")?.source).toBe("registry")` with a
     comment calling tile_booth "a still hand-placed example". After the fold booth
     is `source: "feature"` AND no hand-placed tile remains. **Delete this
     assertion + its comment block** (there is no longer any registry-sourced tile
     to assert on). Do not swap in another tile — `REGISTRY_ENTRIES` is empty.
   - **The interim-booth test (`:44-54`):** rewrite it to mirror the existing
     wakes feature-source test (`:59-68`). Assert the booth route now sources from
     the feature:
     `model.httpRoutes` contains
     `{ method: "POST", path: "/media/booth-photo", match: "exact", source: "feature:booth" }`,
     and `model.httpModules.map((m) => m.ident)` contains `"boothHttp"`. Drop the
     old `source: "interim:booth"` assertion. Rename the `it(...)` title to reflect
     the feature source (e.g. "sources the booth-photo route from the booth feature,
     not the interim list").
3. **`scripts/apps-gen/emit.test.ts:25`** — the import-barrel string
   `import { routes as boothHttp } from "../../apps/api/src/http/booth.http";` →
   `import { routes as boothHttp } from "../booth/http";`. **The ident stays
   `boothHttp`** (dir "booth" → `boothHttp`), so `:27`'s
   `expect(a).toContain("...boothHttp")` is UNCHANGED — only the import path string
   changes. Update the test title if it still says "wake + booth interim".
4. **`apps/api/src/http/__tests__/route-table.test.ts`** — **NO booth edit.** It has
   NO `vi.mock` for the booth service (only wake). Its booth assertion (`:92-96`)
   just checks `GENERATED_ROUTES` contains `POST /media/booth-photo` via
   `toBeDefined()` — still holds (route now feature-sourced). Confirm green; do not
   touch.

---

## Deletions (all in the ONE atomic commit)

1. `apps/web/src/lib/tile-registry.ts` — `tile_booth` entry + `PhotoBoothTile`
   import; add `boothManifest` → `FEATURE_MANIFESTS` (`REGISTRY_ENTRIES` → empty).
2. `apps/api/src/trpc/routers/index.ts` — `boothPhotosRouter` import + mount.
3. `apps/api/src/trpc/routers/booth-photos.ts` — delete (→ feature `api.ts`).
4. `apps/api/src/services/booth-photo-service.ts` — delete (→ `service.ts`).
5. `apps/api/src/http/booth.http.ts` — delete (→ feature `http.ts`); + the `booth`
   entry in `INTERIM_HTTP_MODULES` (list → empty).
6. `apps/api/src/db/schema.ts` — delete the `boothPhoto` table + its stale doc
   comment.
7. `apps/api/src/services/booth-photo-service.test.ts` — delete (→
   `features/booth/service.test.ts`).
8. The 18 web files (Groups A-C) — delete originals under `apps/web/src/`. After the
   move, `apps/web/src/components/tiles/photo-booth/` is EMPTY — remove the dir.

**knip is zero-tolerance, whole tree** — after moving, `bun run knip`; chase every
newly-orphaned export to zero (no shims). Every booth-service export retains a live
consumer (§service.ts) so none should orphan; verify.

---

## Tests to move / add

Backend:

- `apps/api/src/services/booth-photo-service.test.ts` → `features/booth/service.test.ts`
  (repoint `./booth-photo-service` → `./service`; it uses `mkdtemp` temp roots, no
  env dep once `defaultBoothPhotoRoot` reads `config`). Update the header comment
  `booth-photo-service.test.ts:23` (it says "mirrors wake-photo-service.test.ts",
  which now lives at `features/wakes/photos.test.ts` — cosmetic).

Web (Group A/B tests — move alongside subjects, repoint relative imports):
the `*.stories.tsx` under photo-booth (BoothCamera / BoothGallery / PhotoBoothPager
/ PhotoBoothTile) move with their components; `apps/web/src/lib/__tests__/booth-capture.test.ts`
→ `features/booth/web/lib/booth-capture.test.ts` (`../booth-capture` → `./booth-capture`).

Codegen tests: `collect.test.ts`, `emit.test.ts` — updated in place (§Codegen-test
repoints). `route-table.test.ts` — no change.

Regression guards that MUST stay green (run explicitly):

- `apps/web` **placeholder-tiles / bento** — the `tile_booth` 2×2 rect is
  byte-identical pre/post. Core regression guard.
- `registry-entries.test.ts` (detail completeness) — `photoBoothDetailEntry` stays
  registered via the repointed `detail/registry.ts` import.
- `tile-title-sync` — `"Photo Booth"` label ⇔ `TileHeader title="Photo Booth"`.
- collect's real-registry guard test (`:11`, guest-wifi dedupe) — still passes with
  an empty `REGISTRY_ENTRIES` (collect unions FEATURE_MANIFESTS + empty registry;
  home still comes from `features/events`, so `validate` still sees exactly one home).

---

## Verify chain (IMPLEMENTER runs ALL, in order, with real output)

```
cd <repo root>
bun run apps:gen                       # regenerate features/_generated/*.gen.ts
bun run typecheck                      # all programs (cd apps/api if a bun build alias needs CWD tsconfig)
bunx vitest run \
  scripts/apps-gen \                   # collect/emit incl. the interim→feature booth http + last-registry-tile edits
  features/booth \                     # moved backend + web tests
  apps/api/src/http/__tests__/route-table.test.ts \   # booth dispatch (unchanged, must stay green)
  apps/api/src/startup/photo-path-migration.test.ts \ # booth import repoint (module) — test itself unchanged
  apps/web/src/lib/__tests__/placeholder-tiles* \      # bento gap-free (glob actual path)
  apps/web/src/components/tiles/detail                 # registry-entries + tile-title-sync
bun run apps:check                     # codegen drift + validator (dup id/router-key/table, =1 home, no overlap, guestExposed⇔allowlist)
bun run knip                           # zero-tolerance, whole tree
bun run lint                           # Biome dep-boundary: NO features/booth/* → apps/api import
```

Confirm after `apps:check`:

- `features/_generated/tiles.gen.ts` has `tile_booth`, `appId: "tile_booth"`,
  `source: "feature"`, exactly once, coords 30/22/2×2.
- `features/_generated/router.gen.ts` mounts `boothPhotos`.
- `features/_generated/schema.gen.ts` includes `booth_photo`.
- `features/_generated/http.gen.ts` imports `boothHttp` from `../booth/http` and
  registers `POST /media/booth-photo` (and NO leftover
  `../../apps/api/src/http/booth.http` import — that line goes; only `wakesHttp`
  from `../wakes/http` and `boothHttp` from `../booth/http` remain).
- `features/_generated/crons.gen.ts` — UNCHANGED (booth adds no cron).
- Biome dep-boundary: no surviving `features/booth/* → apps/api/*` import; no
  cross-feature import at all (booth reads only its own tables).

Then commit + push + watch CI to green (FOREGROUND `gh run watch --exit-status`;
do not yield to a monitor — memory `subagent-background-wait-stalls`). Confirm
deploy green + pod image age (memory `ci-cancelled-runs-strand-image-digests`).

**Fix-forward on red** — never leave unpushed work.

---

## Git hygiene (SHARED tree, peer dirt present)

```
git pull --rebase --autostash          # FIRST; parallel sessions push main
git add <explicit paths>               # NEVER git add -A (memory never-git-add-all-shared-checkout)
git commit -m "…"                      # NO backticks
git show --stat HEAD                    # after commit: MUST list your FULL fileset with insertions
git push                                # or --no-verify iff hook blocks on UNRELATED peer dirt AND your diff is independently clean
```

- `git add` can silently abort on an already-`git rm`'d pathspec — after commit,
  `git show --stat HEAD` MUST show your full moved/deleted/added fileset (the ~18
  web files + 4 backend files + schema/registry/index/server/migration/collect/emit
  edits + the new `features/booth/*`), not an empty/partial commit. If partial,
  re-stage explicitly and amend.
- If the pre-push `lint:tracked` hook blocks on UNRELATED peer dirt and your own
  diff is independently clean, push with `git push --no-verify` (sanctioned escape).
- `lefthook` format re-stages the whole tree (memory
  `lefthook-format-restages-whole-tree`) — stage explicit paths, re-check
  `git show --stat` before push.
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.

---

## Gotchas (inherit)

- `features/* → apps/api/*` is Biome-banned. Every moved backend file repoints to
  `@www/core`, `@app-kit`/`@app-kit/server`, or feature-local `./`. A single
  surviving `apps/api` import turns lint red.
- `apps/api → @features` and `apps/web → @features` are ALLOWED (used for
  server.ts / photo-path-migration / tile-registry / detail-registry repoints).
- `bun build` reads the **CWD** tsconfig paths (memory
  `bun-build-alias-needs-cwd-tsconfig`). `cd apps/api` for any apps/api build step;
  local typecheck/vitest can pass while a CI-only Docker build resolves
  `@features/booth/*` differently — watch the api + worker image builds go green.
- **ONE commit.** Codegen only collects once `manifest.ts` exists; base
  router/schema/http/interim deletions must be simultaneous or `apps:check` throws.
- No backticks in `git commit -m` (zsh command substitution).
- **`gifenc.d.ts` STAYS** (package-type shim via `apps/web/tsconfig.json` paths) —
  do NOT drag it into the feature (§DO NOT MOVE).
- **`REGISTRY_ENTRIES` goes EMPTY** — booth is the last tile. Keep the const +
  type annotation; delete the `PhotoBoothTile` import; delete the collect.test
  "hand-placed tile source registry" assertion (no subject remains).

---

## Commit message (no backticks)

```
feat(features): fold photo-booth tile into features/booth (Track C, final tile)

Photo Booth tile (tile_booth) now lives in one features/booth App owning the
boothPhotos router (list/remove/clearFilter), the booth_photo table, the
booth-photo service, and the booth-photo upload http facet moved out of the
interim apps/api/src/http/booth.http.ts (INTERIM_HTTP_MODULES now empty; the facet
collects from features/booth/http.ts via Source A). Full 18-file booth web closure
moved under features/booth/web/ (tile face, full-bleed camera/gallery detail pager,
client-side capture + GIF pipeline, filter catalog); the gifenc type shim stays in
apps/web as a package-resolved declaration. This is the last hand-placed board tile,
so REGISTRY_ENTRIES is now empty and every tile comes from a feature manifest. Base
router mount, service file, schema table, and codegen interim/registry tests
repointed/removed. server.ts + photo-path-migration read booth via @features. No
booth purge (booth has no cron). No coord or DDL change; board layout byte-identical.
```

---

## Resolved decisions (baked — no open plan questions)

- **MANIFEST-SHAPE → `tiles: [...]`, `PhotoBoothTile` for both `component` and
  `viewComponent`.** Matches the pre-fold registry entry (which used PhotoBoothTile
  for both slots) and every landed single-tile feature's array form.
- **NO `jobs.ts` / cron.** Grep-confirmed booth has no purge anywhere; do not
  invent one.
- **GET-ROUTE → DEFER (in scope: UPLOAD/POST only).** Leave the
  `GET /media/booth-photos/*` serve branch (`server.ts:170-172`) in the server
  ladder, repointing `readBoothPhoto` to `@features/booth/service`. Same call wakes
  made; the prefix serve-route move is a later http-seam pass.
- **`gifenc.d.ts` → STAYS** in `apps/web/src/types/` (resolved via
  `apps/web/tsconfig.json` paths, not location).
- **`photo-path-migration.test.ts` → NO booth change** (uses only the `wakePhoto`
  identity token, already `@features/wakes`; booth is the else-branch).

## PLACEHOLDER — open questions

_None._ Booth is a strict subset of the already-shipped wakes fold; every seam
(http Source A, feature db/config, @features backend repoints, storybook/title-sync
globs) is proven by wakes + weather + felogs. The only booth-specific judgment
calls (gifenc shim stays; REGISTRY_ENTRIES empties; no cron) are resolved above.
