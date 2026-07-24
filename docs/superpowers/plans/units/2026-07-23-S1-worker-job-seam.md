# Unit S1 — Worker job-handler seam (keystone) + fold `notif`

> Track C, Phase 2 / Wave 3. Roadmap `~/.claude/plans/merry-hugging-river.md` §S1;
> master plan `docs/superpowers/plans/2026-07-23-track-c-master-execution.md` (S1
> unit + F-notif). This plan is for the IMPLEMENTER; a separate agent executes it.
> Do not re-litigate the roadmap's locked decisions.

## What this unit builds

The generic durable-job seam every future worker-backed feature inherits, then
proves it end-to-end by folding `notif` (APNs fan-out) as its first consumer.

Today: `defineJobs` is collected/run by nothing; `JobType` is a CLOSED union
`"notify" | "youtube_ingest"` in `apps/api/src/jobs/queue.ts`; the worker's
`JOBS[]` is hand-built in `apps/worker/src/index.ts` from named handler imports
through the `@control-center/api/worker` barrel. After S1: durable-queue
primitives live in `@www/core`, `JobType` is open, a feature declares its jobs as
a branded facet, codegen emits `features/_generated/jobs.gen.ts`, and the worker
folds the generated handlers into `JOBS[]` with zero per-feature hand-wiring.

**Scope guard (do NOT violate):** S1 covers DURABLE QUEUE JOBS ONLY. The only
real queue jobs are `notify` and `youtube_ingest` (`queue.ts:33`). Every 1s/15s/
10s/2m/5m interval in `apps/worker/src/index.ts` (light/climate/sonos-volume/
device-sync enforcers, weight-ingest, github-actions-poll, weather-ingest,
playlist-poller, asc-version-poll, party-mode) is a `Worker` INTERVAL, not a job.
Those stay hand-wired in `apps/worker` importing `@features/*` (allowed direction)
— permanently, per the roadmap. NEVER route an interval through this seam. In
this unit only `notify` moves onto the seam; `youtube_ingest` stays hand-wired in
the worker (its feature, media, is not folded until Wave 6).

---

## Ground truth (verified this session — do not re-derive)

- `@www/core` has **no `db` singleton.** It exposes `createPool` + drizzle
  *adapters that take an injected db* (`packages/core/src/device-state/pg.ts`
  `createPgDeviceStateStore(db)`, `integration-sync/pg.ts`). The module-singleton
  `db` lives only in `apps/api/src/db/index.ts` (`drizzle(pool, { schema })`), and
  each folded feature builds its OWN db handle (`features/guest-wifi/db.ts` =
  `drizzle(createPool(config.DATABASE_URL), { schema })`). **This is the single
  fact that shapes the whole seam:** `enqueueJob`/`claimOne` cannot keep a
  module-singleton db in core without a `core → apps/api` cycle, so they must take
  an **injected db**, mirroring the store precedent.
- `enqueueJob` has exactly three runtime callers:
  `apps/api/src/services/notification-service.ts:213` (→ moves into the feature),
  `apps/api/src/trpc/routers/media.ts:243` (`youtube_ingest`, stays in apps/api),
  `apps/api/src/services/playlist-poller-service.ts:143` (`youtube_ingest`, stays
  in apps/api). Plus test mocks in `queue.test.ts`, `notification-service.test.ts`,
  `playlist-poller-service.test.ts`.
- `JobHandler` importers: `youtube-ingest-service.ts:25`, `notification-service.ts:32`.
- `app-kit/define-facets.ts` already declares `JOBS_FACET_BRAND` + a placeholder
  `JobSpec { name; run }` and `defineJobs(jobs: JobSpec[])`. Its ONLY consumers are
  `app-kit/define-app.test.ts` and the `app-kit/index.ts` re-export — tiny blast
  radius to reshape.
- The worker's real `JobSpec` is `{ type: JobType; handler: JobHandler; maxMs }`
  (`apps/api/src/jobs/job-worker.ts:20`). `claimOne(type, handler, maxMs)`
  (`queue.ts:185`) and `reapStaleJobs(specs)` need BOTH a `JobType` discriminant
  AND `maxMs`, neither of which app-kit's `{name, run}` facet carries. The two
  `JobSpec` types must be reconciled to the worker's shape.
- `collect.ts` already collects `defineCron` (CRON_BRAND) from each feature's
  `jobs.ts` and emits `crons.gen.ts`; it does **not** yet collect `JOBS_FACET_BRAND`.
  `renderCrons` (`emit.ts:152`) is the exact emission pattern to mirror for jobs —
  except jobs.gen.ts must emit *import barrels* of the real handler specs (like
  `renderRouter`), not a data-only listing (crons.gen.ts is data-only scaffolding).
- The `job` pgTable is `apps/api/src/db/schema.ts:21`; `notification` +
  `device_push_token` are `:436` / `:467`.
- The generated router aggregate is consumed at `apps/api/src/trpc/routers/index.ts:1`
  (`mergeRouters(baseRouter, featureAppRouter)`); `notificationsRouter` is a base
  entry there today (`notifications:` key) and must be removed when the feature
  api.ts takes over.
- `apps/worker` does NOT currently import `@features/*` — it will need the
  `@features` alias added to its tsconfig + build (see gotchas).
- No `apps/worker/src/__tests__/` dir exists yet — the seam-proof test creates one.

---

## Resolved decisions

