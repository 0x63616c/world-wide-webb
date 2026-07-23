# Review: Fold weight tile into features/weight/

Verdict: **APPROVE-WITH-FIXES**

Verified against real code: `apps/web/src/lib/tile-registry.ts`,
`apps/api/src/trpc/routers/weight.ts`, `weight-domain.ts`, `weight-sql.ts`,
`weight-service.ts`, `apps/api/src/worker-deps.ts`, `apps/worker/src/index.ts`,
`apps/api/src/trpc/routers/index.ts`, `apps/api/src/db/schema.ts`,
`apps/web/src/components/tiles/detail/wiring/weight.tsx`,
`WeightTileView.stories.tsx`, `biome.json` boundary rules, both vitest
configs, `apps/api/drizzle.config.ts`, and the guest-wifi/network reference
folds. The plan's factual claims about the current code (imports, line
ranges, glob coverage, router shape) all matched what's on disk — no
fabricated citations found.

## Findings

1. [MINOR] No existing feature has an `api.test.ts` today (checked: `find
   features -iname "api.test.ts"` returns nothing). `app-kit/server.ts` does
   export `router`/`publicProcedure` from `apps/api/src/trpc/init`, so
   building a caller with `router({ weight: weightRouter })` +
   `weightRouter` exported from `./api` should work mechanically, but the
   plan's "mirrors weight-mutations.test.ts's existing style" claim
   overstates precedent — no fold has actually built a caller this way yet.
   Fix: implementer should verify the `createCaller`/mock-db wiring works
   before assuming it's a copy-paste of an existing pattern; flag if it
   needs a different approach (e.g. importing `createCallerFactory` from
   `@app-kit/server` too, if that export doesn't already exist there —
   confirm before writing the test).

2. [MINOR] The plan's "PLACEHOLDER: whether `features/weight` needs its own
   second Postgres pool" is real and correctly flagged, but the plan doesn't
   spell out the concrete consequence: after the fold there are TWO pg
   pools open against the same `weight_measurement` table from the same
   process tree (apps/api's shared pool via `weight-service.ts`'s untouched
   `../db/index` import, and features/weight's own pool via `db.ts` for
   `api.ts`/`service.ts`). This matches the guest-wifi precedent exactly
   (guest-wifi's ingest-equivalent, `purge.ts`, also straddles both pools),
   so it's not a blocker — just make sure the commit description says this
   explicitly, as the plan itself promises to do.

3. [MINOR] Plan leaves the exact `FEATURE_MANIFESTS` union-array name as a
   PLACEHOLDER "read the file, don't guess." Confirmed today: it's
   `FEATURE_MANIFESTS: AppManifest[] = [guestWifiManifest, networkManifest];`
   at `apps/web/src/lib/tile-registry.ts:276`, consumed at
   `TILE_REGISTRY: ...[...REGISTRY_ENTRIES, ...FEATURE_MANIFESTS.map(manifestToEntry)]`
   (line 296-298). Trivial one-line addition
   (`FEATURE_MANIFESTS = [guestWifiManifest, networkManifest, weightManifest]`).
   Not a blocker, just resolving the PLACEHOLDER for the implementer so no
   time is lost re-deriving it.

## Confirmed correct (no fix needed)

- Coords copied verbatim: `worldCol: 34, worldRow: 22, cols: 3, rows: 2` —
  matches `tile-registry.ts:89-96` exactly, including the load-bearing
  col-34 comment.
- `guestExposed`: `tile_weight` is absent from `GUEST_EXPOSED` in
  `features/guest-exposed.ts` (`["tile_guestwifi"]` only) — plan correctly
  treats this as "not guest exposed, no allowlist edit."
- Manifest + backend as one atomic commit — plan states this explicitly
  (gotcha 1 reference) and the commit section reiterates it.
- View inlining into `web.tsx`: TileView-then-Tile function order matches
  the `features/network/web.tsx` precedent exactly (`NetworkTileView` at
  line 109, `NetworkTile` at 150).
- Stories stay under `apps/web`: `WeightTileView.stories.tsx` imports
  `formatRecency, WeightTileView` from `"./WeightTileView"` today — plan's
  repoint to `"@features/weight/web"` (step 7) is the only needed change,
  matches guest-wifi precedent (stories stay put, only import target moves).
- Boundary rule: `biome.json` bans `features/**` from importing
  `apps/api`/`@control-center/api` (lines 164-179), but apps/api already
  imports `@features/guest-wifi/db`, `/jobs`, `/service` (`purge.ts`,
  `trpc/init.ts`) — so apps/api importing `@features/weight/schema` and
  `@features/weight/service` from the untouched `weight-service.ts` is
  consistent with existing precedent, not a new violation. No
  `features/*` → `apps/api` import exists anywhere in the plan.
- Worker interval correctly left hand-wired: `worker-deps.ts:35` re-exports
  `runWeightIngestCycle` from `apps/api/src/services/weight-service.ts`;
  `apps/worker/src/index.ts:135-138` runs it on its own 15s interval; `apps/worker`
  never imports `@features/*` directly (confirmed via grep — zero hits) and
  the plan doesn't ask it to. No jobs.ts invented for weight. Matches the
  task brief's explicit instruction.
- knip zero-tolerance: old files (`weight-domain.ts`, `weight-sql.ts`,
  `trpc/routers/weight.ts`, `WeightTile.tsx`, `WeightTileView.tsx`, and all
  4 old test files) are all listed for deletion; only 4 real importers of
  `weightMeasurement` exist repo-wide (`weight.ts` router,
  `apps/api/src/db/schema.ts`, `weight-service.ts`, `weight-sql.ts`) and all
  4 are accounted for.
- `apps/api/src/trpc/routers/index.ts` diff matches the plan's step 1
  exactly (`weightRouter` import + `weight: weightRouter,` key, both
  present today, both slated for removal).
- `detail/wiring/weight.tsx` imports confirmed: `LB_PER_KG` from
  `"@/components/tiles/WeightTile"`, `formatRecency` from
  `"@/components/tiles/WeightTileView"` — plan's step 6 repoint targets are
  exactly right, no other apps/api or removed-symbol imports in that file.
- vitest wiring needs zero config edits: `apps/api/vitest.config.ts` already
  globs `../../features/**/{service,api}.test.ts`;
  `apps/web/vitest.config.ts` already globs `../../features/**/web*.test.tsx`
  (unused here since no `web*.test.tsx` exists pre-fold — confirmed, only
  `.stories.tsx`/`.stories.test.tsx` files exist for the tile view).
  `weight-router.test.ts` is confirmed 100% `assembleDays`/`tzInput` tests
  (no db-touching procedure tests), so "merge wholesale into
  `service.test.ts`" is accurate, not a partial/lossy move.
- `weightMeasurement` table has no FK in or out (grep-confirmed) and the
  table set is unchanged by the move, so `bun run apps:gen` regenerating
  `features/_generated/schema.gen.ts` (which `apps/api/drizzle.config.ts`
  already points at, per its own comment) needs no new migration — matches
  the guest-wifi precedent's own comment in that same config file.
- placeholder-tiles clearance: plan explicitly schedules the existing
  `placeholder-tiles.test.ts` run after the registry edit; the load-bearing
  col-34 comment is preserved verbatim into the manifest sketch.

## Receipt for return

- coords-correct: y
- boundary-safe (no features→apps/api import): y
- worker-interval-left-hand-wired: y (correct — no jobs.ts invented, S1 not built, matches task brief)
