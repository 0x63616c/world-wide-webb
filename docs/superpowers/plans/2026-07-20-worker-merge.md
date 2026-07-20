# Worker Merge + YouTube Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `media-worker` into `worker` as a single deployable, model job types as plain `Worker`s, and get YouTube archival actually running against a real playlist.

**Architecture:** The existing `Worker` contract (named interval loop, await-before-reschedule, per-cycle try/catch) already provides per-type concurrency 1, type isolation, and failure isolation. So a job type becomes a `Worker` whose cycle drains that one type — no dispatcher, no lanes, no concurrency budget. Queue concerns (payload, attempts, backoff, timeout) live in `claimOne`. A stale-job reaper covers process death, which an in-process timeout cannot.

**Tech Stack:** Bun, TypeScript, drizzle-orm + Postgres, vitest, Pulumi + k3s, yt-dlp + ffmpeg on Alpine.

**Spec:** `docs/superpowers/specs/2026-07-20-worker-merge-design.md`

## Ordering

Every task in this plan leaves the workspace fully green: `bun run typecheck`, `bun run test`, `bun run lint`, and `bun run knip` all pass at every commit, and every commit is pushed immediately. This is a deliberate reordering of an earlier draft that left Tasks 1–4 typecheck-broken mid-sequence.

The reordering follows one rule: **merge first against the existing queue, then swap the queue underneath.** Task 1 moves the two apps into one while `claimAndRun` / `registerHandler` are still in place; Task 2 replaces the queue mechanism and rewires the entrypoint in a single atomic commit.

**Go-live gate.** 93 `youtube_ingest` jobs have sat at `queued` since 2026-06-08, never claimed because `media-worker` is parked. Once the merge lands, `worker` has the NFS mount and a live handler, so those jobs would start downloading ~126 GB with the pre-rewrite ingest path (separate audio file, OpenRouter enrichment, bare-videoId filenames). Task 1 therefore parks the backlog on `job.run_after` — the column that already exists for exactly this — and Task 6 unparks it after the ingest rewrite and the schema migration have shipped. This keeps the code honest (no dead flag, no unused export) and the switch reversible.

## Global Constraints

- Backend code uses structured logging (`getLogger()` / `createLogger`), never `console.*`.
- No fake or placeholder data.
- IDs default to `prefix_<id>`.
- Never re-encode video. The AV1 format selector and `-N` are the only yt-dlp perf levers.
- **Every task must leave the full workspace green.** Before committing: `bun run typecheck && bun run test && bun run lint && bun run knip`.
- Commit and push after every task. Push to `main` deploys to prod; do not batch.
- Do not use PRs. Work directly on `main`.
- Run `bunx biome format --write` on generated drizzle migration meta before committing.
- **The per-task "Files:" lists are indicative, not exhaustive.** Task 1 named 8 files and touched 46; the unnamed ones (CI matrix and path filters, the `scripts/check-*.ts` service-list guards, `product.json`, `vitest.config.ts`, `knip.jsonc`, Pulumi config, Dockerfile COPY lines) were load-bearing. Grep for what you are changing rather than trusting the list, and note that a `*.json` grep misses `knip.jsonc`.
- **This checkout is shared with 8-10 concurrent sessions** that have uncommitted work in the same tree. Stage explicit paths — never `git add -A`, `git add .`, or `git commit -a`.
- `products/control-center/api` gains a dependency on `@www/worker-runtime` in Task 2. It is a leaf package; this edge is intentional.

## File Structure

| File | Responsibility |
|---|---|
| `products/control-center/api/src/jobs/queue.ts` | Modify: `claimOne` replaces `claimAndRun`; `JobHandler` gains an `AbortSignal`; handler registry deleted |
| `products/control-center/api/src/jobs/job-worker.ts` | Create: `JobSpec`, `jobWorker`, `staleJobReaper` — the bridge between the queue and the `Worker` contract |
| `products/control-center/api/src/services/youtube-ingest-service.ts` | Modify: video-only download, `-N 4`, archival filename, enrichment deleted |
| `products/control-center/api/src/services/notification-service.ts` | Modify: export the handler function instead of registering it |
| `products/control-center/api/src/db/schema.ts` | Modify: drop 12 columns |
| `products/control-center/api/src/worker-deps.ts` | Modify: single barrel for the merged worker; `media.ts` deleted |
| `products/control-center/worker/src/index.ts` | Modify: absorbs poller, disk guard, both job workers, reaper |
| `products/control-center/worker/src/disk-guard.ts` | Create: moved out of the media-worker entrypoint so it is testable without booting the app |
| `products/control-center/worker/Dockerfile` | Modify: add ffmpeg + yt-dlp to the runtime stage |
| `packages/worker-runtime/src/runtime.ts` + `types.ts` | Modify: delete `stats()`, `statsEveryNRuns`, `WorkerStats.memory` |
| `infra/src/services.ts`, `secrets-map.ts`, `packages/platform/src/index.ts` | Modify: delete the media-worker workload and secret usage |

---

### Task 1: Merge the apps into one deployable

The structural merge, done while the existing queue mechanism is untouched so the workspace stays green. `worker` absorbs the playlist poller, the disk guard, the media NFS mount, and the `youtube_ingest` handler registration; `media-worker` is deleted along with its workload, its secrets entries, and its CI image. Handlers are still registered through `registerHandler`, and the queue is still drained by `claimAndRun` — Task 2 replaces both.

The disk guard moves into its own module so it stays testable without booting the app.

**Files:**
- Create: `products/control-center/worker/src/disk-guard.ts`
- Create: `products/control-center/worker/src/disk-guard.test.ts` (port from `media-worker/src/disk-guard.test.ts`)
- Modify: `products/control-center/worker/src/index.ts`
- Modify: `products/control-center/worker/Dockerfile`
- Modify: `products/control-center/api/src/worker-deps.ts`
- Modify: `infra/src/services.ts` (media-worker workload ~:261-289, worker ~:247-259, `mediaWorkerReplicas` at :200, :212, :491, :593, :667)
- Modify: `infra/src/secrets-map.ts:34,68`
- Modify: `packages/platform/src/index.ts:279,448-465,640,734-740`
- Delete: `products/control-center/media-worker/`, `products/control-center/api/src/media.ts`
- Test: `infra/src/__tests__/services.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function hasSufficientDisk(dir: string, thresholdBytes?: number): boolean`; a single `worker` workload with `resources: { memory: "512M" }`, the media NFS volume, and `MEDIA_STORAGE_DIR`.

- [ ] **Step 1: Park the existing backlog BEFORE anything deploys**

Run this first, against prod, and confirm the row count it reports:

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "UPDATE job SET run_after = '2099-01-01', updated_at = now()
   WHERE type = 'youtube_ingest' AND status = 'queued';"
```

Expected: `UPDATE 93`.

This is the go-live gate. The claim query filters `run_after <= now()`, so the backlog becomes unclaimable without losing its June provenance, its payloads, or its `attempts` history. Task 6 reverses it with a single `run_after = now()` update once the ingest rewrite and the schema migration have shipped.

Without this step the merge deploys a live `youtube_ingest` handler against 93 queued jobs, and prod immediately downloads ~126 GB using the pre-rewrite ingest path.

Verify it took:

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT status, count(*), min(run_after), max(run_after) FROM job WHERE type='youtube_ingest' GROUP BY status;"
```

