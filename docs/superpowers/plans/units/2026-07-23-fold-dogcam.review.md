# Review: Fold `tile_dogcam` into features/dogcam/

**Verdict: APPROVE-WITH-FIXES**

Verified against real code: `apps/web/src/lib/tile-registry.ts`, `apps/api/src/services/camera-service.ts`,
`apps/api/src/trpc/routers/camera.ts`, `apps/api/src/trpc/routers/index.ts`, `apps/api/src/server.ts`,
`apps/web/src/components/tiles/DogCamTile(View).tsx`, `apps/web/src/components/tiles/detail/wiring/dogcam.tsx`,
`apps/web/src/components/tiles/DogCamTileView.stories.tsx`, `apps/api/src/env.ts`, `packages/core/src/homeassistant/*`,
`features/network/*`, `features/guest-wifi/manifest.ts`, `features/guest-exposed.ts`, `apps/api/vitest.config.ts`,
`apps/web/vitest.config.ts`, `knip.jsonc`. This is a faithful, well-precedented fold plan. No blockers found. Two
minor gaps below should be fixed before/while executing.

## Findings

1. [MINOR] `features/dogcam/config.ts`'s `HA_URL` default (`""`) silently diverges from `apps/api/src/env.ts`'s
   `HA_URL` default (`"http://homeassistant.local:8123"`, env.ts:17). Both read the same hydrated `process.env`, so
   in practice they resolve identically once `HA_URL` is actually set in the environment — but if `HA_URL` is ever
   *unset* in some deploy context, the two singletons (apps/api's `ha` for other not-yet-folded tiles, and dogcam's
   own client) would silently disagree on the HA base URL. Not a functional bug for this fold (getCameraInfo already
   tolerates `ha.isConfigured() === false`), but worth a one-line note in `config.ts`'s docstring acknowledging the
   default is intentionally weaker than apps/api's, or just match the real default for consistency. Fix: either copy
   env.ts's default verbatim or add a comment explaining the divergence is deliberate (config.ts already explains it
   reads "already-hydrated process.env" — a stray unset var is the only case this bites).

2. [MINOR] Task 4 Step 8's "Expected" claims `tiles.gen.ts`'s `tile_dogcam` entry transitions `source: "registry"` →
   `"feature"`, and Step 11 claims `apps:check` verifies `guestExposed` agreement — both correct per the
   `network`/`guest-wifi` precedent, but the plan never has the implementer *read*
   `scripts/apps-gen/validate.ts` before running it. Low risk (network/guest-wifi already prove the codegen path
   works), but if `apps:gen` throws on an edge case (e.g. dedup logic keying off label rather than id), the plan
   gives no fallback guidance beyond "re-grep for stray imports" (Step 9's guidance is typecheck-specific, not
   codegen-specific). Fix: add one sentence — "if `apps:gen` throws, read `scripts/apps-gen/validate.ts`'s dedup
   logic before treating it as a coords/id copy error."

## Verification detail (why no blockers)

- **Coords**: manifest.ts's `worldCol: 38, worldRow: 27, cols: 4, rows: 3, label: "Living Room Cam"` match
  `tile-registry.ts:139-147` exactly (byte-for-byte, confirmed by direct read). No overlap risk since geometry is
  unchanged — placeholder-tiles clearance cannot newly break.
- **guestExposed**: `tile_dogcam` correctly absent from `GUEST_EXPOSED` (`features/guest-exposed.ts` only lists
  `tile_guestwifi`); manifest.ts correctly omits the `guestExposed` key. Consistent both directions.
- **Atomicity**: Task 4 is explicitly the single commit point; Tasks 1-3 explicitly say "do not commit yet." Good —
  matches the gotcha about `manifest.ts` being required for codegen collection.
- **View inlining**: `features/dogcam/web.tsx` in the plan is a verbatim merge of the real
  `DogCamTile.tsx` + `DogCamTileView.tsx` (confirmed via direct diff-by-eye against both files) — same
  props (`live`, `recSecs`, `onToggleLive`, etc.), same JSX, no behavior drift. `detail/wiring/dogcam.tsx`'s prop
  usage of `DogCamTileView` matches the inlined signature exactly.
- **Stories stay under apps/web**: confirmed, only the component import line changes; the stories test
  (`DogCamTileView.stories.test.tsx`) is untouched and still imports the co-located stories file — correct.
- **vitest wiring**: both `apps/api/vitest.config.ts` (`../../features/**/{service,api}.test.ts`) and
  `apps/web/vitest.config.ts` (`../../features/**/web*.test.tsx`) already glob-pick-up the new files with zero
  edits, confirmed by reading both configs — matches the plan's "NO EDITS NEEDED" claim.
- **`@www/core` HA surface**: `createHomeAssistantClient` and `type HaEntity` are real, confirmed exports from
  `packages/core/src/homeassistant/index.ts` (re-exported through `@www/core`'s barrel `index.ts`). The plan's
  `service.ts` and its test's `vi.mock("@www/core", ...)` shape match the real API precisely — mirrors
  `apps/api/src/integrations/homeassistant/index.ts`'s existing usage.
- **Worker interval left hand-wired**: confirmed correct — no `jobs.ts` planned, no interval/cron for dogcam exists
  today (`grep -rl "camera\|dogcam" apps/worker/src` returns nothing), and the plan explicitly documents "No
  `jobs.ts` — no queue job or interval cycle for this tile." This is the right call; nothing to hand-wire because
  nothing hand-wired exists today. (Note: task description said "worker interval correctly left hand-wired" — there
  never was one for dogcam; the plan correctly does NOT invent one, which is the safe interpretation.)
- **Boundary safety**: `features/dogcam/service.ts` and `api.ts` import only `@www/core`, `@www/logger`, `@app-kit`,
  `@app-kit/server`, `zod`, and local `./config`/`./service` — no `apps/api` import anywhere, satisfying the Biome
  `noRestrictedImports` rule. The one `apps/api` file touched (`server.ts`) only changes an import path, not an
  import *of* apps/api from a feature.
- **Exhaustive importers**: verified via repo-wide grep (excluding `.claude/worktrees/*`, `storybook-static`,
  `coverage`) for `DogCamTile`, `camera-service`, `cameraRouter` — hits exactly the 12 files the plan already
  enumerates (7 to delete, 5 to repoint: `tile-registry.ts`, `server.ts`, `routers/index.ts`,
  `detail/wiring/dogcam.tsx`, `DogCamTileView.stories.tsx`). Nothing missed.
- **Stream route left hand-wired**: `server.ts:143`'s `/media/camera-stream` route body is untouched by the plan;
  only the import line (`server.ts:16`) is repointed. Correct — matches the explicit instruction not to build the
  S3 http-route seam yet.
- **knip**: `knip.jsonc` already excludes `features/_generated/**` and treats `apps/web`/`apps/api` as workspaces
  whose entry points pull in features transitively via manifest/router imports (same mechanism `network` and
  `guest-wifi` already rely on) — no config edit needed, consistent with precedent.
