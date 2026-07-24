# Infra-Wave Boundary Review (Track C) — 2026-07-23

Reviewer: infra-wave boundary reviewer. Scope: ground-truth verification + deep
anti-slop review of S1 (worker-job seam + notif), F0 (multi-tile manifest), S2
(cron-run seam + guest-wifi purge), S3 (http-route seam + booth/wake uploads).
Repo HEAD == origin/main == `47fd0da35`.

## PART A — Verification table

| Unit | Commits | On main | CI green | Landed correct |
|------|---------|---------|----------|----------------|
| S1 worker-job seam + notif | `02c6f68dd` seam, `61e71daae` notif | yes | yes (seam run `30030977978` RED, fixed forward by `8318732df`; all green since) | yes |
| F0 multi-tile manifest | `a107c5daa` | yes | yes (`30034481018`) | yes |
| S2 cron-run seam + guest-wifi purge | `5d5c13255` seam, `0c1375426` guest-wifi (+ `6b4065a85` infra import fix) | yes | yes (guest-wifi run `30035801292` RED — extensionless Pulumi import — fixed forward by `6b4065a85` → `30036190425` green) | yes |
| S3 http-route seam + booth/wake | `1c2dd4757` seam, `47fd0da35` booth/wake | yes | yes (`30036914529` + tip `30037567601` — all jobs incl. `deploy` success) | yes |

Tip CI run `30037567601` job breakdown: changes/test-unit/build-web/build-worker/
test-storybook/build-api/typecheck/deploy/notify all **success**; build-drizzle +
build-map-provision skipped (path-filtered). Pulumi apply (deploy) succeeded.

Local gates (this machine, HEAD):
- `bun run apps:gen` → **no drift** (`git status` on `features/_generated` clean).
- `bun run apps:check` → clean **with `DATABASE_URL` unset** (`env -u DATABASE_URL`),
  proving codegen/collect() is env-free (the S3 pg-pool-transitive-import concern
  is closed).
- `bun run typecheck` → all packages exit 0.
- `bun run knip` → clean (only 2 config hints, no dead exports).
- `bun run lint` → see MINOR-1: 13 local errors, **all environmental or pre-existing,
  none wave-introduced**; CI lint (test-unit job) is green.

### Route accounting (S3 — no route dropped)
Original server.ts route ladder at pre-S3 base `6b4065a85` had 11 branches:
OPTIONS-preflight, `/up`, `/health/climate`, `/media/tv-artwork`,
`/media/camera-stream`, **`POST /media/wake-photo`**, `/media/wake-photos/` (prefix),
**`POST /media/booth-photo`**, `/media/booth-photos/` (prefix), `/trpc`, 404-fallback.

At HEAD: `findRoute(GENERATED_ROUTES, …)` runs FIRST (`server.ts:100`), overlays
CORS centrally (`:103`), then falls through to the residual ladder. The two POST
branches are gone from server.ts, now served by `apps/api/src/http/{wake,booth}.http.ts`
via the generated barrel. 9 residual unchanged + 2 migrated = **11 accounted, 0 dropped.**

### S2 purge accounting
`apps/api/src/purge.ts` still runs **4** purges: weather, frontend-log, wake,
github (portal purge removed). The `portal-data-purge` CronJob is preserved in
`infra/src/crons.ts:136` running `bun purge.js` (no double-purge — portal moved
out of purge.ts). A `guest-wifi-purge` CronJob is emitted by `generatedCronSpecs()`
(`infra/src/crons.ts:99-111`) from `GENERATED_CRONS`, sharing
`SERVICE_SECRET_TARGETS["portal-data-purge"].secretName`.

## PART B — Verdict: **CLEAN**

No wave-introduced blockers. The three seams are consistent, behaviour-preserving,
env-safe, and green in CI incl. deploy. One pre-existing MAJOR (app-kit tests dark
in CI) is carried forward, not a wave regression, and does NOT dark any of the 3
seam-proof tests. Safe to start cluster folds.

Counts: **0 BLOCKER, 1 MAJOR (pre-existing), 3 MINOR.**