- [ ] **Step 2: Port the disk guard with the new threshold**

Create `products/control-center/worker/src/disk-guard.ts`:

```ts
/**
 * Free-space guard for the NAS media volume. Checked before claiming an ingest
 * so a full volume cannot be filled further by a new download.
 *
 * The floor is well above one file's size because the check runs BEFORE the
 * download and yt-dlp cannot say in advance how large the result will be: a
 * single 90-minute AV1 set is plausibly 3-8 GB, so a 10 GB floor could be
 * consumed by one job.
 */
import { statfsSync } from "node:fs";
import { getLogger } from "@www/logger";

const DISK_FREE_THRESHOLD_BYTES = 50 * 1024 * 1024 * 1024; // 50 GB

export function hasSufficientDisk(
  dir: string,
  thresholdBytes: number = DISK_FREE_THRESHOLD_BYTES,
): boolean {
  try {
    const stats = statfsSync(dir);
    // bavail = blocks available to non-root; bsize = block size in bytes.
    const freeBytes = stats.bavail * stats.bsize;
    if (freeBytes < thresholdBytes) {
      getLogger().warn({ freeBytes, thresholdBytes, dir }, "disk below threshold, skipping claim");
      return false;
    }
    return true;
  } catch (err) {
    // statfs failed (dir missing, NFS not mounted yet). Allow, and let the
    // download fail with a clearer error than a startup crash.
    getLogger().warn({ err, dir }, "statfs failed, assuming sufficient");
    return true;
  }
}
```

Port `media-worker/src/disk-guard.test.ts` to `worker/src/disk-guard.test.ts`, updating the threshold expectation from 10 GB to 50 GB and passing `dir` explicitly (it is no longer defaulted from `env`).

Run: `cd products/control-center/worker && bunx vitest run src/disk-guard.test.ts`
Expected: PASS.

- [ ] **Step 3: Collapse the barrels**

`products/control-center/api/src/worker-deps.ts` must now export everything the merged worker needs. Read `products/control-center/api/src/media.ts` first and fold its exports in — the merged app has one barrel, not two.

Update the file's header comment: it currently explains that media-worker owns the queue and worker drains only `notify`. That is no longer true — say the worker app owns every loop and job type.

Delete `products/control-center/api/src/media.ts` and its `"./media"` entry from `package.json` `exports`.

- [ ] **Step 4: Absorb media-worker's loops into the worker entrypoint**

In `products/control-center/worker/src/index.ts`:

- Import `registerYoutubeIngestHandler` (still the registration API at this task) and call it alongside `registerNotifyHandler()`.
- Delete the type filter on the `notify-queue` worker that stopped it stealing media jobs — one process now drains every type. Update the comment that explains media-worker being parked; it is no longer true.
- Add `import { hasSufficientDisk } from "./disk-guard";` and apply the guard at the same point media-worker applied it, passing `env.MEDIA_STORAGE_DIR` explicitly.
- Append the playlist poller to the `workers` array, after `asc-version-poll`:

```ts
  {
    // Playlist poller: enumerate each enabled media_source via
    // yt-dlp --flat-playlist and enqueue ingest jobs for unseen video IDs.
    // Metadata only -- no video data -- so 2 minutes is ~720 requests/day from
    // one IP, well inside anything YouTube pushes back on. Going lower buys
    // little: the download itself dominates end-to-end latency.
    name: "playlist-poller",
    intervalMs: 2 * 60_000,
    runOnStart: true,
    run: runPlaylistPollerCycle,
  },
```

- [ ] **Step 5: Add ffmpeg and yt-dlp to the worker image**

In `products/control-center/worker/Dockerfile`, in the **runtime** stage before the `COPY --from=build` line:

```dockerfile
# yt-dlp needs ffmpeg to mux the separate DASH video+audio streams YouTube
# serves above 360p. python3 + pip because yt-dlp is a Python CLI;
# --break-system-packages is required on Alpine's managed Python (PEP 668).
RUN apk add --no-cache ffmpeg python3 py3-pip \
 && pip3 install --break-system-packages yt-dlp \
 && yt-dlp --version \
 && ffmpeg -version | head -1
```

- [ ] **Step 6: Update the infra tests first**

Find the test asserting the declared workload set and remove `media-worker` from it; add assertions that `worker` has the NFS volume and `512M`.

Run: `bunx vitest run --dir infra`
Expected: FAIL on the new assertions.

- [ ] **Step 7: Move the volume onto worker and delete the media-worker workload**

In `infra/src/services.ts`, change the `worker` workload's `resources` to `{ memory: "512M" }`, and add to it (copying verbatim from the media-worker block being deleted):

```ts
      env: {
        ...haEnv,
        // Point at the NFS mount below -- the env default (/mnt/media) is the
        // container overlay fs, not the NAS share.
        MEDIA_STORAGE_DIR: "/app/media",
      },
      // NFS PV for the Synology media share. The DS420+ exports ONLY
      // /volume1/Homelab (not its subdirs), so mount that export and subPath
      // into media/. nfsvers=3 is enforced by the render layer (DS420+ is v3-only).
      volumes: [
        {
          mountPath: "/app/media",
          nfs: { server: nasNfsServer, path: "/volume1/Homelab" },
          subPath: "media",
        },
      ],
```

Delete the entire `media-worker` workload object, the `mediaWorkerReplicas` field from both interfaces (:200, :491), and every reference at :212, :593, :667. Update the Boundary-6 comment at :7-9, which describes media-worker being parked.

- [ ] **Step 8: Remove media-worker from the platform manifest**

In `packages/platform/src/index.ts`: remove `"media-worker"` from both union types (:279, :640), the `defineServiceSecretUsage` block (:458-465), and the workload entry (:734-740). Fix the comment at :448 that explains worker running notify because media-worker is parked.

Leave `OPENROUTER_API_KEY` on the `worker` secret usage — the enrichment code still exists until Task 3, and removing the secret first would break the running app.

In `infra/src/secrets-map.ts`: remove the `"media-worker"` entries at :34 and :68.

- [ ] **Step 9: Delete media-worker and its CI image**

```bash
git rm -r products/control-center/media-worker
bun install
grep -rn "media-worker" .github/ infra/ packages/ products/ --include="*.yml" --include="*.yaml" --include="*.ts" --include="*.json" | grep -v node_modules
```

Remove every remaining hit. Expected locations: the CI build matrix and any per-product path filter. The grep must return nothing before you commit — a CI matrix entry for a deleted directory fails the build.

- [ ] **Step 10: Verify the whole workspace**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass. `knip` is the check that catches anything the deleted app left orphaned — fix whatever it reports rather than suppressing it.

- [ ] **Step 11: Commit, push, and watch the deploy**

```bash
git add -A
git commit -m "feat(control-center): merge media-worker into worker

One deployable instead of two. worker takes over the playlist poller,
the disk guard, the media NFS volume and MEDIA_STORAGE_DIR at 512M --
downloads stream to disk, so the limit covers the Bun process and a
yt-dlp subprocess, not the file.

media-worker had never run a job in prod: it was parked at 0 replicas as
a migration checkpoint, then left parked on the belief that yt-dlp needs
significant memory. It streams to disk through a 1KB buffer, so memory
is flat with respect to file size."
git push origin main
```

