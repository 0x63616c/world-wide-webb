# Review — Unit F-wakes (fold Activity/wakes tile into `features/wakes`)

**Verdict: APPROVE-WITH-FIXES** (plan is accurate and thorough; 1 BLOCKER is an
external precondition the plan already guards, 1 MAJOR missed test consumer, 3
MINOR). Fix MAJOR-1 + MINOR-1 in the plan/fileset before implementing; do NOT
start until BLOCKER-1 clears.

Reviewed against real code at HEAD (`63cd93e1f`). Independently re-derived the
web closure, the coords, the collect.ts stamping, the boundary rule, and the
backend consumer set — did not trust the plan's assertions.

---

## [BLOCKER-1] felogs precondition is UNMET on `main` — the fold cannot compile yet

`features/felogs/` does not exist. `frontendLog` (`frontend_log`) still lives at
`apps/api/src/db/schema.ts:192`, NOT in `@features/felogs/schema`. HEAD log ends
at the weather fold (`4be52f800`) + CI fixes; no felogs commit. The
interaction-session service's cross-feature read
(`import { frontendLog } from "@features/felogs/schema"`, plan §service.ts) has
no module to resolve against → typecheck red on day one.

This is the plan's own **PLACEHOLDER-FELOGS** STOP guard firing for real. The
plan is structurally correct to depend on felogs landing first; the defect is
purely sequencing. **Execution of this unit MUST NOT begin until F-felogs is
merged to `main` and exports `frontendLog` from `@features/felogs/schema`.** Re-run
`grep -rn "frontendLog" features/felogs/schema.ts` at implement time; if the
export name/path differs, use felogs' actual export. Not a rework of this plan —
a gate on starting it.

## [MAJOR-1] Missed consumer: `photo-path-migration.test.ts` imports `wakePhoto` from the deleted location

`apps/api/src/startup/photo-path-migration.test.ts:5` does
`import { wakePhoto } from "../db/schema"` and uses it as a table-identity token
(`t === wakePhoto` at `:31` and `:47`). When the `wakePhoto` table moves out of
`apps/api/src/db/schema.ts` into `@features/wakes/schema` (§schema.ts), this
import loses its export → **typecheck + this test go red**. The plan repoints the
production module (`photo-path-migration.ts`, §Backend-consumers #2) but omits its
test. Fix: add to the repoint list —
`import { wakePhoto } from "@features/wakes/schema"` at
`photo-path-migration.test.ts:5`; add the file to the §Deletions/repoints inventory
and the verify chain's `bunx vitest run` targets. (Its `db` remains apps/api's
handle; only the table-identity import moves.)

## [MINOR-1] `emit.test.ts` has TWO `wakeHttp` occurrences; plan updates only one

Plan §Codegen-test #3 says to update the import-barrel string
(`emit.test.ts:25`, `import { routes as wakeHttp } from "../../apps/api/src/http/wake.http"`
→ `import { routes as wakesHttp } from "../wakes/http"`). But `emit.test.ts:28`
also asserts `expect(a).toContain("...wakeHttp")`, which after the rename becomes
`...wakesHttp`. Update BOTH lines or the emit test stays red. Add the spread-line
edit to §Codegen #3.

## [MINOR-2] Dangling comment reference in `booth-photo-service.test.ts`

`apps/api/src/services/booth-photo-service.test.ts:23` comments "mirrors
wake-photo-service.test.ts" — a file this unit deletes. Non-breaking (comment
only, no import), so it will not fail knip/lint, but it becomes a stale pointer.
Optional cleanup: repoint the comment to `features/wakes/photos.test.ts`. Cosmetic.

## [MINOR-3] Resolve the two remaining PLACEHOLDERs (both land in the plan's favour)

- **PLACEHOLDER-MANIFEST-SHAPE → use `tiles: [...]`.** Verified: both single-tile
  landed features (`features/network/manifest.ts`, `features/guest-wifi/manifest.ts`)
  use `tiles: [ … ]`, NOT a singular `tile:`. The plan's `manifest.ts` example is
  already correct; drop the placeholder.
- **PLACEHOLDER-GET-ROUTE → DEFER (agree with plan).** The task scopes to the
  UPLOAD (POST) facet only. Leave `GET /media/wake-photos/*` in the server ladder
  (`server.ts:165-167`) with `readWakePhoto` repointed to `@features/wakes/photos`.
  Moving the prefix serve-route is a later http-seam pass, out of scope here.

---

## Verified correct (no action)

- **Coords EXACT.** Registry `tile_wakes` = col 34 / row 30 / 2×2
  (`tile-registry.ts:150-159`); plan manifest identical. Delete-registry +
  add-manifest nets to the same rect → board byte-identical, no overlap throw.
- **guestExposed / home consistent.** `tile_wakes` sets neither. `GUEST_EXPOSED`
  = `["tile_guestwifi"]` (unchanged). Home is the Clock. `validate.ts`
  flag⇔allowlist + single-home checks stay green. Do not touch the allowlist.
- **Web closure complete (18/18).** All 18 files exist. Independent grep: the ONLY
  external importers of any wake web identifier are `tile-registry.ts`,
  `detail/registry.ts`, and `detail/__tests__/registry-entries.test.ts` — all three
  handled by the plan. Internal imports of the closure exactly match the plan's
  repoint rules (`../types` = detail types STAY; `@/components/gallery/*`,
  `@/components/ui`, `@/lib/*` STAY; `session-format` + `wake-log-summary` MOVE).
  No stray non-Activity tile dep. `wake-capture.ts` correctly excluded.
- **collect.ts Source A stamping matches.** `collect.ts:282-297` stamps
  `source: "feature:wakes"`, ident `wakesHttp`, importPath `../wakes/http` — the
  plan's `collect.test.ts` / `emit.test.ts` expectations are exact. INTERIM entry
  for `wake` confirmed present (`collect.ts:150-154`) and correctly slated for
  deletion; `booth` correctly kept.
- **Backend consumer set matches** (`routers/index.ts:11/14/31/32`, `server.ts:13/165-167`,
  `purge.ts:28/34/39/48`, `photo-path-migration.ts:8/10`, both routers, three
  service files + their tests). `db/seed.ts` does NOT seed `wake_photo` (verified).
- **Boundary sound.** `biome.json:164-183` bans only `@control-center/api` /
  `apps/api/**` from `features/**`; it does NOT restrict `@features/**`, so the
  `wakes/service.ts → @features/felogs/schema` cross-feature read is sanctioned.
  `apps/api → @features` is real and in use (`server.ts:2 @features/dogcam/service`,
  `init.ts:1 @features/guest-wifi/service`, `@features/guest-wifi/jobs`) — the
  server.ts / photo-path-migration / tile-registry repoints are legal.
- **Worker/enforcer correctly left hand-wired.** Zero `wake*` / `interactionSession`
  refs in `apps/worker`. No invented `jobs.ts` queue job — only `purgeCron =
  defineCron(...)`; `collect.ts:257-280` reads `CRON_BRAND` off `jobs.ts`, and the
  plan's GUARD against a stray `defineJobs([])` is correct (it would flip `hasJobs`).
- **Storybook glob** already covers `features/**/*.stories.@(ts|tsx)` (weather
  landed it) — no `.storybook/main.ts` edit needed, per plan.
- **ONE atomic commit** rationale is correct: dup router-key/table/route throws in
  `validate.ts` unless base deletions land with the feature.
