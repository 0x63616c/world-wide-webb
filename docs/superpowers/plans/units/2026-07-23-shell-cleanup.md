# apps/api shell-cleanup (final Track C unit)

Status: PLAN. Author: planner agent. Implementer is a DIFFERENT agent.

## Goal

Collapse apps/api toward its app-level core now that all 21 board tiles are folded
into features/*. This is the LAST Track C unit. It is mostly discovery: the honest
finding is that apps/api is ALREADY close to its Track-C floor. Only a small amount
of genuinely-dead code exists to remove now; the bulk of what "remains" in apps/api
is DEFERRED-INTERIM by explicit roadmap decision and is removed by two SEPARATE
post-Track-C units (device-ownership hoist, interval-cycle -> packages/core
extraction). Do NOT delete deferred-interim code in this unit.

## Survey result (verified against the real code)

### Classified inventory

| File / dir | Class | Reason |
| --- | --- | --- |
| `apps/api/src/integrations/unifi.ts` | REMOVE-NOW | Pure `@www/core` re-export barrel. Every feature imports `createUnifiClient` straight from `@www/core` (guest-wifi/api.ts, network/service.ts). NO runtime caller imports this barrel. Only its own test does, kept alive by the `@public` JSDoc tag so knip does not flag it. |
| `apps/api/src/config/` | REMOVE-NOW | Empty directory. |
| `apps/api/src/services/github-purge-service.ts` | REMOVE via S2 migration (commit 2) | `purgeGithubRuns` is deploys-tile retention still living in apps/api. Migrate into `features/deploys/jobs.ts` as a `defineCron` facet (mirrors weather/felogs/wakes/guest-wifi). |
| `apps/api/src/purge.ts` | REMOVE via S2 migration (commit 2) | After github-purge moves to S2, this one-shot runs nothing. It was the last non-S2 purge pass (weather/felogs/wakes/guest-wifi already moved). |
| `apps/api/src/services/settings-service.ts` | KEEP-APP-LEVEL | Backs the `settings` tRPC router + db schema. |
| `apps/api/src/services/device-settings-service.ts` | KEEP-APP-LEVEL | Backs the `deviceSettings` tRPC router + db schema. |
| `apps/api/src/contract/{settings,device-settings}.ts` | KEEP-APP-LEVEL | App-level contract types for the two app routers. |
| `apps/api/src/http/route-table.ts` (+ test) | KEEP-APP-LEVEL | The S3 `findRoute` dispatcher, consumed by `server.ts:99`. `http/` is NOT empty and NOT deletable — the task's "should be empty" assumption is wrong; booth/wake handlers moved out but the generic S3 router helper legitimately lives here. |
| `apps/api/src/trpc/routers/{health,settings,device-settings,system,index}.ts` | KEEP-APP-LEVEL | Confirmed app-level-only. `index.ts` merges the base router (health/settings/deviceSettings/system) with the generated `featureAppRouter`. NO leftover tile router. |
| `apps/api/src/integrations/homeassistant/{index.ts,types.ts}` | KEEP-DEFERRED | The env-bound `ha` singleton is consumed by the deferred worker cycles (climate/light enforcers, party, device-sync, weight). `types.ts` `HaError` is also used by `trpc/init.ts` for the SERVICE_UNAVAILABLE remap. Stays until those cycles + the device-ownership hoist land. NOT replaced by @www/core yet — features build their OWN `ha` from `@www/core` (ac/deps.ts, ctrl/deps.ts); this singleton serves the still-hand-wired apps/api cycles. |
| `apps/api/src/services/climate-enforcer-service.ts` | KEEP-DEFERRED | Hand-wired enforcer cycle (`runClimateEnforcerCycle` via worker-deps). Device-ownership hoist deferred. |
| `apps/api/src/services/light-enforcer-service.ts` | KEEP-DEFERRED | Hand-wired enforcer cycle (`runEnforcerCycle`). Device-ownership hoist deferred. |
| `apps/api/src/services/device-sync-service.ts` | KEEP-DEFERRED | Hand-wired device-state sync cycle (`runDeviceSyncCycle`). |
| `apps/api/src/services/device-ownership.ts` | KEEP-DEFERRED | Sole consumer is device-sync-service (`ownerOf`, `DeviceOwner`). Moves with the device-ownership hoist. |
| `apps/api/src/services/party-service.ts` | KEEP-DEFERRED | Hand-wired `reconcilePartyMode` cycle. |
| `apps/api/src/services/weight-service.ts` | KEEP-DEFERRED | `runWeightIngestCycle` interval. Weight TILE is in features/weight, but the ingest cycle stayed hand-wired (interval-cycle-seam unit). |
| `apps/api/src/services/youtube-ingest-service.ts` | KEEP-DEFERRED | `runYoutubeIngest`. Dormant / env-gated (YOUTUBE_INGEST_ENABLED off, IP-blocked). |
| `apps/api/src/services/asc-version-service.ts` | KEEP-DEFERRED | `runAscVersionPollCycle` poll cycle; also read by the `system` router. |
| `apps/api/src/jobs/queue.ts` | KEEP | Thin db-bound adapter over the `@www/core` durable queue; re-exported through worker-deps. |
| `apps/api/src/worker-deps.ts` | KEEP-DEFERRED | The single worker<->api barrel. Deleted by the packages/core domain extraction, not here. |
| `apps/web/src/lib/tile-registry.ts` | KEEP (defer reduction) | See below. |

### Zero-importer verification (grep receipts)

- `integrations/unifi.ts`: only importer outside itself is `apps/api/src/__tests__/unifi-guest.test.ts`. Runtime `createUnifiClient` callers all import from `@www/core` (features/guest-wifi, features/network). DEAD.
- Every `services/*` file has at least one live importer (a router or worker-deps).
  NONE is fully dead. `github-purge-service` is imported only by `purge.ts` (its
  runtime driver) + tests — it is not dead, it MOVES.
- `config/` contains no files.

## Work

### Commit 1 — drop the dead UniFi barrel + empty config dir (safe, pure deletion)

1. Relocate the guest-auth test. `apps/api/src/__tests__/unifi-guest.test.ts` is the
   ONLY coverage of the UniFi guest-authorization client, and that client now lives
   in `packages/core/src/unifi/`. packages/core has NO existing unifi test
   (`packages/core/test/` has none). So MOVE the test to `packages/core/test/unifi-guest.test.ts`,
   repointing its import from `../integrations/unifi` to the core client
   (`@www/core` or the local `../src/unifi/index` per the sibling core tests'
   convention — match how the other `packages/core/test/*.test.ts` import). Do NOT
   delete this test; it is the sole guest-auth coverage.
2. Delete `apps/api/src/integrations/unifi.ts`.
3. Remove the now-empty `apps/api/src/config/` directory.
4. Verify (typecheck + knip + affected tests) — knip must stay clean; the moved test
   keeps `createUnifiClient` referenced from core so no @www/core export goes dead.

Commit message (no backticks):

```
chore(api): drop dead UniFi re-export barrel + empty config dir

integrations/unifi.ts was a pure @www/core re-export with no runtime
caller - every feature builds its own UniFi client from @www/core. Only
its own test kept it alive, invisible to knip via the @public tag.
Relocate the guest-authorization test (the sole coverage of the UniFi
guest-auth client) to packages/core alongside the client. Remove the
now-empty apps/api/src/config dir.
```

### Commit 2 — move github-run purge onto the S2 cron seam (unblocks purge.ts deletion)

This is the RIGHT-thing move (deploys retention belongs in features/deploys, not
apps/api/src/services) and is the ONLY thing blocking `purge.ts` deletion. It is a
well-trodden path — weather, felogs, wakes, guest-wifi all migrated the identical
way. It is infra/deploy-sensitive; do it as its own commit AFTER commit 1.

1. Create `features/deploys/jobs.ts` exporting a `defineCron` facet (mirror
   `features/weather/jobs.ts`): bind to `features/deploys/db.ts`'s db, run the
   github-run + log-tail retention DELETE. Move the pure helpers
   (`GITHUB_RUN_RETENTION_MS`, `githubRunCutoff`, `runShouldPurge`, `purgeGithubRuns`)
   out of `apps/api/src/services/github-purge-service.ts` into features/deploys
   (jobs.ts or a colocated module). Name the cron `deploys-purge`, schedule daily
   (match the retired `portal-data-purge` cadence, 02:00 LA / `0 2 * * *`).
2. Move `apps/api/src/__tests__/github-purge-service.test.ts` into features/deploys
   (repoint imports). Check `portal-purge-service.test.ts` /
   `portal-purge-boundary.test.ts` / `cron-run.test.ts` for `purge`/`purgeGithubRuns`
   references and repoint or delete as the migration dictates.
3. `bun run apps:gen` — regenerates `features/_generated/crons.gen.ts` +
   `cron-handlers.gen.ts`; the new `deploys-purge` CronJob then appears in
   `infra/src/crons.ts`'s `generatedCronSpecs()` automatically.
4. Delete `apps/api/src/services/github-purge-service.ts`, `apps/api/src/purge.ts`.
5. `apps/api/Dockerfile`: remove the `bun build src/purge.ts ... --outfile
   dist/purge.js` step (line ~60) and the `COPY ... purge.js purge.js` (line ~84).
6. `infra/src/crons.ts`: remove the hand-wired `portal-data-purge` CronJob block
   (the `{ name: "portal-data-purge", ... command: ["bun","purge.js"] ... }`).
7. **GATE / TOP PLACEHOLDER — secret-target coupling.** `generatedCronSpecs()`
   references `SERVICE_SECRET_TARGETS["portal-data-purge"].secretName` as the SHARED
   POSTGRES_PASSWORD secret for EVERY generated cron. Removing the portal-data-purge
   CronJob object must NOT remove that secret-target KEY, or every generated cron
   loses its secret. Confirm the key is defined independently of the CronJob (it is a
   secret-name lookup, not the CronJob), and either keep the `portal-data-purge` key
   as the shared secret name OR repoint `generatedCronSpecs()` to a stable key (e.g.
   an already-generated cron like `weather-purge`). Resolve this before deleting the
   CronJob block. Update the surrounding comments in crons.ts that describe
   `portal-data-purge` as the bundled-purge.js job.
8. Orphan check: the live k8s `portal-data-purge` CronJob leaves the Pulumi owned set
   and should be pruned on deploy; the new `deploys-purge` CronJob replaces it. Verify
   no orphaned CronJob remains after deploy (pod/cronjob age check).

Commit message (no backticks):

```
refactor(deploys): move github-run purge onto the S2 cron seam

purgeGithubRuns was the last retention pass still living in
apps/api/src/services and driven by the bundled purge.js one-shot. Fold
it into features/deploys/jobs.ts as a defineCron facet (mirrors
weather/felogs/wakes/guest-wifi) so a deploys-purge CronJob is emitted
generically. Delete apps/api/src/purge.ts, github-purge-service.ts, the
purge.js Docker bundle, and the hand-wired portal-data-purge CronJob;
repoint the shared cron secret target off the retired CronJob key.
```

If the secret-target repoint or Dockerfile/infra risk is judged out of scope for a
"cleanup" unit, DEFER commit 2 entirely: ship commit 1 only, and record
"purge.ts deletion blocked on github-purge -> S2 (features/deploys)" as the one
remaining item. purge.ts is otherwise harmless (a correct one-shot). Recommendation:
DO commit 2 — it is the same pattern done 4x and is the only way apps/api sheds its
last tile-retention code — but treat step 7 as a hard gate.

## tile-registry.ts — DEFER reduction (recommendation)

`REGISTRY_ENTRIES` is empty; the file is now the hand-written `FEATURE_MANIFESTS`
union of 16 manifest imports + `manifestToEntries` + the `TILE_REGISTRY` / `HOME_TILE`
/ `componentMap` consumers the board and Storybook depend on. The file CANNOT be
deleted — it is the manifest-union + component-lookup source. Reducing the 16-manifest
hand-list to a generated collection (a `manifests.gen.ts` glob-collected by
scripts/apps-gen, consumed here) is a NEW codegen surface + web-side wiring — a
DEFERRED codegen follow-up, not shell-cleanup. In scope now: OPTIONAL trivial tidy —
collapse the empty `REGISTRY_ENTRIES` array's long "hand-placed tiles" comment block
to a one-liner. Do not force the codegen change into this unit.

## What legitimately REMAINS in apps/api (the honest Track-C floor)

- App-level tRPC host + routers (health/settings/deviceSettings/system) + generated
  feature-router merge; their two services + two contracts; db/schema; env; server.ts;
  guest-server.ts; index.ts.
- The S2 cron dispatcher (`cron-run.ts`) and S3 route helper (`http/route-table.ts`).
- The durable-queue db adapter (`jobs/queue.ts`).
- The photo-path-migration startup module (runs on api boot; features/booth +
  features/wakes schema consumers — app-level boot task, KEEP).
- DEFERRED-INTERIM (removed by separate units, NOT here): the hand-wired worker
  cycles (climate/light enforcers, party, device-sync + device-ownership, weight
  ingest, youtube ingest, asc-version poll), the env-bound `ha` singleton, and the
  `worker-deps.ts` barrel.

## Is a fully-thin apps/api reachable in THIS unit?

NO. This unit removes only the genuinely-dead barrel (`integrations/unifi.ts`) + an
empty dir, and (commit 2) migrates github-purge to S2 to delete `purge.ts`. The bulk
of what remains is DEFERRED-INTERIM by explicit roadmap decision and requires the two
named post-Track-C units: (1) the device-ownership hoist (moves enforcers +
device-sync + device-ownership + the `ha` singleton out), and (2) the interval-cycle
-> packages/core extraction (moves weight/youtube/asc/party cycles out and DELETES
`worker-deps.ts`). "Thin shell as far as Track C reaches" = app-level routers/contracts
+ S2/S3 seams + the still-hand-wired worker barrel.

## Verify chain

- `bun run typecheck`
- `bun run apps:check` (codegen drift — commit 2 regenerates crons.gen + cron-handlers.gen)
- `bun run knip` — ZERO-TOLERANCE, the KEY tool: it must stay clean after the moves.
  Any now-dead @www/core export or orphaned helper the deletions leave will surface here.
- `bun run lint` (biome; format the regenerated `_generated/*` + moved files —
  drizzle/gen meta JSON needs `bunx biome format --write` before commit)
- Affected tests: relocated `packages/core` unifi test; `features/deploys` (commit 2);
  any apps/api purge/cron-run tests touched.

## Gotchas

- Shared main checkout: other sessions are editing concurrently. Stage EXPLICIT paths
  (never `git add -A`/`-U`), check `git show --stat HEAD` after commit. The lefthook
  format hook re-stages the whole tree; use `--no-verify` as the escape if a peer's
  dirty tree blocks the push.
- No backticks in commit messages.
- Do NOT delete DEFERRED-INTERIM code (enforcers/pollers/ingest/ha-singleton/worker-deps).
- Commit 2 step 7 (secret-target coupling) is a hard gate — resolve before deleting the
  CronJob block or you break every generated cron's secret.
- `unifi-guest.test.ts` is the ONLY UniFi guest-auth coverage — relocate, never delete.
- Push each commit immediately (main = deploy). Commit 2 touches infra + Dockerfile;
  watch the deploy and verify no orphaned `portal-data-purge` CronJob + that
  `deploys-purge` runs.