After CI completes, confirm the pod picked up the new image and that yt-dlp is present:

```bash
kubectl -n control-center get pods -l app=worker
kubectl -n control-center exec deploy/worker -- yt-dlp --version
kubectl -n control-center exec deploy/worker -- df -h /app/media
```

Expected: a running pod, a yt-dlp version string, and the NAS share mounted. If the pod is `CrashLoopBackOff`, check `kubectl -n control-center logs deploy/worker` — the most likely cause is the NFS mount failing, not the app.

Confirm nothing is downloading: `kubectl -n control-center logs deploy/worker | grep -i yt-dlp` should be empty, because Step 1 parked the backlog.

---

### Task 2: Swap the queue — `claimOne`, `jobWorker`, the reaper, and explicit handlers

The mechanism swap, done atomically so the workspace never breaks. `claimAndRun` and the module-global handler registry are replaced by a single-type claim under a timeout, a `Worker` per job type, and a stale-job reaper; handlers become plain exported functions passed at the entrypoint.

`registerHandler()` mutates a module-global `Map` and must be called before `runtime.start()` or jobs silently never run. That ordering constraint is invisible and load-bearing. After this task the entire behaviour of the process is one literal in `worker/src/index.ts`.

**Files:**
- Modify: `products/control-center/api/src/jobs/queue.ts`
- Create: `products/control-center/api/src/jobs/job-worker.ts`
- Create: `products/control-center/api/src/__tests__/job-worker.test.ts`
- Modify: `products/control-center/api/src/__tests__/queue.test.ts`
- Modify: `products/control-center/api/src/services/notification-service.ts:370-372`
- Modify: `products/control-center/api/src/services/youtube-ingest-service.ts`
- Modify: `products/control-center/api/src/worker-deps.ts`
- Modify: `products/control-center/api/package.json`
- Modify: `products/control-center/worker/src/index.ts`

**Interfaces:**
- Consumes: `hasSufficientDisk` (Task 1).
- Produces:
  - `export type JobHandler<T = unknown> = (payload: T, signal: AbortSignal) => Promise<void>`
  - `export async function claimOne(type: string, handler: JobHandler, maxMs: number): Promise<boolean>` — returns `true` if a job was claimed and processed, `false` if none was available.
  - `export interface JobSpec { type: string; handler: JobHandler; maxMs: number }`
  - `export function jobWorker(spec: JobSpec): Worker`
  - `export function staleJobReaper(specs: readonly JobSpec[]): Worker`
  - `export async function reapStaleJobs(specs: readonly JobSpec[]): Promise<number>` — returns rows requeued.
  - `export const runNotifyJob: JobHandler`, `export const runYoutubeIngest: JobHandler`
  - `enqueueJob` unchanged.

- [ ] **Step 1: Read the existing test file and add the worker-runtime dependency**

Run: `sed -n '1,60p' products/control-center/api/src/__tests__/queue.test.ts`

Note how it seeds rows and whether it uses a real DB or mocks `db`. Match that style exactly in the new tests — do not introduce a second harness.

In `products/control-center/api/package.json`, add to `dependencies`:

```json
"@www/worker-runtime": "workspace:*",
```

Run: `bun install`

- [ ] **Step 2: Write the failing tests**

Add to `products/control-center/api/src/__tests__/queue.test.ts`:

```ts
describe("claimOne", () => {
  it("returns false when no job of that type is queued", async () => {
    await enqueueJob("other_type", { a: 1 });
    const ran = await claimOne("notify", async () => {}, 1000);
    expect(ran).toBe(false);
  });

  it("claims only its own type and marks it done", async () => {
    const id = await enqueueJob("notify", { a: 1 });
    const seen: unknown[] = [];
    const ran = await claimOne("notify", async (p) => { seen.push(p); }, 1000);
    expect(ran).toBe(true);
    expect(seen).toEqual([{ a: 1 }]);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("done");
  });

  it("requeues with backoff when the handler throws", async () => {
    const id = await enqueueJob("notify", { a: 1 });
    await claimOne("notify", async () => { throw new Error("boom"); }, 1000);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("queued");
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("boom");
    expect(row!.runAfter.getTime()).toBeGreaterThan(Date.now());
  });

  it("permanently fails once attempts reach maxAttempts", async () => {
    const id = await enqueueJob("notify", { a: 1 }, { maxAttempts: 1 });
    await claimOne("notify", async () => { throw new Error("boom"); }, 1000);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("failed");
  });

  it("fails the job when the handler exceeds maxMs", async () => {
    const id = await enqueueJob("notify", { a: 1 }, { maxAttempts: 1 });
    await claimOne("notify", () => new Promise((r) => setTimeout(r, 5_000)), 50);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toContain("timed out");
  });

  it("aborts the signal it passes to the handler on timeout", async () => {
    await enqueueJob("notify", { a: 1 }, { maxAttempts: 1 });
    let aborted = false;
    await claimOne(
      "notify",
      (_p, signal) =>
        new Promise((resolve) => {
          signal.addEventListener("abort", () => { aborted = true; resolve(); });
          setTimeout(resolve, 5_000);
        }),
      50,
    );
    expect(aborted).toBe(true);
  });

  it("does not claim a job whose run_after is in the future", async () => {
    const id = await enqueueJob("notify", { a: 1 });
    await db.execute(sql`UPDATE job SET run_after = now() + interval '1 day' WHERE id = ${id}`);
    const ran = await claimOne("notify", async () => {}, 1000);
    expect(ran).toBe(false);
  });
});
```

The last test is not incidental: Task 1 parks the `youtube_ingest` backlog on `run_after`, and Task 6 unparks it. That gate must be covered.

Create `products/control-center/api/src/__tests__/job-worker.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { jobWorker, reapStaleJobs, staleJobReaper } from "../jobs/job-worker";
import { enqueueJob } from "../jobs/queue";
import { db } from "../db/index";
import { job } from "../db/schema";
import { eq, sql } from "drizzle-orm";

const noop = async () => {};

describe("jobWorker", () => {
  it("names the worker after its job type", () => {
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    expect(w.name).toBe("job:notify");
  });

  it("polls every 2s and runs on start", () => {
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    expect(w.intervalMs).toBe(2000);
    expect(w.runOnStart).toBe(true);
  });

  it("drains a job of its own type when its cycle runs", async () => {
    const id = await enqueueJob("notify", { a: 1 });
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    await w.run();
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("done");
  });

  it("leaves other types untouched", async () => {
    const id = await enqueueJob("youtube_ingest", { a: 1 });
    const w = jobWorker({ type: "notify", handler: noop, maxMs: 1000 });
    await w.run();
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("queued");
  });
});

describe("reapStaleJobs", () => {
  const specs = [{ type: "youtube_ingest", handler: noop, maxMs: 60_000 }];

  it("requeues a running job whose lease has expired", async () => {
    const id = await enqueueJob("youtube_ingest", { a: 1 });
    await db.execute(
      sql`UPDATE job SET status='running', locked_at = now() - interval '2 hours' WHERE id = ${id}`,
    );
    const reaped = await reapStaleJobs(specs);
    expect(reaped).toBe(1);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("queued");
  });

  it("leaves a running job inside its lease alone", async () => {
    const id = await enqueueJob("youtube_ingest", { a: 1 });
    await db.execute(
      sql`UPDATE job SET status='running', locked_at = now() WHERE id = ${id}`,
    );
    const reaped = await reapStaleJobs(specs);
    expect(reaped).toBe(0);
    const [row] = await db.select().from(job).where(eq(job.id, id));
    expect(row?.status).toBe("running");
  });

  it("ignores types it has no spec for", async () => {
    const id = await enqueueJob("unknown_type", { a: 1 });
    await db.execute(
      sql`UPDATE job SET status='running', locked_at = now() - interval '99 hours' WHERE id = ${id}`,
    );
    const reaped = await reapStaleJobs(specs);
    expect(reaped).toBe(0);
  });
});

describe("staleJobReaper", () => {
  it("is a 5 minute worker", () => {
    const w = staleJobReaper([{ type: "notify", handler: noop, maxMs: 1000 }]);
    expect(w.name).toBe("stale-job-reaper");
    expect(w.intervalMs).toBe(5 * 60_000);
  });
});
```