### D1 — Package for the queue primitives: `@www/core`

`queue.ts` needs `db` + drizzle + the `job` table. `@www/core` already owns the
db substrate (`createPool`) and the store-adapter precedent, and features +
apps/api + apps/worker all already depend on `@www/core`. A *new* `@www/jobs`
package would have to depend on `@www/core` (for the pool/db types) and be
depended on by core's peers — net more edges for zero benefit. **No cycle:** core
imports nothing from apps/* or features/*; the db is injected, so the direction
stays features/apps → core. Decision: `@www/core`, matching the master plan's
resolution. The `job` **table relocates into core's schema** — that relocation is
real work, not just moving functions.

### D2 — `JobType` open mechanism: registry augmentation (interface merging)

Moving the type to core kills the closed co-located union. Make it open via a
declaration-merged registry, preserving the compile-fail-on-typo guarantee the
current code prizes AND adding per-type payload typing (a genuine 10x win):

```ts
// packages/core/src/jobs/queue.ts
/**
 * Open registry of job types. A feature (or apps/api, interim) augments this via
 * `declare module "@www/core"` so its type + payload are known at the enqueue AND
 * handler sites without core depending on the feature. An unregistered type is a
 * compile error at the producer, not a row that parks forever.
 */
export interface JobTypeRegistry {}
export type JobType = keyof JobTypeRegistry & string;
export type JobPayload<T extends JobType> = JobTypeRegistry[T];
```

A consumer augments it (see notif §Fold, and apps/api for the interim
`youtube_ingest`):

```ts
declare module "@www/core" {
  interface JobTypeRegistry {
    notify: { notificationId: string };
  }
}
```

`enqueueJob` becomes payload-typed: `enqueueJob<T extends JobType>(db, type: T,
payload: JobPayload<T>, opts?)`.

**Mechanism CONFIRMED — ship registry augmentation, do NOT fall back to
`JobType = string`.** The plan-reviewer spiked this against real `tsc` (4-package
mirror, `moduleResolution: bundler`): `declare module "@www/core"` DOES merge into
the `interface JobTypeRegistry {}` re-exported through core's `export *` barrel —
`enqueueJob(db, "notify", {notificationId})` typechecks, a typo'd `"notifyy"`
compile-fails (typo-guarantee preserved), and a wrong payload shape compile-fails
(payload typing works). The guarantee is **symmetric and sharp**: `JobType` is the
registered set ONLY in programs whose root files include the augmenting file, and
`never` everywhere else (a program without the augmentation fails
`TS2345: '"notify"' … not assignable to 'never'`). That `never` collapse is the
real hazard, and it is closed per-program by mandating augmentation placement (B1,
M1, M2 below), NOT by degrading the type. There is no fallback.

**Augmentation placement per program (VERIFIED against real tsconfigs — obey exactly):**
- `features/**` (typechecked by `tsconfig.config.json`, `include: features/**/*.ts`
  as a glob → every `jobs.ts` is a program root regardless of imports): notif's
  producer `service.ts` and its augmenter `features/notif/jobs.ts` are in the SAME
  program → `notify` visible. ✅ (commit 2)
- `apps/api` (`tsc` from apps/api, follows imports): producers are `media.ts` +
  `playlist-poller-service.ts` (`youtube_ingest`) AND, **in commit 1 only**,
  `notification-service.ts:213` (`notify`). BOTH augmentations must live in a file
  this program pulls in → put them in `apps/api/src/jobs/queue.ts` (see §1b / B1).
- `apps/worker` (`tsc` from apps/worker): builds the `youtube_ingest` spec inline
  and spreads `GENERATED_JOBS`. Reaches `apps/api` ONLY via the
  `@control-center/api/worker` barrel (`worker-deps.ts`), so the `youtube_ingest`
  augmentation MUST live where that barrel transitively imports it —
  `apps/api/src/jobs/queue.ts`, NOT a standalone `jobs.types.ts` nothing pulls in
  (§1b / M2). `notify` reaches the worker via `@features/_generated/jobs.gen →
  features/notif/jobs.ts` (commit 2).
- `packages/core`: defines the empty registry; generic code never names a concrete
  type so `never` is fine — EXCEPT the moved `queue.test.ts`, which needs a
  test-local augmentation (§Commit-1 verify / M1).

### D3 — `JobSpec` reconciliation

Delete app-kit's `{name, run}` `JobSpec`. Core owns the single `JobSpec`:

```ts
export interface JobSpec {
  type: JobType;
  handler: JobHandler;   // (payload, signal) => Promise<void>
  maxMs: number;
}
```

app-kit's `defineJobs` re-types over core's `JobSpec` (type-only import of
`JobSpec`/`JobType` from `@www/core`; app-kit → core is acyclic — core imports
nothing from app-kit). The worker's `job-worker.ts` `JobSpec` is deleted in favour
of the core one. Result: ONE `JobSpec`, authored by `defineJobs`, collected by
codegen, consumed by the worker runner.

### D4 — db wiring (the crux)

Core exports **db-injected** primitives:

```ts
// packages/core/src/jobs/queue.ts  (schema in ./schema.ts)
export function enqueueJob<T extends JobType>(db: JobQueueDb, type: T, payload: JobPayload<T>, opts?: EnqueueOptions): Promise<number>
export async function claimOne(db: JobQueueDb, spec: JobSpec): Promise<boolean>   // was (type,handler,maxMs)
export async function releaseInFlightJobs(db: JobQueueDb): Promise<number>
export async function releaseInFlightJobsWithTimeout(db: JobQueueDb, timeoutMs?): Promise<number>
export function jobWorker(db: JobQueueDb, spec: JobSpec): Worker          // was (spec)
export function staleJobReaper(db: JobQueueDb, specs: readonly JobSpec[]): Worker
```

`JobQueueDb` = the minimal structural surface (`Pick<NodePgDatabase<Record<string,
unknown>>, "insert" | "transaction" | "execute">`), exactly like `PgDeviceStateDb`.
The module-level `inFlight` map stays module-global in core (one queue per process;
the shutdown handler has no per-call handle) — only the *db* is threaded through.

**Minimise churn with a thin apps/api adapter.** `apps/api/src/jobs/queue.ts`
becomes a ~15-line binder that re-exports the core primitives pre-bound to
apps/api's `db`, so apps/api's own callers (media, playlist-poller), its tests,
and the `@control-center/api/worker` barrel keep their existing signatures:

```ts
// apps/api/src/jobs/queue.ts (after)
import { db } from "../db/index";
import * as core from "@www/core";
export type { JobHandler, JobType, JobSpec } from "@www/core";
export const enqueueJob: typeof core.enqueueJob extends never ? never : /* bound */ =
  (type, payload, opts) => core.enqueueJob(db, type, payload, opts);
