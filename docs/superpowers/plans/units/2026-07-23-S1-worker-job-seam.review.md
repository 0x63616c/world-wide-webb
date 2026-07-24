# S1 Worker-Job Seam — Plan Review (independent)

**Reviewer:** independent plan-reviewer (did not author the plan).
**Verdict: APPROVE-WITH-FIXES.** The seam architecture is sound and the single
biggest risk — the `JobTypeRegistry` declaration-merge — was **spiked against real
`tsc` and holds**. Three BLOCKER-level gaps and two MAJOR gaps must be closed in
the plan before an implementer runs it; none require rearchitecting.

Counts: **3 BLOCKER, 3 MAJOR, 3 MINOR.**

---

## Augmentation-visibility SPIKE (TOP RISK) — result: **PASS, ship registry augmentation**

Mini 4-package mirror under `/tmp/s1spike` (`@www/core` = `index.ts` doing
`export *` from `queue.ts`, which declares `interface JobTypeRegistry {}` +
`type JobType = keyof JobTypeRegistry & string`; consumers augment via
`declare module "@www/core"`). `moduleResolution: bundler`, matching the repo.

- **Program WITH the augmenting file included** (`tsconfig.p1`, mirrors both the
  `features/**` program via `tsconfig.config.json` and the `apps/api` program):
  `tsc` **exit 0**. `enqueueJob(db, "notify", {notificationId})` typechecks, the
  `@ts-expect-error` on a typo'd `"notifyy"` is satisfied (compile-fail preserved),
  and the `@ts-expect-error` on a wrong payload shape is satisfied (**payload
  typing works**). So `declare module "@www/core"` **does merge into the interface
  re-exported through the `export *` barrel** — the fragile case people fear. It
  works here.
- **Program WITHOUT the augmenting file** (`tsconfig.p2`): `tsc` fails with
  `TS2345: Argument of type '"notify"' is not assignable to parameter of type
  'never'`. So the guarantee is **symmetric and sharp**: `JobType` is the
  registered set *only in programs that include the augmenting file*, and `never`
  everywhere else.

**Conclusion:** registry augmentation is the right mechanism (keeps typo-fail AND
adds payload typing). Do NOT fall back to `JobType = string`. But the `never`
collapse is not hypothetical — it is exactly what bites at every producer/consumer
site whose program omits the augmentation (findings B1, B2, M1, M2 below). The
plan must enumerate augmentation placement per-program, not just "add an apps/api
augmentation."

Program map (verified against real tsconfigs):
- `features/**` (typechecked by `tsconfig.config.json`, `include: features/**/*.ts`
  as a glob → `jobs.ts` is a root file regardless of imports): notif's producer
  `service.ts` and its augmenter `jobs.ts` are in the SAME program → notify visible. ✅
- `apps/api` (`tsc` from `apps/api`, follows imports): `media.ts` +
  `playlist-poller-service.ts` (youtube) AND, in commit 1 only,
  `notification-service.ts` (notify) are producers here. Both augmentations must
  live in a file in this program. ✅ once B1 is fixed.
- `apps/worker` (`tsc` from `apps/worker`): builds the `youtube_ingest` spec inline
  and spreads `GENERATED_JOBS`. Sees notify via `@features/_generated/jobs.gen →
  features/notif/jobs.ts`; sees youtube via the `@control-center/api/worker` barrel
  → must transitively reach the youtube augmenting file (finding M2). ✅ once M2 fixed.
- `packages/core`: defines the empty registry; generic code never names a concrete
  type, so `never` is fine — EXCEPT a moved `queue.test.ts` (finding M1).

---

## BLOCKERS

### B1 — Commit 1 does not typecheck: apps/api needs an interim `notify` augmentation too
`apps/api/src/services/notification-service.ts:213` still calls
`enqueueJob(NOTIFY_JOB_TYPE, { notificationId })` (`NOTIFY_JOB_TYPE = "notify"`,
`:36`) in commit 1 — notif does not move until commit 2. The plan's §1b only adds
the `youtube_ingest` interim augmentation. With the open registry and no `notify`
registered in the `apps/api` program, `JobType` there does NOT include `"notify"`
→ `:213` fails with the `never` error the spike reproduced. **Commit 1 is red as
written.**
**Fix:** commit 1's interim apps/api augmentation registers BOTH `notify` and
`youtube_ingest`. Commit 2 deletes the `notify` line from the apps/api augmentation
(it relocates to `features/notif/jobs.ts`) atomically with the service move. State
this explicitly in §1b and §Commit-2 wiring edits.