Run both suites and confirm they fail:
`cd products/control-center/api && bunx vitest run src/__tests__/queue.test.ts src/__tests__/job-worker.test.ts`
Expected: FAIL — `claimOne` not exported, `../jobs/job-worker` unresolvable.

- [ ] **Step 3: Implement `claimOne`**

In `products/control-center/api/src/jobs/queue.ts`:

- Change the handler type:

```ts
// Handler signature: receives the JSON payload plus an AbortSignal that fires
// when the job exceeds its type's maxMs. Handlers that spawn subprocesses MUST
// forward the signal (execFile accepts one) or the subprocess outlives the job.
export type JobHandler<T = unknown> = (payload: T, signal: AbortSignal) => Promise<void>;
```

- Delete `const handlers = new Map<string, JobHandler>()`, `registerHandler`, and `_clearHandlersForTest`.
- Delete `claimAndRun` entirely, including its "no handler registered → permanently fail" branch (unreachable now that each worker polls only its own type, and it is the burn-the-retries behaviour the design rejects).
- Keep `enqueueJob` and `backoffSec` unchanged.
- Add:

```ts
/**
 * Claim ONE queued job of a single type and run it under a timeout.
 *
 * Single-type by design: each job type is drained by its own worker, so a slow
 * type cannot delay another and an unregistered type is simply never claimed
 * (its rows park in `queued` rather than burning retries against a missing
 * handler).
 *
 * The timeout is enforced twice on purpose. The AbortSignal lets the handler
 * cancel real work (killing a yt-dlp subprocess); the Promise.race guarantees
 * the row is marked failed even if a handler ignores the signal. Without the
 * race a hung handler would hold the row at `running` until the reaper swept it.
 *
 * Returns true if a job was claimed and processed, false if none was available.
 */
export async function claimOne(
  type: string,
  handler: JobHandler,
  maxMs: number,
): Promise<boolean> {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`
        SELECT id, type, payload, attempts, max_attempts
        FROM job
        WHERE status = 'queued'
          AND run_after <= now()
          AND type = ${type}
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
    );
    const row = rows.rows[0] as
      | { id: number; type: string; payload: unknown; attempts: number; max_attempts: number }
      | undefined;
    if (!row) return null;

    await tx.execute(
      sql`
        UPDATE job
        SET status = 'running',
            attempts = attempts + 1,
            locked_at = now(),
            updated_at = now()
        WHERE id = ${row.id}
      `,
    );
    return row;
  });

  if (!claimed) return false;

  getLogger().info(
    { jobId: claimed.id, type: claimed.type, attempts: claimed.attempts },
    "job claimed",
  );

  const controller = new AbortController();
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await Promise.race([
      handler(claimed.payload, controller.signal),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`job timed out after ${maxMs}ms`));
        }, maxMs);
      }),
    ]);
    const durationMs = +(performance.now() - startedAt).toFixed(1);
    getLogger().info({ jobId: claimed.id, type: claimed.type, durationMs }, "job completed");
    await db.execute(
      sql`
        UPDATE job
        SET status = 'done', last_error = null, updated_at = now()
        WHERE id = ${claimed.id}
      `,
    );
  } catch (err) {
    controller.abort();
    const msg = err instanceof Error ? err.message : String(err);
    const nextAttempts = claimed.attempts + 1;
    if (nextAttempts < claimed.max_attempts) {
      const delaySec = backoffSec(nextAttempts);
      getLogger().warn(
        { jobId: claimed.id, type: claimed.type, attempt: nextAttempts, delaySec, err },
        "job retry scheduled",
      );
      await db.execute(
        sql`
          UPDATE job
          SET status = 'queued',
              last_error = ${msg},
              run_after = now() + make_interval(secs => ${delaySec}),
              updated_at = now()
          WHERE id = ${claimed.id}
        `,
      );
    } else {
      getLogger().error(
        { jobId: claimed.id, type: claimed.type, attempts: nextAttempts, err },
        "job permanently failed",
      );
      await db.execute(
        sql`
          UPDATE job
          SET status = 'failed', last_error = ${msg}, updated_at = now()
          WHERE id = ${claimed.id}
        `,
      );
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return true;
}
```

- [ ] **Step 4: Implement `jobWorker` and the reaper**

Create `products/control-center/api/src/jobs/job-worker.ts`:

```ts
/**
 * Bridge between the durable job queue and the Worker contract.
 *
 * A job type does not need its own dispatch machinery: the worker runtime
 * already guarantees a cycle never overlaps itself (per-type concurrency 1),
 * that each worker owns an independent timer chain (a 1h download cannot delay
 * `notify`), and that a throwing cycle never kills a sibling. So a job type is
 * simply a Worker whose cycle drains that one type.
 *
 * Both the per-job timeout and the reaper's lease derive from the same JobSpec,
 * so there is one declared number per type rather than two constants to drift.
 */
import type { Worker } from "@www/worker-runtime";
import { getLogger } from "@www/logger";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { claimOne, type JobHandler } from "./queue";

/** One job type: what runs it, and how long it may take. */
export interface JobSpec {
  type: string;
  handler: JobHandler;
  maxMs: number;
}

/** How often each job type polls for work. */
const JOB_POLL_INTERVAL_MS = 2_000;

/** How often the reaper sweeps for stranded rows. */
const REAP_INTERVAL_MS = 5 * 60_000;

/**
 * Grace added to each type's maxMs before the reaper considers a row stranded.
 * Absorbs clock skew and the window between a handler's own timeout firing and
 * the row being updated, so the reaper never races a job about to fail itself.
 */
const REAP_GRACE_MS = 5 * 60_000;

/** Wrap a job type as a Worker that drains it, one job per cycle. */
export function jobWorker(spec: JobSpec): Worker {
  return {
    name: `job:${spec.type}`,
    intervalMs: JOB_POLL_INTERVAL_MS,
    runOnStart: true,
    run: async () => {
      await claimOne(spec.type, spec.handler, spec.maxMs);
    },
  };
}

/**
 * Requeue jobs stranded at `running`. A timeout only fires while the process is
 * alive, so an OOM kill or pod eviction leaves the row at `running` forever --
 * invisible to every future claim, because the claim query only selects
 * `queued`. This is the only mechanism that recovers those.
 *
 * yt-dlp resumes from its .part file when re-run against the same output path,
 * so a requeued download continues rather than starting over.
 *
 * Returns the number of rows requeued.
 */
export async function reapStaleJobs(specs: readonly JobSpec[]): Promise<number> {
  let reaped = 0;
  for (const spec of specs) {
    const leaseMs = spec.maxMs + REAP_GRACE_MS;
    const result = await db.execute(
      sql`
        UPDATE job
        SET status = 'queued', updated_at = now()
        WHERE status = 'running'
          AND type = ${spec.type}
          AND locked_at < now() - make_interval(secs => ${Math.ceil(leaseMs / 1000)})
      `,
    );
    const count = result.rowCount ?? 0;
    if (count > 0) {
      getLogger().warn({ type: spec.type, count, leaseMs }, "requeued stranded jobs");
      reaped += count;
    }
  }
  return reaped;
}

/** The reaper as a Worker, built from the same specs used to build job workers. */
export function staleJobReaper(specs: readonly JobSpec[]): Worker {
  return {
    name: "stale-job-reaper",
    intervalMs: REAP_INTERVAL_MS,
    runOnStart: true,
    run: async () => {
      await reapStaleJobs(specs);
    },
  };
}
```

- [ ] **Step 5: Convert both handlers to plain exported functions**

In `products/control-center/api/src/services/notification-service.ts`, replace `registerNotifyHandler`:

```ts
/** The `notify` job handler. Wired at the worker entrypoint. */
export const runNotifyJob: JobHandler = async (payload) => {
  await handleNotifyJob(payload);
};
```

Add `import type { JobHandler } from "../jobs/queue";` and delete the `registerHandler` import.

In `products/control-center/api/src/services/youtube-ingest-service.ts`, replace `registerYoutubeIngestHandler` with:

```ts
/** The youtube_ingest job handler. Wired at the worker entrypoint. */
export const runYoutubeIngest: JobHandler = async (rawPayload, signal) => {
  await handleYoutubeIngest(rawPayload, signal);
};
```

Change `handleYoutubeIngest`'s signature to `(rawPayload: unknown, signal: AbortSignal)` and thread `signal` into the `execFileAsync` calls it makes (`{ signal }` as the options argument). Delete the `import { registerHandler }` line.

- [ ] **Step 6: Update the barrel and rewire the entrypoint**

In `products/control-center/api/src/worker-deps.ts`, delete the `claimAndRun` and `registerHandler`-era exports and export:

```ts
export { job, mediaItem, mediaSource } from "./db/schema";
export { jobWorker, staleJobReaper, type JobSpec } from "./jobs/job-worker";
export { enqueueJob } from "./jobs/queue";
export { runNotifyJob } from "./services/notification-service";
export { runPlaylistPollerCycle } from "./services/playlist-poller-service";
export { runYoutubeIngest } from "./services/youtube-ingest-service";
```

In `products/control-center/worker/src/index.ts`:

- Delete the `registerNotifyHandler()` / `registerYoutubeIngestHandler()` calls and the `queue-worker` worker object (named `notify-queue` before Task 1 renamed it).
- **Move the disk guard off the shared cycle.** Task 1 left `hasSufficientDisk` gating the whole `queue-worker` cycle, which — now that one loop drains every type — means a NAS below the 50 GB floor silently stops APNs `notify` delivery too. Putting the guard inside the `youtube_ingest` handler below is what fixes that; do not leave a copy at the cycle level. Remove the comment Task 1 added there naming the tradeoff.
- Delete the stale comment at `products/control-center/api/src/jobs/queue.ts:95` claiming media-worker omits the type filter. Task 1 deliberately left it because this task rewrites the file.
- Before the `workers` array:

```ts
// One declared maxMs per job type, driving BOTH the in-process timeout and the
// reaper's lease. A timeout only fires while this process is alive, so an OOM
// kill or eviction still strands a row at `running`; the reaper is what
// recovers those. Sharing one number keeps the two from drifting apart.
const JOBS: JobSpec[] = [
  // APNs delivery is sub-second; a minute means something is badly wrong.
  { type: "notify", handler: runNotifyJob, maxMs: 60_000 },
  // A ceiling for pathological downloads, not a target -- sets take minutes.
  {
    type: "youtube_ingest",
    maxMs: 60 * 60_000,
    // Guard the NAS before each claim: a full volume must not start a download.
    handler: async (payload, signal) => {
      if (!hasSufficientDisk(env.MEDIA_STORAGE_DIR)) {
        throw new Error("insufficient disk space for ingest");
      }
      await runYoutubeIngest(payload, signal);
    },
  },
];
```

- Append to the `workers` array, after `playlist-poller`:

```ts
  ...JOBS.map(jobWorker),
  staleJobReaper(JOBS),
```

- [ ] **Step 7: Verify and commit**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass.

```bash
git add -A
git commit -m "feat(control-center): job types are workers, not registry entries

claimOne claims one row of one type under a per-type timeout that both
aborts the handler's subprocess and races its promise, so a hung handler
still marks the row failed. A stale-job reaper covers the failure a
timeout structurally cannot: the process itself dying.

Handlers become plain exported functions passed at the entrypoint,
replacing a module-global Map whose population had to precede
runtime.start() or jobs silently never ran."
git push origin main
```

---

### Task 3: Video-only ingest, archival filenames, no enrichment

Three deletions and two additions in one task because they touch the same function and share one test cycle: drop the separate audio download, drop LLM enrichment, add `-N 4`, and switch to a filename a human can browse in VLC.

The old code located files by globbing `storageDir` for `videoId.*`. That breaks once the output template includes a subdirectory, so the download now asks yt-dlp for the exact path it wrote via `--print after_move:filepath`.

**Files:**
- Modify: `products/control-center/api/src/services/youtube-ingest-service.ts`
- Modify: `products/control-center/api/src/trpc/routers/media.ts:210-252`
- Modify: `products/control-center/api/src/services/playlist-poller-service.ts:126`
- Modify: `products/control-center/api/src/env.ts:48,127`
- Modify: `packages/platform/src/index.ts:460`
- Test: `products/control-center/api/src/__tests__/youtube-ingest-service.test.ts` (existing; check the exact filename first with `ls products/control-center/api/src/__tests__ | grep youtube`)

**Interfaces:**
- Consumes: `JobHandler`, `runYoutubeIngest` (Task 2).
- Produces: `export async function ytdlpDownload(videoId: string, storageDir: string, signal: AbortSignal): Promise<{ videoPath: string; thumbPath: string | null }>`

- [ ] **Step 1: Read the existing ingest tests**

Run: `ls products/control-center/api/src/__tests__ | grep -i youtube && grep -n "ytdlpDownload\|enrichTitle\|videoPolicy" products/control-center/api/src/__tests__/*youtube*`

Every assertion naming `videoPolicy`, `enrichTitle`, `audioPath`, or `audioBytes` is now obsolete and gets deleted or rewritten in Step 2. Note how the tests mock `execFile` — reuse that mock exactly.

- [ ] **Step 2: Rewrite the tests**

Replace the `ytdlpDownload` describe block with:

```ts
describe("ytdlpDownload", () => {
  it("makes exactly one yt-dlp call", async () => {
    const calls = captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls).toHaveLength(1);
  });

  it("requests AV1 <=1080p and never re-encodes", async () => {
    const calls = captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).toContain("bv*[vcodec^=av01][height<=1080]+ba/b[height<=1080]");
  });

  it("downloads fragments concurrently", async () => {
    const calls = captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).toContain("-N");
    expect(calls[0]).toContain("4");
  });

  it("uses an archival output template, not the bare video id", async () => {
    const calls = captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    const output = calls[0][calls[0].indexOf("--output") + 1];
    expect(output).toBe("/media/%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s");
  });

  it("returns the path yt-dlp reports rather than guessing it", async () => {
    captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    const out = await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(out.videoPath).toBe("/media/Chan/20190101 - Set [abc123].mkv");
  });

  it("forwards the abort signal so a timeout kills the subprocess", async () => {
    const calls: Array<Record<string, unknown>> = [];
    mockExecFileOptions(calls, ["/media/Chan/x.mkv"]);
    const ac = new AbortController();
    await ytdlpDownload("abc123", "/media", ac.signal);
    expect(calls[0]?.signal).toBe(ac.signal);
  });

  it("never downloads audio separately", async () => {
    const calls = captureExecFile(["/media/Chan/20190101 - Set [abc123].mkv"]);
    await ytdlpDownload("abc123", "/media", new AbortController().signal);
    expect(calls[0]).not.toContain("-x");
    expect(calls[0]).not.toContain("bestaudio");
  });
});
```

Write `captureExecFile(stdoutLines)` and `mockExecFileOptions(sink, stdoutLines)` as local helpers in this file, modelled on the existing `execFile` mock. `captureExecFile` returns the array of argv arrays passed to `execFile`; `mockExecFileOptions` pushes the options object instead. Both resolve `{ stdout: stdoutLines.join("\n") + "\n", stderr: "" }`.

Delete any test asserting `enrichTitle`, `videoPolicy`, `audioPath`, or `audioBytes`.

Run: `cd products/control-center/api && bunx vitest run src/__tests__/youtube-ingest-service.test.ts`
Expected: FAIL — `ytdlpDownload` still takes `(videoId, videoPolicy, storageDir)`.

- [ ] **Step 3: Rewrite `ytdlpDownload`**

Replace the existing function in `youtube-ingest-service.ts`:

```ts
/**
 * Download one video (audio is inside the muxed container) plus its thumbnail.
 *
 * YouTube serves video and audio as separate DASH streams above 360p; the `+`
 * in the selector makes ffmpeg mux them into one file. AV1 is preferred as the
 * most efficient codec YouTube serves; the fallback after `/` is a pre-combined
 * stream. We never re-encode -- both paths are stream copies.
 *
 * The output template is archival rather than machine-keyed: the DB keeps the
 * video id as identity, while the filename serves whoever browses the NAS in
 * VLC a year from now. Because that template includes a subdirectory, we ask
 * yt-dlp for the exact path it wrote instead of globbing for it.
 *
 * @public - exported for unit testing so tests can mock the subprocess
 */
export async function ytdlpDownload(
  videoId: string,
  storageDir: string,
  signal: AbortSignal,
): Promise<{ videoPath: string; thumbPath: string | null }> {
  const output = `${storageDir}/%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s`;

  const { stdout } = await execFileAsync(
    "yt-dlp",
    [
      "-f",
      "bv*[vcodec^=av01][height<=1080]+ba/b[height<=1080]",
      "-N",
      "4", // concurrent DASH fragments -- the real throughput lever
      "--write-thumbnail",
      "--output",
      output,
      "--print",
      "after_move:filepath",
      "--no-simulate",
      "--quiet",
      "--no-warnings",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { signal },
  );

  const videoPath = stdout.trim().split("\n").filter(Boolean).pop();
  if (!videoPath) {
    throw new Error(`yt-dlp reported no output path for ${videoId}`);
  }

  return { videoPath, thumbPath: findThumbnailFor(videoPath) };
}

/**
 * Locate the thumbnail yt-dlp wrote alongside the video. --write-thumbnail uses
 * the same stem as the video file, so we look for that stem with an image
 * extension rather than globbing the whole directory.
 */
function findThumbnailFor(videoPath: string): string | null {
  const stem = videoPath.replace(/\.[^./]+$/, "");
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    if (existsSync(`${stem}${ext}`)) return `${stem}${ext}`;
  }
  return null;
}
```

Add `existsSync` to the `node:fs` import. Delete `findDownloadedFile` if nothing else uses it (`grep -n findDownloadedFile` first).

- [ ] **Step 4: Delete enrichment and simplify the handler**

In the same file:

- Delete `enrichTitle` entirely and its `fetch` call to `openrouter.ai`.
- Delete the `YoutubeIngestPayload.videoPolicy` field.
- Replace the handler's download + persist section:

```ts
const storageDir = env.MEDIA_STORAGE_DIR;

const downloadStart = performance.now();
getLogger().info({ videoId }, "yt-dlp download start");
const { videoPath, thumbPath } = await ytdlpDownload(videoId, storageDir, signal);
const downloadMs = +(performance.now() - downloadStart).toFixed(1);

const videoBytes = fileSizeBytes(videoPath);
getLogger().info({ videoId, videoPath, videoBytes, durationMs: downloadMs }, "yt-dlp download complete");

await db
  .update(mediaItem)
  .set({
    status: "ready",
    videoPath,
    thumbPath: thumbPath ?? null,
    videoBytes: videoBytes ?? null,
    durationSec,
    error: null,
    updatedAt: new Date(),
  })
  .where(eq(mediaItem.id, mediaItemId));
```

- [ ] **Step 5: Remove the videoPolicy call sites and the OpenRouter env**

In `products/control-center/api/src/trpc/routers/media.ts`, delete `videoPolicy: "on",` from the `mediaSource` insert (~:225) and from the `enqueueJob` payload (~:248).

In `products/control-center/api/src/services/playlist-poller-service.ts`, delete `videoPolicy: source.videoPolicy,` from the `enqueueJob` payload (~:126). This is the third `videoPolicy` call site and the easiest to miss — Task 4 drops the column, so leaving it here breaks the build.

While in that file, fix the docstring at `:4`: it claims the cycle runs "for each playlist-kind source", but the code never filters on `kind` — it polls any enabled source that resolves to a URL. Say what it does.

In `products/control-center/api/src/env.ts`, delete `"OPENROUTER_API_KEY",` (:48) and `OPENROUTER_API_KEY: z.string().default(""),` (:127). Leave the `packages/logger` redaction entries — they cost nothing and guard against the key reappearing.

Remove `OPENROUTER_API_KEY` from **three** places, not one — Task 1 found the key had only ever been on the deleted `media-worker` usage, and had to re-add it to keep it reachable. An existing test enforces that the `api` and `worker` secret sets stay in lockstep, so it now sits on both:

- `packages/platform/src/index.ts` — the `apiSecrets` set
- `packages/platform/src/index.ts` — the `workerSecrets` set
- `infra/test/secrets-derivation.test.ts` — the golden fixture, which carries an explanatory comment pointing here

Removing it from only one set fails the lockstep test; removing it from both without the golden fails the derivation test.

- [ ] **Step 6: Verify and commit**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass.

```bash
git add -A
git commit -m "feat(control-center/api): video-only ingest with archival filenames

Drops the separate audio download (the muxed file already contains its
audio), the videoPolicy branch, and the OpenRouter title enrichment --
four columns nothing read, behind a call that could fail an ingest whose
multi-GB download had already succeeded.

Adds -N 4 for concurrent DASH fragments, and asks yt-dlp for the path it
wrote rather than globbing, since the archival template now includes a
per-uploader subdirectory."
git push origin main
```

---

### Task 4: Drop the dead columns

**Files:**
- Modify: `products/control-center/api/src/db/schema.ts:271-312`
- Modify: `products/control-center/api/src/trpc/routers/media.ts:222`
- Create: `products/control-center/api/drizzle/` migration (generated)
- Test: `products/control-center/api/src/__tests__/media-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `media_item` without `clean_title`, `artist`, `event`, `category`, `audio_path`, `audio_bytes`, `error`, `retries`; `media_source` without `video_policy`, `kind`; `job` without `result`, `locked_by`.

- [ ] **Step 1: Update the schema test**

In `products/control-center/api/src/__tests__/media-schema.test.ts`, change the `cleanTitle` assertion (~:70) to its negation, and delete the `retries` assertions at :82, :141-143 and the `"retries"` entry in the required-columns list at :150:

```ts
for (const dropped of [
  "cleanTitle", "artist", "event", "category",
  "audioPath", "audioBytes", "error", "retries",
]) {
  expect(cols).not.toContain(dropped);
}
expect(cols).toContain("rawTitle"); // identity label written by the poller, kept
```

Add equivalent negative assertions for `media_source.kind` and for `job.result` / `job.lockedBy` wherever those tables are covered.

Run: `cd products/control-center/api && bunx vitest run src/__tests__/media-schema.test.ts`
Expected: FAIL — columns still present.

- [ ] **Step 2: Drop the columns**

In `products/control-center/api/src/db/schema.ts`, delete from `mediaSource`:

```ts
kind: text("kind").notNull(), // 'playlist' | 'adhoc'
videoPolicy: text("video_policy").notNull().default("none"), // 'none' | 'on'
```

and its now-orphaned index from the same table's index array:

```ts
index("media_source_kind_idx").on(t.kind),
```

from `mediaItem`:

```ts
cleanTitle: text("clean_title"),
artist: text("artist"),
event: text("event"),
category: text("category"),
audioPath: text("audio_path"),
audioBytes: integer("audio_bytes"),
error: text("error"),
retries: integer("retries").notNull().default(0),
```

and from `job`:

```ts
lockedBy: text("locked_by"),
result: jsonb("result"),
```

Keep `rawTitle`, `videoPath`, `thumbPath`, `videoBytes`, `durationSec`, `mediaSource.title` (the human label an operator reads in `psql`), and `job.lockedAt` (the reaper keys off it).

Retune the job claim index in the same file — every claim now filters a single `type`, and the reaper filters `type` + `locked_at`:

```ts
index("job_claim_idx").on(t.status, t.type, t.runAfter, t.priority),
```

- [ ] **Step 3: Remove the `kind` write**

`products/control-center/api/src/trpc/routers/media.ts:222` sets `kind: "adhoc"` on the `src_adhoc` insert. Delete that line — nothing reads the column, and it no longer exists.

Note: `media_source.kind` is `NOT NULL` with no default and the seed in Task 6 no longer supplies it. That is consistent — the column is gone by then.

- [ ] **Step 4: Generate and format the migration**

```bash
cd products/control-center/api && bun run db:generate
cd - && bunx biome format --write products/control-center/api/drizzle/meta
```

The `biome format` step is not optional: generated migration meta JSON fails `bun run lint` without it.

Open the generated `.sql` and confirm it contains **twelve** `DROP COLUMN` statements, the `media_source_kind_idx` drop, and the `job_claim_idx` recreate — and nothing else.

The tables are **not** empty: `media_source` has 1 row, `media_item` 93, `job` 137. The drop is still data-safe because every dropped `media_item` column is NULL across all 93 rows, and `job.result` / `job.locked_by` were never written. No backfill is needed, but do not treat this as an empty-table migration — check the counts yourself before applying:

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "select count(*) total, count(clean_title) ct, count(audio_path) ap FROM media_item;"
```

Expected: `93 | 0 | 0`.

- [ ] **Step 5: Verify and commit**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass.

```bash
git add -A
git commit -m "feat(control-center/api): drop enrichment, audio and unread columns"
git push origin main
```

---

### Task 5: Runtime cleanups the merge retires

Three pieces of the shared runtime exist only because there were two apps. Doing this after the merge means the deletions are provably safe.

**Files:**
- Modify: `packages/worker-runtime/src/runtime.ts`, `packages/worker-runtime/src/types.ts`
- Modify: `packages/worker-runtime/test/runtime.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `WorkerRuntime` with only `start()` and `stop()`; `createWorkerRuntime(workers: Worker[], opts: { logger: Logger })`.

- [ ] **Step 1: Confirm `stats()` has no consumers**

Run: `grep -rn "\.stats()\|WorkerStats" --include="*.ts" products packages --exclude-dir=node_modules | grep -v worker-runtime`
Expected: no output. If anything appears, stop and keep `stats()` — the premise of this task is wrong.

- [ ] **Step 2: Delete the dead surface**

In `types.ts`: remove `stats(): WorkerStats[]` from `WorkerRuntime`, and remove the `memory` field from `WorkerStats`. Keep `WorkerStats` itself — the runtime still uses it internally for failure streaks and the debug snapshot.

In `runtime.ts`:
- Remove the `statsEveryNRuns` option from `WorkerRuntimeOptions` and the `opts.statsEveryNRuns ??` line; use `DEFAULT_STATS_EVERY_N_RUNS` directly and rename it `STATS_EVERY_N_RUNS`.
- Remove `state.stats.memory = process.memoryUsage();` from the `finally` block, and `rss` / `heapUsed` from the debug snapshot.
- Remove the `stats()` method from the returned object.
- Update the header comment: the per-app stats cadence knob no longer exists, and there is one worker app now, not two. Task 1 left this file's comments half-updated (e.g. prose referring to "the former products/control-center/media-worker", and a `statsEveryNRuns` doc block explaining media-worker's 30 when no caller passes 30 any more). Sweep the whole file's comments, not just the header.

