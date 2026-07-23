# Review: Fold `tile_tesla` into `features/tesla/`

**Verdict: APPROVE-WITH-FIXES**

The plan is well-researched and matches the network/guest-wifi precedent closely.
Coords, env defaults, HA-client construction, boundary rules, guestExposed
handling, and the "no worker interval" claim all check out against the real
code. Two concrete gaps need fixing before/while executing; neither invalidates
the overall approach.

## Findings

1. **[MAJOR] Commit staging list omits `features/_generated/*.gen.ts`.**
   The plan's "Commit" section `git add` list stages only
   `features/tesla/`, `tile-registry.ts`, `TeslaTileView.stories.tsx`,
   `TeslaTileView.stories.test.tsx`, and `routers/index.ts`. It never adds
   `features/_generated/router.gen.ts` / `tiles.gen.ts` (and possibly
   `guest-router.gen.ts`), even though step 1 of the plan's own verify chain
   says `bun run apps:gen` "regenerates `features/_generated/*.gen.ts`;
   confirm `tile_tesla` now comes from `features/tesla/manifest.ts` in the
   diff." These generated files are checked-in per AGENTS.md
   ("emitted to checked-in `features/_generated/*.gen.ts`... never hand-edit"),
   and the actual precedent commit for the network fold
   (`7434656db`, `git show --stat`) shows `features/_generated/router.gen.ts`
   and `features/_generated/tiles.gen.ts` staged in the SAME atomic commit.
   Fix: add `features/_generated/` (or the specific changed files) to the
   `git add` list in the Commit section.

2. **[MINOR] Service-sketch omits the `HaEntity` type import repoint.**
   The real `apps/api/src/services/tesla-service.ts` imports
   `import type { HaEntity } from "../integrations/homeassistant/types"`.
   The plan's "HA client construction" sketch only shows the `ha` singleton
   being replaced by `createHomeAssistantClient(...)`; it never mentions this
   type import, which is itself an `apps/api/**` path and would trip the
   Biome `noRestrictedImports` boundary rule if copied verbatim into
   `features/tesla/service.ts`. The type is directly available as
   `import type { HaEntity } from "@www/core"` (confirmed:
   `packages/core/src/homeassistant/index.ts` re-exports it, and
   `apps/api/src/integrations/homeassistant/types.ts` is itself just a
   re-export shim over `@www/core`). Not a blocker — `bun run lint` in the
   verify chain (step 6) would catch the boundary violation immediately and
   the fix is a one-line import swap — but worth calling out explicitly so
   the implementer doesn't burn a cycle rediscovering it.

3. **[MINOR] `TeslaMap.tsx`'s import of `@/config/home` (`HOME_CENTER`) is
   unaddressed in the move table.** `apps/web/src/config/home.ts` is shared
   by the moving `TeslaMap.tsx` and three files that stay put
   (`ClockGreeting.tsx`, `TeslaModalLiveMapCommand.tsx`,
   `TeslaModalRangeReach.tsx`, confirmed by grep). This is almost certainly
   fine — `features/tesla/tesla-map.tsx` importing `@/config/home` is exactly
   the same category of import as `@/lib/trpc`/`@/components/ui` that
   network/guest-wifi already use, and the Biome boundary rule only restricts
   `apps/api` reach, not `apps/web` `@/` aliases — but the plan's file-move
   table and code sketch don't mention this import at all, so it's worth
   flagging as a "verify this import survives the copy unchanged" note rather
   than a silent gap.

## Verified as correct

- Coords copied exactly: `worldCol: 22, worldRow: 27, cols: 4, rows: 4`
  matches `apps/web/src/lib/tile-registry.ts:108-115` byte-for-byte.
- `guestExposed`: tesla is absent from both the tile-registry entry and
  `features/guest-exposed.ts`'s `GUEST_EXPOSED` allowlist (`["tile_guestwifi"]`
  only) — plan's "no allowlist edit needed" is correct, and the manifest
  sketch correctly omits `guestExposed` (matches `network/manifest.ts`, which
  also omits it; only `guest-wifi/manifest.ts` sets `guestExposed: true`).
- `FEATURE_MANIFESTS: AppManifest[]` union mechanism (the plan's PLACEHOLDER
  #1) is now resolved by reading the file: it's exactly the array-union
  pattern the plan guessed, wired the same way `networkManifest`/
  `guestWifiManifest` already are — `teslaManifest` slots in identically.
- Manifest/api/service sketches match `@app-kit`'s real `defineApp`,
  `@app-kit/server`'s real `router`/`publicProcedure` re-export
  (`app-kit/server.ts` → `apps/api/src/trpc/init`), and the real
  `apps/api/src/integrations/homeassistant/index.ts` singleton pattern
  ("each caller builds its own instance from its config slice") word for
  word.
- `env.ts` defaults for `HA_URL`/`HA_TOKEN`/`TESLA_ENTITY_PREFIX`/
  `HOME_LAT`/`HOME_LON`/`HOME_PLACE_NAME`/`HOME_RADIUS_MILES` match the
  plan's `config.ts` sketch exactly; `climate-service.ts` only reads
  `env.TESLA_ENTITY_PREFIX` from its own env, confirming no import of
  anything that moves — correctly left untouched.
- No worker/cron file anywhere references `tesla` (`apps/worker/`,
  `apps/api/src/`, `infra/`) — the plan's "no worker interval to hand-wire"
  claim is correct; nothing invented, nothing left dangling.
- `TeslaMap.tsx` (146 lines) has no other real importer besides
  `TeslaTileView.tsx` and the moving `TeslaTile.test.tsx`/
  `TeslaTileView.test.tsx` — the other grep hits were comments/prose
  mentions, not imports. `tesla-service.ts`/`routers/tesla.ts`/
  `config/places.ts` have no importers outside the files the plan already
  accounts for.
- `TeslaTileView.stories.test.tsx` imports only `from "../TeslaTileView.stories"`
  (relative, composed via `composeStories`) — no direct Tesla component
  import, confirming the plan's "verify only, no repoint needed" call.
- `apps/web/vitest.config.ts`'s `../../features/**/web*.test.tsx` glob does
  match both `web.test.tsx` and `web-view.test.tsx` (plan's PLACEHOLDER #2) —
  confirmed by the glob text itself and by `features/network/web-view.test.tsx`
  already existing and being collected today.
- Biome `noRestrictedImports` rule (`biome.json` line ~168) confirms the
  boundary is scoped exactly as the plan assumes: `features/` may not import
  `apps/api/**`, full stop — `@www/core`, `@app-kit`, `@app-kit/server`, and
  `apps/web`'s `@/**` aliases are all unrestricted.
- Line counts in the plan's file-moves table (`TeslaTile.tsx` 32,
  `TeslaTileView.tsx` 181, `TeslaMap.tsx` 146, `routers/tesla.ts` 80,
  `tesla-service.ts` 204, `config/places.ts` 54) all match `wc -l` exactly.

## Receipt for orchestrator

review: `docs/superpowers/plans/units/2026-07-23-fold-tesla.review.md`
verdict: APPROVE-WITH-FIXES
blockers: 0, major: 1, minor: 2
