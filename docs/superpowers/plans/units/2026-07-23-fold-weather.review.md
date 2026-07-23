# Review — Unit F-weather (fold weather cluster, first multi-tile fold)

**Reviewer:** independent (did not author the plan). Verified against real code at
HEAD (da0be339e). git/bun read-only.

## Verdict: **REWORK**

One BLOCKER invalidates the plan's headline claim ("F0 emit side is ALREADY
wired; no emit-side change needed"). The **render** side is wired for multi-tile;
the **collect/dedup** side is NOT. The fold cannot land green until `collect.ts`
is fixed. Everything else in the plan is sound and well-researched — once the
BLOCKER's one-line codegen fix is added to the atomic commit, this becomes
APPROVE-WITH-FIXES.

---

## Findings

### [BLOCKER] 1 — collect.ts registry-leftover dedup keys on APP id, not TILE id; multi-tile fold double-collects both tiles → `duplicate tile id` throw

`scripts/apps-gen/collect.ts:339-340`:

```ts
const featureIds = new Set(featureApps.map((a) => a.id));   // APP ids
const registryApps = TILE_REGISTRY.filter((t) => !featureIds.has(t.id)) // t.id is a TILE id
```

The dedup that removes a registry entry already owned by a feature compares a
**tile** id (`t.id` from `TILE_REGISTRY`) against the set of **app** ids
(`featureApps.map(a => a.id)`). This has only ever worked because **every
existing feature is single-tile with `app.id === tile.id`** (verified:
deploys/dogcam/guest-wifi/network/notif/tesla/weight all set app id == their sole
tile id).