- [ ] **Step 3: Update the runtime tests**

In `packages/worker-runtime/test/runtime.test.ts`, delete the `statsEveryNRuns: 3` option from the snapshot test and assert against the default cadence instead. Delete any test calling `runtime.stats()` or asserting on `memory`.

- [ ] **Step 4: Verify and commit**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass.

```bash
git add packages/worker-runtime
git commit -m "refactor(worker-runtime): drop stats(), statsEveryNRuns, per-worker memory

statsEveryNRuns existed only because worker used 60 and media-worker 30;
one app means one constant. stats() had no consumers outside the package.
WorkerStats.memory sampled process-wide memory and stored it per worker,
so post-merge it was the same number duplicated twelve times."
git push origin main
```

---

### Task 6: Seed the playlist, unpark the backlog, verify a real ingest

The first end-to-end exercise of a path that has never run in prod, and the go-live switch for the backlog Task 1 parked.

**Files:**
- None unless Step 5 finds something. This task is operational.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Confirm the deployed image is current**

```bash
kubectl -n control-center get pods -l app=worker -o jsonpath='{.items[*].spec.containers[*].image}'
kubectl -n control-center logs deploy/worker --tail=20
```

The pod must be running the image built from Task 5's commit. Rapid pushes can cancel CI builds and leave a green run deploying stale digests — verify the pod's age against the commit before continuing.