### B2 — Worker Docker bundle will fail CI-only: `bun build` must `cd apps/worker`
`apps/worker/Dockerfile:43` is `RUN bun build apps/worker/src/index.ts
--target=bun --outfile dist/worker.js` — built from `/app` (repo root), whose
`tsconfig.json` is deliberately `paths`-free. Commit 1 adds
`import { GENERATED_JOBS } from "@features/_generated/jobs.gen"` to the worker, so
this bundle step will fail to resolve `@features` at build time. Local
`typecheck`/`vitest` stay green (worker `tsconfig.json` already carries the
`@features/*` path), so this is a **CI-only failure** (memory
`bun-build-alias-needs-cwd-tsconfig`).
**Fix (commit 1):** change line 43 to mirror the fixed api Dockerfile
(`apps/api/Dockerfile:52`):
`RUN cd apps/worker && bun build src/index.ts --target=bun --outfile ../../dist/worker.js`.
The plan lists the gotcha generically but never names the file/line — make it an
explicit commit-1 edit.

### B3 — `job` table move needs a retained re-export in apps/api schema, or `db:generate` DROPs it
PLACEHOLDER-2 resolved: `apps/api/drizzle.config.ts` points drizzle-kit at
`features/_generated/schema.gen.ts`, whose only apps/api surface is
`export * from "../../apps/api/src/db/schema"`. Core tables reach drizzle-kit
**by being re-exported from `apps/api/src/db/schema.ts`** — `deviceState` and
`integrationSyncStatus` are re-exported as identifiers at `schema.ts:73-82`
precisely so "the drizzle relational schema still registers it." The plan's §1a
hedge ("a re-export **may be unnecessary**") is **wrong**: without
`export { job } from "@www/core";` in `apps/api/src/db/schema.ts`, `schema.gen.ts`
never surfaces `job` to drizzle-kit and `db:generate` emits a `DROP TABLE job`.
**Fix:** §1a must MANDATE the identifier re-export, mirroring
`integrationSyncStatus` verbatim. It is knip-safe by the same precedent
(`integrationSyncStatus`'s re-export survives knip today).

---

## MAJOR

### M1 — Moved/kept `queue.test.ts` passes concrete type literals that collapse to `never`
`apps/api/src/__tests__/queue.test.ts` calls `claimOne("notify", …)` and
`claimOne("youtube_ingest", …)` (12+ sites, `:168`–`:369`) and
`enqueueJob("my_job" as JobType, …)`. Under `claimOne(db, spec)` these become
`spec.type` values that must satisfy `JobType`. If the test **moves to
`packages/core`** (plan's commit-1 verify suggests relocating it), core's program
has NO augmentation → every `"notify"`/`"youtube_ingest"` literal is the `never`
error. Even **kept in apps/api**, `"notify"` breaks after commit 2 removes the
apps/api notify augmentation.
**Fix:** this is a mechanics unit test — give it a **test-local
`declare module "@www/core"` augmentation** (registering `notify`,
`youtube_ingest`, and a synthetic `my_job`) at the top of the test file, or keep
the `as JobType` casts on every literal. Resolves PLACEHOLDER-3: keeping the
3-arg `claimOne` is not the issue — the type literals are; whichever `claimOne`
signature you pick, the test needs its own augmentation. Recommend keeping the
test in `packages/core` WITH a local augmentation (cleanest home for the moved
primitive).

### M2 — youtube_ingest augmentation must sit in the worker's program
The worker builds `{ type: "youtube_ingest" as const, … }` and assigns it into
`JobSpec[]` (`JobSpec.type: JobType`). For `"youtube_ingest"` to be assignable in
the `apps/worker` program, the augmenting file must be transitively imported by
the worker. The worker reaches apps/api only via `@control-center/api/worker`
(`worker-deps.ts`). **Fix:** place the interim youtube augmentation in
`apps/api/src/jobs/queue.ts` (the bound adapter `worker-deps.ts` re-exports
through) — NOT in a standalone `jobs.types.ts` that nothing in the worker's import
graph pulls in. State this constraint in §1b. (Same latent trap for any future
worker-built spec.)

### M3 — Confirm the worker vitest project resolves `@features` for the seam-proof test
The new `apps/worker/src/__tests__/jobs-seam.test.ts` imports
`@features/_generated/jobs.gen` at RUNTIME (esbuild/vitest, not tsc). The plan
verifies the tsconfig path but not the vitest alias. `apps/worker` has no test dir
today; confirm the worker's vitest config (or the root `vitest.config.ts` project
that will own `apps/worker/**`) aliases `@features` → `features/*`, or the test
fails to resolve the generated barrel at import. Mirror how the `apps-gen` project
aliases it.

---

## MINOR

### m1 — PLACEHOLDER-4 resolved: keep notif detail-wiring in apps/web
Precedent is unambiguous: `guest-wifi.tsx`, `tv.tsx`, `sound.tsx`, etc. all remain
in `apps/web/src/components/tiles/detail/wiring/` after their fold, importing the
feature's view. So **keep `apps/web/.../detail/wiring/notifications.tsx` in place**;
just repoint its `ExpandedNotificationCenterView` import to wherever the view lands
(feature `web.tsx` or the shared views dir). Do NOT co-locate it in
`features/notif/web.tsx`.

### m2 — Seam-proof test is genuinely end-to-end (good — keep it that way)
The plan's worker-level test (§Prove step 2) imports `GENERATED_JOBS`, finds the
`notify` spec, and **invokes `handler(payload, signal)` with a mocked feature db +
mocked `sendApnsPush`**, asserting the notify path ran. That is a real invocation
proof, not a collection assertion — no change needed, but the review flags it as a
hard requirement (do not let an implementer downgrade it to `expect(spec).toBeDefined()`).

### m3 — notif tile facts verified
`tile-registry.ts:186-190`: `worldCol: 38, worldRow: 24, cols: 4, rows: 3` — matches
§D6 verbatim. `GUEST_EXPOSED = ["tile_guestwifi"]` only, so **`guestExposed: no`
is correct** and notif must NOT be added to `features/guest-exposed.ts`. Base mount
to remove: `apps/api/src/trpc/routers/index.ts:11` (`import`) + `:25`
(`notifications: notificationsRouter`) — router key stays `notifications`. All ✅.

---

## Confirmed-sound (no action)
- **No import cycle.** `@www/core` has no db singleton; `enqueueJob`/`claimOne`
  take an injected `db` (mirrors `createPgDeviceStateStore(db)`). `app-kit → @www/core`
  is ALLOWED — `biome.json:187-205` bans only `@control-center/api` and `@features`
  from app-kit, not `@www/core`; and `packages/core`'s rule (`:219+`) bans core
  importing app-kit/features (the other direction). Direction stays features/apps → core.
- **Generic worker fold** is genuinely per-feature-wiring-free: `...GENERATED_JOBS`
  + the youtube interim; `...JOBS.map(jobWorker)` unchanged. The worker `tsconfig`
  already has the `@features/*` path (only the Dockerfile bundle lacks it → B2).
- **Two-commit split is drain-safe.** In commit 1 notify still enqueues from apps/api
  and drains via the hand-wired worker line (`GENERATED_JOBS` empty); commit 2 moves
  enqueue+handler+augmentation atomically and the worker picks notify up via the
  barrel. No window where `notify` stops draining. (Commit 1 still needs B1 to compile.)
- `youtube_ingest` / playlist-poller stay hand-wired in apps/api via the bound
  adapter — callers at `media.ts:243` and `playlist-poller-service.ts:143` keep
  their `enqueueJob("youtube_ingest", …)` signature unchanged once the adapter
  binds apps/api's db.

## Status
**needs-fix** (not rework): close B1–B3 + M1–M2 in the plan text, fold in the
resolved placeholders, then it is ready to implement.
