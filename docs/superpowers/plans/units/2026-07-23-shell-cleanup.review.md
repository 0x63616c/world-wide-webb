# Plan review — apps/api shell-cleanup (final Track C unit)

Reviewer: independent plan-reviewer (did NOT author the plan). Verified against real
code this session (main = prod).

## Verdict: APPROVE-WITH-FIXES

The plan is well-researched and its two-commit shape is right. The inventory
classification is accurate against the real tree, the REMOVE-NOW deletions are
genuinely dead, and the github-purge -> S2 migration mirrors the proven
weather/felogs/wakes pattern exactly. Two MAJOR gaps must be closed before
implementing (both are zero-tolerance-gate breakers the plan omits or under-specifies),
plus minor tidies. No BLOCKER.

Counts: BLOCKER 0 / MAJOR 2 / MINOR 4.

---

## Verified ground truth (receipts)

- **`integrations/unifi.ts` is a pure `@www/core` re-export with ZERO runtime importers.**
  Repo-wide grep for `integrations/unifi`: only `apps/api/src/__tests__/unifi-guest.test.ts`
  imports the barrel path (`createUnifiClient`). Every runtime caller imports
  `createUnifiClient` / the `Unifi*` types straight from `@www/core`
  (features/guest-wifi/api.ts, features/network/service.ts+test, features/dogcam/service.ts).
  The re-exported TYPES (`UnifiClient`, `UnifiStatsClient`, `UnifiTrafficBucket`,
  `UnifiHealth`, `UnifiGuestClient`, `UnifiGuestAuthorization`) all have live consumers
  in packages/core internally + features + apps/api tests importing them from `@www/core`
  (NOT the barrel) — so deleting the barrel orphans NO `@www/core` export. Safe delete;
  knip stays clean. `apps/api/src/config/` confirmed empty (0 files).

- **`apps/api/src/purge.ts` now runs ONLY `purgeGithubRuns`.** portal/weather/felogs/wakes
  already moved to the S2 seam (GENERATED_CRONS already lists felogs-purge, guest-wifi-purge,
  wake-photo-purge, weather-purge). github is the LAST purge in the one-shot -> once it
  folds, purge.ts empties and is deletable. Confirmed.

- **`features/deploys` already owns the github tables + its own db.** `features/deploys/schema.ts`
  defines `githubRun` ("github_run"), `githubRunLogTail` ("github_run_log_tail"),
  `githubPollStatus`. `features/deploys/db.ts` builds its own pool from its config slice.
  `apps/api/src/db/schema.ts` no longer defines these tables — it is only a COMMENT
  (schema.ts:125-131) noting they folded to deploys. So the purge helpers move cleanly into
  `features/deploys/jobs.ts` binding to `./db` + `./schema`, mirroring `features/weather/jobs.ts`
  (which is `purgeWeatherData` + `export const purgeCron = defineCron({...})`). No apps/api
  schema export is orphaned by deleting github-purge-service.ts (there is nothing left there
  to orphan). `features/deploys/jobs.ts` does NOT yet exist — it gets created.

- **THE SECRET GATE — resolved.** `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName`
  (secrets-map.ts:79 -> `serviceSecretUsages["portal-data-purge"]` -> `controlCenterUsages[...]`,
  `.secretName = usage.targetSecretName`) is the SHARED POSTGRES_PASSWORD secret name used by
  `generatedCronSpecs()` (infra/src/crons.ts:107) for EVERY generated cron
  (felogs-purge, guest-wifi-purge, wake-photo-purge, weather-purge, and the new deploys-purge)
  AND by the legacy portal-data-purge block (crons.ts:143). YES — POSTGRES_PASSWORD's secretName
  is shared across all generated crons.

---

## Findings

### [MAJOR-1] The secret-target key MUST be kept untouched — the plan's "repoint to weather-purge" alternative is a trap

Plan step 7 leaves the resolution as an either/or: "keep the `portal-data-purge` key OR
repoint `generatedCronSpecs()` to a stable key (e.g. an already-generated cron like
`weather-purge`)." The second option is WRONG and would break the build:
`SERVICE_SECRET_TARGETS` has ONLY four keys — `api`, `worker`, `cloudflared`,
`portal-data-purge` (secrets-map.ts:75-80). There is NO `weather-purge` / `guest-wifi-purge`
key. Repointing line 107 to any generated-cron name would fail to compile (and even a
rename of the key would change `usage.targetSecretName` -> the physical k8s Secret name ->
ESO Secret replace -> every generated cron loses its secret on the next reconcile).

**Definitive fix:** Commit 2 deletes ONLY the legacy CronJob object block in
`infra/src/crons.ts` (lines 136-148, the `{ name: "portal-data-purge", ... command:
["bun","purge.js"] ... }`). Do NOT touch `infra/src/secrets-map.ts` at all — keep
`controlCenterUsages["portal-data-purge"]`, `serviceSecretUsages["portal-data-purge"]`, and
`SERVICE_SECRET_TARGETS["portal-data-purge"]`. Do NOT change `generatedCronSpecs()` line 107 —
it keeps referencing `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` as the shared
POSTGRES_PASSWORD name for all generated crons. The `portal-data-purge` key becomes a pure
secret-name label decoupled from any CronJob (a minor naming smell) — that is acceptable and
intentional; renaming it is out of scope and risky. Nothing in the codebase asserts a
1:1 job-name<->secret-target mapping, so a shared secret name is fine.