- [ ] **Step 2: Seed the source**

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "INSERT INTO media_source (id, external_id, title, enabled)
   VALUES ('src_djsets', 'PL59a6ZZ2kJGrjLI7cb6hxXr4EfmBnzseW', 'DJ Sets', true)
   ON CONFLICT (id) DO NOTHING;"
```

Note the database is `control_center` with an underscore; the namespace and pod use hyphens. `kind` is deliberately absent — Task 4 dropped the column.

`external_id` is the right column to set: the poller resolves a source's URL as `source.url ?? buildPlaylistUrl(source.externalId)` (`playlist-poller-service.ts:70`), expanding the id to `https://www.youtube.com/playlist?list=<id>`. Leave `url` NULL.

There is no tRPC procedure or UI for creating a `media_source` — adding a playlist, pausing one (`enabled = false`), or switching which playlist is watched are all `psql` operations against prod. That is the accepted state for now; see Out of Scope in the spec.

- [ ] **Step 3: Watch the poller enumerate — still with the backlog parked**

The poller runs on start and every 2 minutes. Let one cycle pass before unparking, so the poller's behaviour is observed on its own.

```bash
kubectl -n control-center logs deploy/worker --tail=50 | grep -i playlist
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT status, count(*) FROM media_item GROUP BY status;"
```