Weather is the **first** fold where they differ: app id `tile_weather`, tile ids
`tile_weath` / `tile_hourly`. Trace with `weatherManifest` added to
`FEATURE_MANIFESTS` (plan Deletion #1):

- `TILE_REGISTRY` now contains `tile_weath` + `tile_hourly` (via
  `FEATURE_MANIFESTS.flatMap(manifestToEntries)` — tile-registry.ts:250).
- `featureIds = {..., "tile_weather"}`. `featureIds.has("tile_weath")` = **false**,
  `.has("tile_hourly")` = **false** → both survive the filter and are collected a
  SECOND time as standalone `registryApps` (collect.ts:340-358).
- `featureApps` already holds `{id:"tile_weather", tiles:[tile_weath, tile_hourly]}`.
- `validate.ts:159` flattens all tiles → `tile_weath` and `tile_hourly` each
  appear twice → `validate.ts:164-171` throws
  `duplicate tile id 'tile_weath' (declared by app tile_weather and app tile_weath)`.

`bun run apps:check` fails; the fold never lands. The plan's "emit side ALREADY
wired… supported, tested path" (plan lines 26-31) is FALSE for the dedup step —
`validate.ts:178-183` intra-app overlap was written for multi-tile, but
`collect.ts:339` dedup was not.

**Fix (add to the SAME atomic commit — it is part of "prove F0 end-to-end"):**

```ts
// dedup registry leftovers by the union of feature TILE ids, not app ids —
// a multi-tile app's tile ids differ from its app id.
const featureTileIds = new Set(featureApps.flatMap((a) => a.tiles.map((t) => t.id)));
const registryApps = TILE_REGISTRY.filter((t) => !featureTileIds.has(t.id)).map(...)
```

Correct for both single-tile (unchanged behavior — app.id==tile.id) and
multi-tile. Add/extend a collect-level test asserting a two-tile manifest yields
exactly two tiles (no registry duplicates). This is the true crux of the first
multi-tile fold; the plan must own this codegen change, not assume it away.

### [MINOR] 2 — App id `tile_weather` string appears in a test literal (not a collision)

`apps/web/src/lib/__tests__/log-interaction.test.ts:66,79` pass `"tile_weather"`
as an arbitrary tileId argument to `interaction()`. It is NOT a registered
app/tile id, so `tile_weather` as the App id is safe (no dup-app-id / dup-tile-id
collision). Recommend the App id `tile_weather` as the plan proposes. Just note
the string coincidence so nobody mistakes it for a collision.

### [MINOR] 3 — `service.ts` file-split is presented as undecided; pick one to keep the commit deterministic

Plan §Target lines 76-80 wavers between one `service.ts` vs `service.ts` +
`weather-codes.ts`. Either is fine; the review recommends mirroring the source
split (`weather-service.ts` pure helpers → `weather-codes.ts`;
`weather-read-service.ts` reads → `service.ts`) so test repointing is 1:1. Decide
before implementing so the atomic commit isn't reshuffled mid-flight.

---

## Pressure-test results

**1. Multi-tile RENDER claim — CONFIRMED against code.** `tile-registry.ts:228`
`manifestToEntries` does `m.tiles.map(...)` returning one entry per tile, each
carrying its own `component`/`viewComponent` inline; `TILE_REGISTRY`
(line 250) `FEATURE_MANIFESTS.flatMap(manifestToEntries)`. A two-entry
`tiles: []` produces two registry entries with distinct components. web.tsx
barrel exporting four named components (two `component`/`viewComponent` pairs),
imported into two `TileSpec`s, feeds this correctly — same shape as
`tesla/manifest.ts`, just two array entries. **No render-side wiring needed.** The
plan is right about render; wrong about collect (Finding 1).

**2. Coords + validator — non-overlapping, intra-app check passes.**
`tile_weath` (26,24,4×3) spans cols 26-29; `tile_hourly` (22,24,4×3) spans cols
22-25; same rows 24-26. `overlaps()` (validate.ts:48): `26 < 22+4=26` is false →
no overlap. Against neighbors in the row-24 band (tv 18-21, ac 30-33) also no
overlap. Coords are copied verbatim from the deleted registry entries, so the
board layout is byte-identical. Intra-app overlap check (validate.ts:180-183)
passes. Both `guestExposed` NO — `GUEST_EXPOSED` allowlist is `["tile_guestwifi"]`
only; leaving `guestExposed` absent on the manifest keeps
`Boolean(false)===allow.has("tile_weather")===false` consistent
(validate.ts:149). **No allowlist edit.** Confirmed.

**3. Web transitive closure (PLACEHOLDER-1) — see resolution below.** [pending
investigator]

**4. weather-ingest — hand-wired, NOT S1. Confirmed.** `apps/worker/src/index.ts:135-138`
is a `weather-ingest` Worker entry with `intervalMs: 5 * 60_000`,
`run: runWeatherIngestCycle` — an interval cycle, not a queue drain. Importing it
into the worker via `@features/weather/ingest` (apps/worker → @features allowed)
and deleting the `worker-deps.ts:39` re-export is correct. NOT an S1 consumer; no
`defineJobs` facet. Confirmed.

**5. Purge → recommend S2 NOW (not interim).** S2 is landed and proven
(guest-wifi/jobs.ts is a working `defineCron` precedent; `infra/src/crons.ts`
`generatedCronSpecs()` auto-emits the k8s CronJob with zero hand-edit). Weather
purge is a pure daily batch delete — a textbook `defineCron`. Moving it onto
`features/weather/jobs.ts` shrinks `apps/api/src/purge.ts` toward deletion (the
locked end-state) and reaches the roadmap target in one pass. The interim
`@features` import from purge.ts buys nothing and leaves a second migration owed.
Do S2 now. Stagger schedule off guest-wifi's `0 2 * * *` — `0 3 * * *` is fine.
Confirm `infra/test/crons.test.ts` + `cronjob.test.ts` stay green (they assert
over the generated set, which now includes `weather-purge`).

**6. Atomic single commit — FEASIBLE and REQUIRED.** Backend (api/service/ingest/
jobs/schema/config/db) + manifest + moved web components + regenerated
`features/_generated/*` + the collect.ts BLOCKER fix + all base deletions
(registry entries, routers/index mount, routers/weather.ts, four services,
schema tables, worker-deps re-export, purge-bundle weather pass) land together.
Any split leaves an intermediate red state (dup router-key / dup-table /
dup-tile-id). One commit is the only correct shape. Confirmed.

**7. Boundary + knip.** `features/weather/*` must not import `apps/api` (Biome
`noRestrictedImports`) — every moved file repoints to `@www/core` / `@app-kit` /
`@/` / feature-local `./`. knip is zero-tolerance whole-tree: every moved file's
original MUST be deleted (no re-export shims), and the `worker-deps.ts:39` +
`routers/index.ts:15,23` + purge.ts imports cleaned. Plan's Deletions §
enumerates these correctly. The only addition is that the collect.ts fix has no
knip impact (internal).

**8. jobs.ts — justified ONLY as a `defineCron` (purge), NOT a `defineJobs`.**
Weather has NO queue job (ingest is an interval — Finding 4). So `jobs.ts` should
export ONLY `purgeCron = defineCron(...)` (S2). It must NOT contain a
`defineJobs([...])` facet. `collect.ts:257-280` reads both brands off `jobs.ts`;
a stray empty `defineJobs` would set `hasJobs` wrongly. Plan is correct to put
the cron in `jobs.ts` and explicitly forbid a jobs facet for ingest — keep it
that way.

---

## PLACEHOLDER resolutions

**PLACEHOLDER-1 (web subtree scope):** [RESOLVED BELOW once investigator returns —
this section will state the exact file count and whether the full move or the
top-4 fallback is required.]

**PLACEHOLDER-2 (purge → S2 now vs interim):** RESOLVED → **migrate to S2 now**
(`features/weather/jobs.ts` `defineCron`, schedule `0 3 * * *`). Rationale in
pressure-test #5. Fall back to interim only if the S2 diff genuinely balloons —
it will not; it is a ~1 CronJob facet + a 4-line deletion from purge.ts.

---

## Bottom line

The plan is thorough and correct on render, coords, ingest, purge, boundary, and
the atomic-commit shape. It has ONE load-bearing wrong assumption — that codegen
needs no change for multi-tile — which is a hard BLOCKER (`collect.ts:339` dedup).
Add the one-line dedup fix (+ a collect test) to the atomic commit and the fold
is ready. **REWORK** only because the crux claim of a first-of-kind fold must be
corrected before implementation, not discovered mid-commit when `apps:check`
throws.