export const releaseInFlightJobsWithTimeout = (ms?) => core.releaseInFlightJobsWithTimeout(db, ms);
// ...claimOne / jobWorker / staleJobReaper bound similarly, OR keep job-worker.ts
//    as a thin binder over core.jobWorker(db, spec).
```

- **apps/api producers** (`media.ts`, `playlist-poller-service.ts`) keep importing
  the bound `enqueueJob` from `../jobs/queue` — no signature change, no diff.
- **features/notif** imports `enqueueJob` from `@www/core` directly and passes its
  OWN feature db: `enqueueJob(db, "notify", { notificationId })` (features cannot
  import apps/api). Same physical Postgres `job` table, different drizzle handle —
  consistent, because the injected-db pattern touches the table by object/SQL, not
  by a schema-bound singleton.
- **apps/worker** keeps importing `jobWorker`/`staleJobReaper`/
  `releaseInFlightJobsWithTimeout` through the barrel (bound to apps/api's db). The
  runner polls the `job` table with apps/api's db; each handler uses its own
  feature db internally. One physical DB → consistent. This matches the master
  plan's S1 file list (`worker-deps.ts` stays a seam).

### D5 — Two commits

1. **`feat(jobs): generic worker-job seam over @www/core + jobs.gen.ts (S1)`** —
   move primitives to core (job table + queue + runner), open `JobType`, reshape
   the app-kit facet, collect `JOBS_FACET_BRAND`, emit `jobs.gen.ts` (initially an
   empty barrel — no feature has a jobs facet yet), make the worker fold
   `GENERATED_JOBS` generically while `notify` + `youtube_ingest` remain
   hand-wired. Ships green: seam exists, behaviour identical.
2. **`feat(notif): fold notif into features/notif on the S1 job seam`** — the
   atomic feature fold (manifest + all facets in ONE commit), which adds
   `features/notif/jobs.ts`, so `jobs.gen.ts` now contains the `notify` spec and
   the worker picks it up generically; delete the hand-wired `notify` line + the
   `runNotifyJob` barrel export.

Rationale: commit 1 is generic infra with no behaviour change (reviewable in
isolation as "the seam"); commit 2 is the first consumer that *proves* it. Keeps
the keystone diff legible and lets the Wave-3 boundary review diff them
separately.

### D6 — notif tile facts

Coords **verbatim** from `apps/web/src/lib/tile-registry.ts:186`: `worldCol: 38,
worldRow: 24, cols: 4, rows: 3`. **`guestExposed: no`** (not in the registry as
guest-exposed; internal panel feature — must stay OUT of `features/guest-exposed.ts`
or the validator throws). `home: no`.

---

## Commit 1 — S1 seam (generic infra)

### 1a. Move the job table into core

- New `packages/core/src/jobs/schema.ts`: move the `job` pgTable verbatim from
  `apps/api/src/db/schema.ts:21-53` (id/type/payload/status/priority/attempts/
  maxAttempts/runAfter/lockedAt/lastError/createdAt/updatedAt + `job_claim_idx`).
  Export it from `packages/core/src/index.ts` (see §1b export block).
- Delete the `job` pgTable definition from `apps/api/src/db/schema.ts` and
  **MANDATORY: re-export the identifier** there, verbatim in the style of
  `integrationSyncStatus`: add `job` to the existing
  `export { …, deviceState, integrationSyncStatus, … } from "@www/core";` block (or
  its own `export { job } from "@www/core";`). This is REQUIRED, not conditional
  (B3 — PLACEHOLDER-2 resolved). Why: `apps/api/drizzle.config.ts` points
  drizzle-kit at `features/_generated/schema.gen.ts`, whose only apps/api surface is
  `export * from "../../apps/api/src/db/schema"`. Core tables reach drizzle-kit
  **solely by being identifier-re-exported from `apps/api/src/db/schema.ts`** —
  that is exactly why `deviceState` + `integrationSyncStatus` are re-exported there
  today (schema.ts ~:73-82, with the comment "so the drizzle relational schema
  still registers it"). WITHOUT `export { job }` in apps/api schema, `schema.gen.ts`
  never surfaces `job` and `db:generate` emits `DROP TABLE job`. The plan's earlier
  "may be unnecessary" hedge was WRONG.
  - Knip-safe: the `integrationSyncStatus` identifier re-export survives knip today
    by this same drizzle-surface precedent, so `job` will too (the raw-SQL claim
    path uses the table NAME; drizzle-kit consumes the re-exported OBJECT).
  - `db:generate` MUST produce **no DROP/CREATE** for `job` — the table is
    unchanged, only its TS home moved. Verify by dry-run (§Commit-1 verify).

### 1b. Move queue + runner into core, db-injected

- New `packages/core/src/jobs/queue.ts`: move `enqueueJob`, `claimOne`,
  `backoffSec`, `inFlight`/`InFlightJob`, `releaseInFlightJobs`,
  `releaseInFlightJobsWithTimeout`, `JobHandler`, `EnqueueOptions` from
  `apps/api/src/jobs/queue.ts`. Add `JobTypeRegistry`/`JobType`/`JobPayload`
  (§D2), `JobSpec` (§D3). Thread an injected `db: JobQueueDb` through every fn
  (§D4). `claimOne(db, spec)` (take the whole spec, not 3 args — cleaner call
  from `jobWorker`). Import `job` from `./schema`, `getLogger` from `@www/logger`,
  `sql` from `drizzle-orm`.
- New `packages/core/src/jobs/runner.ts` (or same file): move `jobWorker`,
  `staleJobReaper`, `reapStaleJobs`, and the `JOB_POLL_INTERVAL_MS` /
  `REAP_INTERVAL_MS` / `REAP_GRACE_MS` constants from `job-worker.ts`, each taking
  `db`. Import `Worker` from `@www/worker-runtime` (core already depends on it? —
  **verify**; if not, add the dep. worker-runtime imports nothing from core, so no
  cycle).
- Export all of the above from `packages/core/src/index.ts` (append lines in the
  existing alphabetical block).
- Rewrite `apps/api/src/jobs/queue.ts` as the thin bound adapter (§D4). Rewrite or
  delete `apps/api/src/jobs/job-worker.ts`: if kept, it becomes a thin binder
  (`export const jobWorker = (spec) => core.jobWorker(db, spec)` etc.); prefer
  binding in `queue.ts` and deleting `job-worker.ts` if that leaves knip clean.
- `apps/api/src/worker-deps.ts`: keep re-exporting `JobSpec`, `jobWorker`,
  `staleJobReaper`, `releaseInFlightJobsWithTimeout` (now from the bound adapter).
  No change to the export names in commit 1.
- **Interim augmentation — commit 1 registers BOTH `notify` AND `youtube_ingest`**
  (B1 + M2). In commit 1 notif has NOT moved: `notification-service.ts:213` still
  calls `enqueueJob(NOTIFY_JOB_TYPE, { notificationId })` (`NOTIFY_JOB_TYPE =
  "notify"`) inside the apps/api program, and the worker builds the
  `youtube_ingest` spec. With the open registry, both `"notify"` and
  `"youtube_ingest"` collapse to `never` (compile-red) unless registered in the
  programs that name them. Place the augmentation in **`apps/api/src/jobs/queue.ts`**
  (the bound adapter) — NOT a standalone `jobs.types.ts`. This is load-bearing:
  `worker-deps.ts` re-exports through `apps/api/src/jobs/queue.ts`, so the
  `@control-center/api/worker` barrel transitively pulls this file into the
  `apps/worker` program (M2 — a file nothing in the worker's import graph imports
  would leave `youtube_ingest` as `never` in the worker).
  ```ts
  // apps/api/src/jobs/queue.ts
  declare module "@www/core" {
    interface JobTypeRegistry {
      notify: { notificationId: string };                                  // interim — deleted in commit 2
      youtube_ingest: { mediaSourceId: string; videoId: string };          // stays through Wave 6
    }
  }
  ```
  (Confirm the real youtube payload shape from `media.ts:243` /
  `playlist-poller-service.ts:143`; confirm the notify payload from
  `notification-service.ts:213` — match both exactly.) Commit 2 DELETES the
  `notify` line from this block atomically with the service move (it relocates to
  `features/notif/jobs.ts`); the `youtube_ingest` line stays until media folds at
  Wave 6.

### 1c. Reshape the app-kit facet

- `app-kit/define-facets.ts`: delete the `{name, run}` `JobSpec`; `import type {
  JobSpec, JobType } from "@www/core"`; retype `defineJobs(jobs: JobSpec[]):
  JobSpec[]` (keep the brand). Keep `CronSpec` untouched.
- `app-kit/index.ts`: update the `JobSpec` type re-export to come from
  define-facets' re-export (or straight from `@www/core`). Keep `JOBS_FACET_BRAND`
  + `defineJobs` exports.
- `app-kit/define-app.test.ts`: update the `defineJobs` case to the new shape
  (`{ type, handler, maxMs }`).
- **CONFIRMED allowed (no action):** `app-kit → @www/core` passes the Biome
  boundary rule. `biome.json` (~:187-205) bans only `@control-center/api` and
  `@features` from app-kit — NOT `@www/core`; and the `packages/core` rule (~:219+)
  bans core→app-kit/features (the other direction). Use `import type { JobSpec,
  JobType } from "@www/core"` regardless (types-only, erased).

### 1d. Collect JOBS_FACET_BRAND

`scripts/apps-gen/collect.ts`:
- Add `JOBS_FACET_BRAND` to the app-kit import.
- Add `CollectedJob { type: string; maxMs: number; source: string }` and a
  `jobs: CollectedJob[]` field on `AppModel`; add `hasJobs: boolean` to
  `CollectedFeature`.
- In the `jobs.ts` scan loop (currently only CRON_BRAND), also detect
  `JOBS_FACET_BRAND` arrays: `if (Array.isArray(v) && v[JOBS_FACET_BRAND])` →
  push `{ type, maxMs, source }` for each spec; set `hasJobs = true` for the
  feature. (A feature's jobs.ts may export both crons and a jobs facet — keep both
  branches.) Do NOT invoke handlers; read only `type` + `maxMs`.
- Thread `jobs` into the returned `AppModel`.

### 1e. Emit jobs.gen.ts

`scripts/apps-gen/emit.ts` — add `renderJobs(model)`, mirroring `renderRouter`
(an import barrel of the REAL facets, NOT a data listing like crons):

```ts
export function renderJobs(model: AppModel): string {
  const withJobs = sortedFeatures(model).filter((f) => f.hasJobs);
  if (withJobs.length === 0) {
    return `${GEN_HEADER}

import type { JobSpec } from "@www/core";

export const GENERATED_JOBS: readonly JobSpec[] = [];
`;
  }
  const imports = withJobs
    .map((f) => `import { jobs as ${ident(f.dir)}Jobs } from "../${f.dir}/jobs";`)
    .join("\n");
  const spread = withJobs.map((f) => `...${ident(f.dir)}Jobs`).join(",\n  ");
  return `${GEN_HEADER}

import type { JobSpec } from "@www/core";
${imports}

export const GENERATED_JOBS: readonly JobSpec[] = [
  ${spread},
];
`;
}
```

Convention: **each feature's `jobs.ts` exports `export const jobs = defineJobs([…])`**
(named `jobs`, mirroring `api.ts`'s `api`). Wire `renderJobs` into
`scripts/apps-gen.ts` `main()` (`writeFileSync(join(GEN_DIR, "jobs.gen.ts"),
renderJobs(model))`). Create the initial committed `features/_generated/jobs.gen.ts`
(empty barrel) by running `bun run apps:gen`.

### 1f. Validate

`scripts/apps-gen/validate.ts`: add a **duplicate job-type** check across features
(mirror the dup router-key / dup table checks) — two features registering the same
`type` would both claim the same rows. Add `jobs?: { type; source }[]` to the
`Model` type; throw `CodegenError` on a dup type.

### 1g. Worker generic fold

`apps/worker/src/index.ts`:
- Add `import { GENERATED_JOBS } from "@features/_generated/jobs.gen";` (needs the
  `@features` alias in the worker — see gotchas).

**MANDATORY commit-1 edit — worker Dockerfile bundle (B2, CI-only failure).**
`apps/worker/Dockerfile:43` is currently
`RUN bun build apps/worker/src/index.ts --target=bun --outfile dist/worker.js`,
run from `/app` (repo root) whose `tsconfig.json` is deliberately `paths`-free.
Adding the `@features/_generated/jobs.gen` import makes this bundle step fail to
resolve `@features` — but ONLY in CI (local `typecheck`/`vitest` stay green because
`apps/worker/tsconfig.json` already carries the `@features/*` path; `bun build`
reads the CWD tsconfig, not the worker's). Change line 43 to mirror the already-fixed
`apps/api/Dockerfile:52` (`cd apps/api && bun build src/server.ts …`):
```
RUN cd apps/worker && bun build src/index.ts --target=bun --outfile ../../dist/worker.js
```
(Keep the outfile at the same `dist/worker.js` the runtime stage COPYs — from
`apps/worker` the repo-root `dist/` is `../../dist/`. Verify the Stage-2 COPY path
still matches.) Memory: `bun-build-alias-needs-cwd-tsconfig`.
- Rebuild `JOBS`:
  ```ts
  const JOBS: JobSpec[] = [
    ...GENERATED_JOBS,
    ...(env.YOUTUBE_INGEST_ENABLED ? [ /* youtube_ingest spec, unchanged, with disk-guard */ ] : []),
  ];
  ```
  In commit 1, `GENERATED_JOBS` is still empty, so `notify` stays hand-wired here
  (unchanged) alongside `youtube_ingest`. Behaviour identical. The `...JOBS.map(jobWorker)`
  + `staleJobReaper(JOBS)` lines are unchanged (jobWorker/reaper come from the
  barrel, bound to apps/api db). **Verify** `jobWorker`/`staleJobReaper` signatures
  after §1b binding still take a bare spec (the binding hides the db).

### Commit-1 verify

`bun run apps:gen` → `bun run typecheck` → `bunx vitest run` the affected projects
(`packages/core`, `apps/api`, `apps/worker`, `scripts/apps-gen`) → `bun run
apps:check` → `bun run knip` → `bun run lint`. `db:generate` must show no `job`
DROP/CREATE (dry-run and inspect). Then commit + push (§Verify chain).

**Moved `queue.test.ts` — REQUIRED test-local augmentation (M1).**
`apps/api/src/__tests__/queue.test.ts` passes concrete literals
`claimOne("notify", …)` / `claimOne("youtube_ingest", …)` (12+ sites, ~:168-:369)
and `enqueueJob("my_job" as JobType, …)`. Relocate it to `packages/core`
(cleanest home for the moved primitive) and drop its db mock in favour of an
injected mock `JobQueueDb`. core's program has NO feature/apps augmentation, so
every literal collapses to `never` unless the test registers them itself. Add a
**test-local augmentation at the top of the file**:
```ts
declare module "@www/core" {
  interface JobTypeRegistry {
    notify: { notificationId: string };
    youtube_ingest: { mediaSourceId: string; videoId: string };
    my_job: unknown;   // synthetic, for the generic-path assertions
  }
}
```
(Alternatively keep the `as JobType` casts on every literal — but the local
augmentation is cleaner and exercises payload typing.) This is orthogonal to the
`claimOne(db, spec)` vs `claimOne(type, handler, maxMs)` signature choice — the
literals need the augmentation either way (PLACEHOLDER-3 resolved: pick
`claimOne(db, spec)` per §D4; update the moved test's call sites to match).

---

## Commit 2 — fold `notif` (first consumer, proves the seam)

Mirror `features/guest-wifi` + `features/network`. **One atomic commit**: manifest
+ every facet together (codegen only collects a facet when `manifest.ts` exists).

### File moves (source → dest)

| Source | Dest |
| --- | --- |
| `apps/api/src/db/schema.ts` `notification` + `device_push_token` tables (`:436`, `:467`) | `features/notif/schema.ts` (delete from apps/api schema; verify no other apps/api ref) |
| `apps/api/src/services/notification-service.ts` | `features/notif/service.ts` |
| `apps/api/src/services/apns-service.ts` | `features/notif/apns.ts` |
| `apps/api/src/trpc/routers/notifications.ts` | `features/notif/api.ts` (`defineApi`, via `@app-kit/server`) |
| `apps/api/src/components/tiles/NotificationCenterTile.tsx` + `NotificationCenterTileView.tsx` + `views/ExpandedNotificationCenterView.tsx` | `features/notif/web.tsx` (define tile + views in the feature, importing shared UI from `@/components/ui`, `@/lib/notifications`, `@/lib/trpc`) |
| `apps/web/src/components/tiles/detail/wiring/notifications.tsx` | **STAYS in apps/web** (m1 / PLACEHOLDER-4 resolved). Precedent is unambiguous — `guest-wifi.tsx`, `tv.tsx`, `sound.tsx` all keep their detail wiring in `apps/web/.../detail/wiring/` after folding and import the feature's view. Do NOT co-locate in `features/notif/web.tsx`. Only **repoint its `ExpandedNotificationCenterView` import** to the view's new home (feature `web.tsx` or shared views dir). |
| — (new) | `features/notif/jobs.ts` (`export const jobs = defineJobs([{ type: "notify", handler: runNotifyJob, maxMs: 60_000 }])` + the `notify` `JobTypeRegistry` augmentation) |
| — (new) | `features/notif/db.ts` (`drizzle(createPool(config.DATABASE_URL), { schema })` — copy guest-wifi/db.ts) |
| — (new) | `features/notif/config.ts` (slice: `DATABASE_URL` + `APNS_KEY_ID`/`APNS_TEAM_ID`/`APNS_KEY_CONTENT`/`APNS_BUNDLE_ID`/`APNS_HOST` — copy guest-wifi/config.ts shape; apns.ts reads from this, not `apps/api/src/env`) |
| — (new) | `features/notif/manifest.ts` (`defineApp`, coords §D6) |

**Stay in apps/web** (shell-level, not the tile): `lib/notifications.ts` (+ its
tests), `PushRegistrar.tsx`, `NotificationBridge.tsx`, and the `*.stories.tsx`
(stories stay in apps/web per the fold rule). The feature's `web.tsx` imports
`@/lib/notifications` (features → apps/web is allowed).

### Wiring edits

- `features/notif/service.ts`: `import { enqueueJob, type JobHandler } from "@www/core"`;
  the internal `db`/`enqueueJob` calls now pass the feature db
  (`enqueueJob(db, NOTIFY_JOB_TYPE, { notificationId: row.id })`). `handleNotifyJob`
  + `runNotifyJob` keep their shape but default to the FEATURE's singleton db
  (`./db`), and `sendApnsPush` comes from `./apns`.
- `features/notif/jobs.ts`:
  ```ts
  import { defineJobs } from "@app-kit";
  import { runNotifyJob } from "./service";

  declare module "@www/core" {
    interface JobTypeRegistry { notify: { notificationId: string } }
  }

  export const jobs = defineJobs([{ type: "notify", handler: runNotifyJob, maxMs: 60_000 }]);
  ```
  Keep this module's import surface light so codegen can import it under jsdom/bun
  without side effects (apns is env-gated + opens no top-level connection; db is
  lazy — same as guest-wifi/jobs.ts). Move the `youtube_ingest` augmentation OUT
  of the way — notif only owns `notify`.
- `apps/api/src/trpc/routers/index.ts`: delete the `notifications` import + the
  `notifications: notificationsRouter` base entry (the feature api.ts now supplies
  it via `featureAppRouter`; verify the router key stays `notifications`).
- `apps/web/src/lib/tile-registry.ts`: delete the `tile_notif` entry (`:186`) + the
  `NotificationCenterTile`/`NotificationCenterTileView` imports (`:30`, `:31`);
  import the manifest so the board still renders it (mirror guest-wifi/network).
- `apps/worker/src/index.ts`: delete the hand-wired `{ type: "notify", handler:
  runNotifyJob, maxMs: 60_000 }` line (now supplied by `GENERATED_JOBS`) and the
  `runNotifyJob` import.
- `apps/api/src/worker-deps.ts`: delete `export { runNotifyJob } from
  "./services/notification-service"` (file moved; knip would flag it).
- **`apps/api/src/jobs/queue.ts`: DELETE the interim `notify` line from the
  `declare module "@www/core"` block** (added in commit 1) — it now lives in
  `features/notif/jobs.ts`. This MUST be atomic with the `notification-service.ts`
  move: after commit 2 apps/api no longer produces `notify` (only `youtube_ingest`
  remains in the block). Leaving the interim `notify` line would double-register the
  type across two programs — harmless at runtime but stale; delete it. (B1 tail.)
- **Do NOT** add notif to `features/guest-exposed.ts` (guestExposed: no).

### Tests

- Relocate `apps/api/src/__tests__/notification-service.test.ts` →
  `features/notif/service.test.ts` (or `features/notif/__tests__/`); update mocks:
  it mocks `../jobs/queue` `enqueueJob` and `../db/index` — repoint to `@www/core`
  `enqueueJob` (mock the module) and `./db`. Wire the feature test into the
  vitest project that covers `features/*` — **verify** which project runs
  `features/**` today (guest-wifi's `service.ts` tests run under some project;
  check `vitest.config.ts` projects + guest-wifi's test placement and mirror it).
- Keep `apps/web/src/lib/__tests__/notifications.test.ts` +
  `notification-bridge.test.ts` in place (shell lib, unchanged).

### Prove the generated handler actually runs (seam proof — required)

Two levels:
1. **Codegen level** (`scripts/apps-gen/collect.test.ts` +/or `emit.test.ts`):
   assert `collect()` picks up a job facet with `type === "notify"` + `maxMs ===
   60000` from `features/notif/jobs.ts`, and `renderJobs(model)` emits an
   `import { jobs as notifJobs }` line + spreads it into `GENERATED_JOBS`.
2. **Worker seam level** (new `apps/worker/src/__tests__/jobs-seam.test.ts`).
   **First confirm the runtime `@features` alias (M3):** this test imports
   `@features/_generated/jobs.gen` at RUNTIME (esbuild/vitest resolves the alias,
   NOT tsc — the tsconfig path is irrelevant here). `apps/worker` has no test dir
   today. Confirm the vitest project that will own `apps/worker/**` (worker-local
   `vitest.config.ts` or the root `vitest.config.ts` project) aliases `@features` →
   `features/*`; mirror how the `apps-gen` project aliases it. Without this the test
   fails to resolve the generated barrel at import — a hard prerequisite, add the
   alias if absent. Then:
   import `GENERATED_JOBS` from `@features/_generated/jobs.gen`; find the spec with
   `type === "notify"`; assert `handler` is a function; **invoke it** with a
   mocked feature db + mocked apns (`sendApnsPush`) and a fresh `AbortSignal`, and
   assert the notify path ran (e.g. the notification row was loaded / apns send was
   attempted for a push-enabled device). This proves the handler reachable through
   the generated barrel is the real `notify` handler and that invoking the
   collected spec executes it — not merely that a spec is present.

### Commit-2 verify

Full per-unit chain: `bun run apps:gen` → `bun run typecheck` →
`bunx vitest run` (packages/core, apps/api, apps/worker incl. jobs-seam,
scripts/apps-gen, apps/web incl. the placeholder-tiles / bento 1x1 clearance test
after the registry deletion) → `bun run apps:check` → `bun run knip` →
`bun run lint`. Then commit + push + watch CI.

---

## Full verify chain (both commits, IMPLEMENTER runs in order)

```
bun run apps:gen                       # regenerate features/_generated/*.gen.ts (incl. jobs.gen.ts)
bun run typecheck
bunx vitest run <affected projects>    # packages/core apps/api apps/worker scripts/apps-gen apps/web
bun run apps:check                     # codegen drift + validator (incl. new dup-job-type check)
bun run knip                           # zero-tolerance whole tree (dead barrel exports fail here)
bun run lint                           # Biome incl. noRestrictedImports dep-boundary rule
git pull --rebase --autostash          # parallel sessions push main
git add <explicit paths>               # NEVER git add -A
git commit -m "<message>"              # NO backticks
git push
gh run watch <run-id> --exit-status    # FOREGROUND — do not yield to a monitor (subagents stall)
# then confirm deploy green + pod image age (ci-cancelled-runs-strand-image-digests)
```

Extra checks specific to S1:
- `db:generate` (dry) shows **no** `job` table DROP/CREATE after the schema move.
- Biome dep rule stays green: no `features/* → apps/api` import (notif reaches the
  runtime only via `@www/core` + `@app-kit/server` + `@/…`).
- After commit 2: `bun run knip` confirms `runNotifyJob` is gone from
  `worker-deps.ts` and the worker; the `notify` line is gone from `JOBS[]`.
- Wave-3 boundary review (manager, not this unit): confirm the notify job still
  drains — check the `job` table / worker logs for a `notify` claim after a raise.

## Commit messages (no backticks, no em-dashes in -m)

1. `feat(jobs): generic worker-job seam over @www/core + jobs.gen.ts (S1)`

   Body: Move enqueueJob/claimOne/runner/job-table into @www/core (db-injected,
   store precedent). Open JobType via a JobTypeRegistry augmentation. Reshape the
   app-kit jobs facet to {type,handler,maxMs}. Collect JOBS_FACET_BRAND and emit
   features/_generated/jobs.gen.ts as a handler barrel; worker folds GENERATED_JOBS
   generically. No behaviour change: notify + youtube_ingest still hand-wired.

2. `feat(notif): fold notif into features/notif on the S1 job seam`

   Body: Move the Notification Center tile, router, service, apns, and schema into
   features/notif; register the APNs fan-out as a defineJobs facet so the worker
   drains notify via jobs.gen.ts. Delete the registry entry, the base
   notifications router mount, and the hand-wired notify handler + barrel export.
   guestExposed: no.

---

## Gotchas (inherited into this unit)

- `features/* → apps/api/*` is Biome-banned. notif must reach the runtime only via
  `@www/core`, `@app-kit/server`, and `@/…` (apps/web). Confirm the dep rule stays
  green after the fold.
- `apps/api` + `apps/worker` MAY import `@features/*` (allowed direction). The
  worker importing `@features/_generated/jobs.gen` is fine — but the `@features`
  alias must exist in the worker's tsconfig + vite/build config. It is NOT there
  today. Add it (mirror how `apps/api` resolves `@features`, and how the root
  `vitest.config.ts` apps-gen project aliases `@features`). `bun build` reads the
  **CWD** tsconfig `paths` — the worker Docker build must resolve `@features` from
  `apps/worker`'s tsconfig; `cd apps/worker` before `bun build`
  (memory `bun-build-alias-needs-cwd-tsconfig`; local typecheck/vitest pass even
  when this is wrong — it fails CI-only).
- Atomic manifest + backend in ONE commit (commit 2) — codegen only collects a
  facet when `manifest.ts` exists; a half-moved feature breaks `apps:check`.
- knip is zero-tolerance and scans the working tree. The apps/api thin-adapter
  re-exports, the moved barrel exports, and any transitional shim must all be
  used or deleted — a dead re-export left after the move turns pre-push red.
- Parallel sessions push `main` (~8-10 concurrent). `git pull --rebase --autostash`
  every time; NEVER `git add -A` (memory `never-git-add-all-shared-checkout`);
  lefthook format re-stages the whole tree — stage explicit paths and
  `git show --stat HEAD` before push (memory `lefthook-format-restages-whole-tree`).
- No backticks in `git commit -m` (zsh command substitution).
- `CLAUDE.md` is a symlink to `AGENTS.md` — never `sed -i` it.
- Subagents die if they yield to a background CI monitor — the IMPLEMENTER must run
  `gh run watch --exit-status` in the FOREGROUND (memory
  `subagent-background-wait-stalls`).
- APNs stack (memory `apns-push-stack-gotchas`): the WORKER (not media-worker)
  drains notify jobs; Bun fetch can't do HTTP/2, so apns uses `node:http2` — keep
  that import in `features/notif/apns.ts`. AppDelegate token forwarding etc. is
  unaffected (shell side, unchanged).
- Codegen imports each feature's `jobs.ts` at collect time (jsdom under
  `apps-check`, bun under `apps:gen`). Keep `features/notif/jobs.ts` side-effect
  free (lazy db, env-gated apns) so importing it never opens a connection — same
  constraint guest-wifi/jobs.ts already satisfies.

## PLACEHOLDERs — ALL RESOLVED (baked into the plan above; nothing open)

All four earlier placeholders were closed by the plan-reviewer's spike + this
reconciliation. Kept here only as a resolution ledger — the implementer acts on the
baked-in sections, not on these.

- **PLACEHOLDER-1 — augmentation visibility → RESOLVED, ship registry augmentation.**
  Spiked against real `tsc`: `declare module "@www/core"` merges through core's
  `export *` barrel; typo-fail + payload typing both hold. The `never` collapse is
  real but closed per-program by the placement map in §D2 (B1 puts both interim
  augmentations in `apps/api/src/jobs/queue.ts`; M2 keeps youtube in the worker's
  import graph via `worker-deps`; M1 gives the moved test a local augmentation).
  **No `JobType = string` fallback.**
- **PLACEHOLDER-2 — drizzle surface for `job` → RESOLVED (B3).** `apps/api`
  schema.ts MUST identifier-re-export `job` from `@www/core`, verbatim like
  `integrationSyncStatus`; knip-safe by the same precedent; `db:generate` then
  emits no DROP. Mandated in §1a.
- **PLACEHOLDER-3 — `claimOne` signature → RESOLVED.** Use `claimOne(db, spec)`
  (§D4). The moved test's literals need a local augmentation regardless of
  signature (M1); update its call sites to the spec form.
- **PLACEHOLDER-4 — detail-wiring placement → RESOLVED (m1).** KEEP
  `apps/web/.../detail/wiring/notifications.tsx` in apps/web (matches guest-wifi /
  tv / sound); only repoint the view import. Baked into the file-moves table.
</content>
</invoke>