Expected: 4 new `media_item` rows (the playlist has 97 videos; 93 are already known and dedup is global on `yt_video_id`), and 4 new `youtube_ingest` jobs at `run_after = now()`. Those 4 will be claimed immediately — they are the first real ingests, and a deliberately small first batch.

- [ ] **Step 4: Watch the first ingest complete**

```bash
kubectl -n control-center logs deploy/worker --tail=100 | grep -E "yt-dlp|job (claimed|completed)"
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT type, status, attempts, last_error FROM job WHERE type='youtube_ingest' ORDER BY id DESC LIMIT 10;"
```

Expected: a `job claimed` line, a `yt-dlp download complete` line, then `job completed`, and the row at `done`.

- [ ] **Step 5: Confirm the archive is browsable**

```bash
kubectl -n control-center exec deploy/worker -- find /app/media -maxdepth 2 -type f | head -20
```

Expected: paths shaped `/app/media/<Uploader>/<YYYYMMDD> - <Title> [<id>].<ext>` — readable in VLC, not bare video IDs.

If filenames are mangled or the write fails, the likely cause is characters the Synology's filesystem rejects. Add `--restrict-filenames` to the yt-dlp argv in `ytdlpDownload`, commit, push, and re-verify before continuing to Step 6.

- [ ] **Step 6: Unpark the backlog**