### Findings

**[MAJOR] (pre-existing, F0-flagged, still open) `app-kit/*.test.ts` is dark in CI.**
`vitest.config.ts:9` `projects` list = apps/{api,web,worker}, packages/{core,logger,
platform,worker-runtime}, infra, and an inline `apps-gen` project (root `./scripts`).
There is **no `app-kit` project entry**, so `app-kit/define-app.test.ts` runs on no
CI path. Both S1 and F0 edited that file, so its coverage is unverified in CI.
*Impact bounded:* the 3 seam-proof tests are NOT in app-kit — S1
`apps/worker/src/__tests__/jobs-seam.test.ts` (apps/worker project), S2
`apps/api/src/__tests__/cron-run.test.ts` and S3
`apps/api/src/http/__tests__/route-table.test.ts` (apps/api project), plus the
validator tests `scripts/apps-gen/{collect,emit,validate}.test.ts` (apps-gen
project) — all run in CI. Fix: add an `app-kit` project (or fold its tests into an
existing project's include glob). Not a blocker to cluster folds.

**[MINOR] `apps/api/src/purge.ts:7-10` stale docstring.** The bullet list enumerates
only weather / frontend-logs / wake-photos; the code (line 36) also runs
`purgeGithubRuns`. Add github to the doc list.

**[MINOR] Local `bun run lint` reports 13 errors — none wave-introduced.** Breakdown:
(a) 10 in `infra/esphome/.esphome/build/**` + `.esphome/storage/**` — local ESPHome
build cache, gitignored (`git check-ignore` confirms), absent in CI's fresh checkout;
(b) `apps/web/src/components/tiles/GuestWifiDesignSheet.stories.tsx:628`
(noUselessFragments) and `apps/web/src/portal/__tests__/bundle-isolation.test.ts:165-166`
(noTemplateCurlyInString) — both files last modified `1510657bc` (2026-07-22,
pre-wave) and untouched by any wave commit; CI test-unit lint gate is green. No
action for the wave; the two tracked nits are a separate pre-existing cleanup.

**[MINOR] observation — seam pattern is consistent (good).** All three seams follow
one shape: branded facet (`defineJobs`/`defineCron`/`defineHttp` in
`app-kit/define-facets.ts`) → `scripts/apps-gen/collect.ts` → checked-in
`features/_generated/*.gen.ts` barrel → generic iterator (worker folds
`GENERATED_JOBS` into `JOBS[]`; `infra/src/crons.ts` maps `GENERATED_CRONS`;
`server.ts` iterates `GENERATED_ROUTES` via pure `findRoute`). No bespoke drift.
`cron-run.ts` and `route-table.ts`'s `findRoute` are pure/import.meta.main-gated so
they unit-test in isolation. Meets the 10x-100x invariant: a new purge/route/job
appears with zero hand-wiring.

### Deep-review confirmations (no findings)
- **Boundary rule**: no real `import … from ".../apps/api"` in `features/*` (only
  pointer comments); S3 interim handlers correctly live in `apps/api/src/http/`
  (they call apps/api's wake/booth-photo services), not `features/`. `noRestrictedImports`
  clean.
- **Generic iterators**: worker/scheduler/server all iterate the generated barrel
  generically; no per-feature hand-wiring leaked in.
- **No behaviour regressions**: notify jobs still drain (S1 seam test invokes the
  real handler end-to-end); 4 purges still scheduled + guest-wifi-purge added; all
  11 http routes served; F0 is declarative-only (manifests + app-kit + tile-registry
  + codegen), zero runtime change to the 7 tiles.
- **Codegen env-safety**: `apps:check` green with `DATABASE_URL` unset.
- **Seam-proof tests genuine**: all 3 dispatch a REAL request/name through the
  generated barrel to the real handler and assert a spy fired (not emit-assertions).
- **7 manifests on `tiles:[]` shape**: deploys, dogcam, guest-wifi, network, notif,
  weight, tesla — all confirmed.
- **knip**: `cron-run.ts` is an explicit apps/api entry (`knip.jsonc:99`); not flagged.