### [MAJOR-2] knip entry list still points at the deleted purge.ts — commit 2 must edit knip.jsonc

`knip.jsonc:113` declares the apps/api entries as
`["src/server.ts", "src/purge.ts", "src/cron-run.ts", "src/db/seed.ts"]` and the comment
(106-108) describes `purge.ts`. Commit 2 deletes `apps/api/src/purge.ts`. knip is the
zero-tolerance gate the plan leans on, but the plan never edits knip.jsonc — leaving
`"src/purge.ts"` as an entry pointing at a nonexistent file. Remove `"src/purge.ts"` from
that entry array and update the surrounding comment (drop the purge.ts sentence; keep the
cron-run.ts one). `cron-run.ts` stays as the S2 dispatcher entry.

### [MINOR-1] Stale comment in apps/api/src/db/schema.ts

schema.ts:129 states "github-purge-service.ts still purges the physical
github_run/github_run_log_tail tables via raw SQL." After commit 2 deletes that service, the
sentence is false. Update it to point at `features/deploys/jobs.ts` (the new home of the
purge), or trim it.

### [MINOR-2] Plan step 2's test list is over-broad

Only `apps/api/src/__tests__/github-purge-service.test.ts` references github purge and moves
to features/deploys. Verified: `portal-purge-service.test.ts` and `portal-purge-boundary.test.ts`
import from `@features/guest-wifi/jobs` (purgePortalData / authorizationShouldPurge) — nothing
github, leave untouched. `cron-run.test.ts` dispatches `"guest-wifi-purge"` (the S2 seam test)
— untouched by the github migration. Rewrite step 2 to: move github-purge-service.test.ts into
features/deploys (repoint to `./jobs` / `./schema` / `./db`), and DON'T touch the portal-purge
or cron-run tests. (A dedicated deploys-purge dispatch test is optional and NOT required —
weather/felogs/wakes added their crons without one; codegen + the infra crons test + the moved
service test cover it, consistent with prior folds.)

### [MINOR-3] deploys-purge schedule collides in time with guest-wifi-purge

Plan step 1 sets `deploys-purge` to `0 2 * * *` (matching the retired portal cadence), which is
identical to guest-wifi-purge's `0 2 * * *`. weather/felogs/wakes were deliberately staggered
(03:00 / 04:00 / 04:00) to spread DB load. Recommend staggering deploys-purge (e.g. `0 5 * * *`)
for the same reason. Non-blocking (volume is trivial, a few hundred rows/month per the service
docstring).

### [MINOR-4] Remove the purge.js prose block in crons.ts with the CronJob object

The comment above the legacy block (crons.ts:127-135) and the file header (crons.ts:1-3,
"portal-data-purge ... re-homed verbatim") describe the bundled purge.js job. Delete/adjust
these alongside the block so the file doesn't describe a job that no longer exists.

---

## Answers to the specific pressure-tests

1. **REMOVE-NOW truly dead:** YES. unifi.ts has zero runtime importers (only its own test,
   which relocates to packages/core keeping `createUnifiClient` referenced); no `@www/core`
   export is orphaned. config/ is empty. Commit 1 is a clean, independently-green pure deletion.
2. **Secret gate:** RESOLVED — see MAJOR-1. Keep the `portal-data-purge` secret-target key and
   the crons.ts:107 reference untouched; delete ONLY the CronJob block (crons.ts:136-148).
   POSTGRES_PASSWORD secretName IS shared across all generated crons.
3. **github-purge -> S2 correctness:** YES. Mirrors weather/jobs.ts exactly; features/deploys
   already owns the tables + db; folding purgeGithubRuns into features/deploys/jobs.ts as a
   `defineCron` (name `deploys-purge`) means apps:gen emits it into crons.gen + cron-handlers.gen
   and generatedCronSpecs() emits its k8s CronJob with ZERO new infra hand-wiring. purge.ts,
   github-purge-service.ts, and the purge.js Docker bundle are then all fully deletable, knip
   clean (given MAJOR-2's knip.jsonc edit).
4. **Nothing app-level/deferred wrongly deleted:** YES. route-table.ts (S3), app routers,
   jobs/queue.ts, worker-deps.ts, the ha singleton, and all deferred-interim cycles
   (enforcers/pollers/ingests/party/device-sync/device-ownership/photo-path-migration) are
   correctly KEEP. Only the dead barrel + empty dir (commit 1) and the fully-migrated github
   chain (commit 2) are removed.
5. **Commit structure:** Correct. Commit 1 (pure deletion) is independently green. Commit 2
   (github->S2 + purge.ts/service/bundle deletion + infra block removal) is independently green
   IFF MAJOR-1 (don't touch secrets-map/line 107) and MAJOR-2 (fix knip.jsonc) are honored.
   Two commits is right — commit 2 alone touches infra/Dockerfile/deploy.
6. **knip:** Plan runs it as the gate (good) but misses the knip.jsonc entry edit — see MAJOR-2.

## Status: needs-fix (2 MAJOR, both small + mechanical). Ready to implement once addressed.