Only once Steps 4 and 5 have passed on a real download:

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "UPDATE job SET run_after = now(), updated_at = now()
   WHERE type = 'youtube_ingest' AND status = 'queued' AND run_after > now();"
```

Expected: `UPDATE 93`.

This releases ~93 sets, roughly 126 GB against 5.9 TB free. Their payloads still carry `videoPolicy: "on"`, which the handler now ignores. Downloads are serial — one `youtube_ingest` worker, per-type concurrency 1 — so expect this to run for hours, not minutes. Check back:

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT status, count(*) FROM job WHERE type='youtube_ingest' GROUP BY status;"
kubectl -n control-center exec deploy/worker -- df -h /app/media
```

**Watch worker RSS during this, and do not skip it.** The `512M` limit is a judgement call, not a measurement: it is down from media-worker's 1G and up from worker's old 384M, and nothing has exercised it under a real download. The merge also means a worker OOM now takes the light and climate enforcers down with it — the blast-radius coupling the original split existed to prevent, accepted deliberately for one deployable. If RSS approaches the limit, raise it in `infra/src/services.ts`; that is one number.

```bash
kubectl -n control-center top pod -l app=worker
kubectl -n control-center get pods -l app=worker -o jsonpath='{.items[*].status.containerStatuses[*].restartCount}'
```

A nonzero restart count during the drain means the limit is too low, not that the download failed.

Also re-enable the adhoc source if it should be live: Task 1 set `media_source.src_adhoc` to `enabled = false` as belt-and-braces while the pre-rewrite ingest path was deployed. It has NULL `external_id` and NULL `url`, so the poller skips it either way, and `media.addUrls` (the only thing that would populate it) has zero callers. Leaving it disabled is fine; just know why it is off.

- [ ] **Step 7: Record the outcome**

If anything needed adjusting (disk threshold, `--restrict-filenames`, memory), update `docs/superpowers/specs/2026-07-20-worker-merge-design.md` to match what actually shipped, and commit.

---

### Task 7: Documentation

**Files:**
- Modify: `CLAUDE.md:25-26`
- Modify: `CODEBASE_OVERVIEW.md` (grep for `media-worker` first)

- [ ] **Step 1: Update Current Shape**

In `CLAUDE.md`, replace the two worker lines with one:

```markdown
- `products/control-center/worker`, interval reconcile loops plus the durable job queue (notifications, YouTube archival).
```

- [ ] **Step 2: Sweep for stale references**

Run: `grep -rn "media-worker" --include="*.md" . | grep -v node_modules | grep -v docs/beads-archive | grep -v docs/superpowers`

Update each hit. Leave `docs/beads-archive/` (frozen) and the spec/plan (historical record) alone.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "docs: worker is one deployable with loops and jobs"
git push origin main
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Merge the apps, Dockerfile, disk guard 50 GB | 1 |
| Infra: workload, 512M, NFS, secrets | 1 |
| Job-as-worker plumbing, `claimOne`, `jobWorker`, per-type `maxMs`, AbortSignal | 2 |
| Crash recovery / stale-lease reaper | 2 |
| Video-only ingest, `-N 4`, filename template | 3 |
| Remove LLM enrichment + `OPENROUTER_API_KEY` | 3 |
| Schema migration (12 columns) | 4 |
| Runtime cleanups (`stats()`, `statsEveryNRuns`, `memory`) | 5 |
| Seed and verify | 6 |
| Docs | 7 |

No gaps.

**Type consistency:** `JobHandler` gains `(payload, signal)` in Task 2 and every caller is updated in that same commit. `JobSpec { type, handler, maxMs }` is defined and consumed in Task 2. `ytdlpDownload(videoId, storageDir, signal)` is defined and tested in Task 3 with no other callers. `hasSufficientDisk(dir, thresholdBytes?)` is introduced in Task 1 with no `env` default and every call site passes `dir` explicitly.

**Green-at-every-commit:** Task 1 keeps `claimAndRun` and `registerHandler` intact while moving code between apps. Task 2 replaces the mechanism and all its callers in one commit. Tasks 3–5 touch code whose callers are already consistent. Every task runs the full `typecheck && test && lint && knip` gate before its commit, and pushes immediately.

**Go-live gate:** Task 1 Step 1 parks the 93-job backlog on `run_after`; Task 6 Step 6 releases it, after a real download has been verified end-to-end. The gate lives in data, not in a code flag, so no dead configuration or unused export exists at any commit. `claimOne`'s `run_after <= now()` filter — the mechanism the gate depends on — is covered by a test in Task 2.
