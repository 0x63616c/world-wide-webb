# Worker Merge + YouTube Archival Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `media-worker` into `worker` as a single deployable, model job types as plain `Worker`s, and get YouTube archival actually running against a real playlist.

**Architecture:** The existing `Worker` contract (named interval loop, await-before-reschedule, per-cycle try/catch) already provides per-type concurrency 1, type isolation, and failure isolation. So a job type becomes a `Worker` whose cycle drains that one type — no dispatcher, no lanes, no concurrency budget. Queue concerns (payload, attempts, backoff, timeout) live in `claimOne`. A stale-job reaper covers process death, which an in-process timeout cannot.

**Tech Stack:** Bun, TypeScript, drizzle-orm + Postgres, vitest, Pulumi + k3s, yt-dlp + ffmpeg on Alpine.

**Spec:** `docs/superpowers/specs/2026-07-20-worker-merge-design.md`

## Global Constraints

- Backend code uses structured logging (`getLogger()` / `createLogger`), never `console.*`.
- No fake or placeholder data.
- IDs default to `prefix_<id>`.
- Never re-encode video. The AV1 format selector and `-N` are the only yt-dlp perf levers.
- Commit and push after every task. Push to `main` deploys to prod; do not batch.
- Verify before pushing: `bun run typecheck` plus the tests touched by that task.
- Do not use PRs. Work directly on `main`.
- Run `bunx biome format --write` on generated drizzle migration meta before committing.
- `products/control-center/api` gains a dependency on `@www/worker-runtime` in Task 2. It is a leaf package; this edge is intentional.

## File Structure

| File | Responsibility |
|---|---|
| `products/control-center/api/src/jobs/queue.ts` | Modify: `claimOne` replaces `claimAndRun`; `JobHandler` gains an `AbortSignal`; handler registry deleted |
| `products/control-center/api/src/jobs/job-worker.ts` | Create: `JobSpec`, `jobWorker`, `staleJobReaper` — the bridge between the queue and the `Worker` contract |
| `products/control-center/api/src/services/youtube-ingest-service.ts` | Modify: video-only download, `-N 4`, archival filename, enrichment deleted |
| `products/control-center/api/src/services/notification-service.ts` | Modify: export the handler function instead of registering it |
| `products/control-center/api/src/db/schema.ts` | Modify: drop 6 columns |
| `products/control-center/api/src/worker-deps.ts` | Modify: single barrel for the merged worker; `media.ts` deleted |
| `products/control-center/worker/src/index.ts` | Modify: absorbs poller, disk guard, both job workers, reaper |
| `products/control-center/worker/src/disk-guard.ts` | Create: moved out of the media-worker entrypoint so it is testable without booting the app |
| `products/control-center/worker/Dockerfile` | Modify: add ffmpeg + yt-dlp to the runtime stage |
| `packages/worker-runtime/src/runtime.ts` + `types.ts` | Modify: delete `stats()`, `statsEveryNRuns`, `WorkerStats.memory` |
| `infra/src/services.ts`, `secrets-map.ts`, `packages/platform/src/index.ts` | Modify: delete the media-worker workload and secret usage |

---

### Task 1: `claimOne` with per-job timeout

Replaces `claimAndRun` (which drains every type serially) with a single-type, single-job claim under a timeout. The timeout does two things: it passes an `AbortSignal` so the handler can kill its subprocess, **and** it races the handler promise so the job row is marked failed even if a handler ignores the signal.

**Files:**
- Modify: `products/control-center/api/src/jobs/queue.ts`
- Test: `products/control-center/api/src/__tests__/queue.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `export type JobHandler<T = unknown> = (payload: T, signal: AbortSignal) => Promise<void>`
  - `export async function claimOne(type: string, handler: JobHandler, maxMs: number): Promise<boolean>` — returns `true` if a job was claimed and processed, `false` if none was available.
  - `export async function enqueueJob(type: string, payload: unknown, opts?: EnqueueOptions): Promise<number>` — unchanged.

- [ ] **Step 1: Read the existing test file to match its harness**

Run: `sed -n '1,60p' products/control-center/api/src/__tests__/queue.test.ts`

Note how it seeds rows and whether it uses a real DB or mocks `db`. Match that style exactly in the new tests — do not introduce a second harness.

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
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/queue.test.ts -t claimOne`
Expected: FAIL — `claimOne is not a function` / not exported.

- [ ] **Step 4: Implement `claimOne`**

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/queue.test.ts`
Expected: PASS. Other suites referencing `claimAndRun` / `registerHandler` will still fail to typecheck — Tasks 2–5 fix those callers. Do not repair them here.

- [ ] **Step 6: Commit**

```bash
git add products/control-center/api/src/jobs/queue.ts products/control-center/api/src/__tests__/queue.test.ts
git commit -m "feat(control-center/api): claimOne with per-job timeout and abort signal"
```

---

### Task 2: `jobWorker` and `staleJobReaper`

Turns a job type into a plain `Worker`, and adds the reaper that recovers rows stranded at `running` by process death — the failure an in-process timeout structurally cannot catch. Both are built from one `JobSpec[]`, so lease durations can never drift from timeouts.

**Files:**
- Create: `products/control-center/api/src/jobs/job-worker.ts`
- Create: `products/control-center/api/src/__tests__/job-worker.test.ts`
- Modify: `products/control-center/api/package.json`

**Interfaces:**
- Consumes: `claimOne`, `JobHandler` from Task 1.
- Produces:
  - `export interface JobSpec { type: string; handler: JobHandler; maxMs: number }`
  - `export function jobWorker(spec: JobSpec): Worker`
  - `export function staleJobReaper(specs: readonly JobSpec[]): Worker`
  - `export async function reapStaleJobs(specs: readonly JobSpec[]): Promise<number>` — returns rows requeued.

- [ ] **Step 1: Add the worker-runtime dependency**

In `products/control-center/api/package.json`, add to `dependencies`:

```json
"@www/worker-runtime": "workspace:*",
```

Run: `bun install`

- [ ] **Step 2: Write the failing tests**

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

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/job-worker.test.ts`
Expected: FAIL — cannot resolve `../jobs/job-worker`.

- [ ] **Step 4: Implement**

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/job-worker.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 6: Commit**

```bash
git add products/control-center/api/src/jobs/job-worker.ts products/control-center/api/src/__tests__/job-worker.test.ts products/control-center/api/package.json bun.lock
git commit -m "feat(control-center/api): job types as workers, plus stale-job reaper"
```

---

### Task 3: Video-only ingest, archival filenames, no enrichment

Three deletions and two additions in one task because they touch the same function and share one test cycle: drop the separate audio download, drop LLM enrichment, add `-N 4`, and switch to a filename a human can browse in VLC.

The old code located files by globbing `storageDir` for `videoId.*`. That breaks once the output template includes a subdirectory, so the download now asks yt-dlp for the exact path it wrote via `--print after_move:filepath`.

**Files:**
- Modify: `products/control-center/api/src/services/youtube-ingest-service.ts`
- Modify: `products/control-center/api/src/trpc/routers/media.ts:210-252`
- Modify: `products/control-center/api/src/env.ts:48,127`
- Test: `products/control-center/api/src/__tests__/youtube-ingest-service.test.ts` (existing; check the exact filename first with `ls products/control-center/api/src/__tests__ | grep youtube`)

**Interfaces:**
- Consumes: `JobHandler` (Task 1).
- Produces:
  - `export async function ytdlpDownload(videoId: string, storageDir: string, signal: AbortSignal): Promise<{ videoPath: string; thumbPath: string | null }>`
  - `export const runYoutubeIngest: JobHandler` — replaces `registerYoutubeIngestHandler()`.

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

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/youtube-ingest-service.test.ts`
Expected: FAIL — `ytdlpDownload` still takes `(videoId, videoPolicy, storageDir)`.

- [ ] **Step 4: Rewrite `ytdlpDownload`**

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

- [ ] **Step 5: Delete enrichment and rewrite the handler**

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

- Replace `registerYoutubeIngestHandler` with an exported handler:

```ts
/** The youtube_ingest job handler. Wired at the worker entrypoint. */
export const runYoutubeIngest: JobHandler = async (rawPayload, signal) => {
  await handleYoutubeIngest(rawPayload, signal);
};
```

Change `handleYoutubeIngest`'s signature to `(rawPayload: unknown, signal: AbortSignal)` and thread `signal` into `ytdlpDownload` and the `--dump-json` duration call. Delete the `import { registerHandler }` line.

- [ ] **Step 6: Remove the videoPolicy call sites and the OpenRouter env**

In `products/control-center/api/src/trpc/routers/media.ts`, delete `videoPolicy: "on",` from the `mediaSource` insert (~:225) and from the `enqueueJob` payload (~:248).

In `products/control-center/api/src/env.ts`, delete `"OPENROUTER_API_KEY",` (:48) and `OPENROUTER_API_KEY: z.string().default(""),` (:127). Leave the `packages/logger` redaction entries — they cost nothing and guard against the key reappearing.

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/youtube-ingest-service.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add products/control-center/api/src
git commit -m "feat(control-center/api): video-only ingest with archival filenames

Drops the separate audio download (the muxed file already contains its
audio), the videoPolicy branch, and the OpenRouter title enrichment --
four columns nothing read, behind a call that could fail an ingest whose
multi-GB download had already succeeded.

Adds -N 4 for concurrent DASH fragments, and asks yt-dlp for the path it
wrote rather than globbing, since the archival template now includes a
per-uploader subdirectory."
```

---

### Task 4: Drop the dead columns

**Files:**
- Modify: `products/control-center/api/src/db/schema.ts:271-312`
- Create: `products/control-center/api/drizzle/` migration (generated)
- Test: `products/control-center/api/src/__tests__/media-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `media_item` without `clean_title`, `artist`, `event`, `category`, `audio_path`, `audio_bytes`; `media_source` without `video_policy`.

- [ ] **Step 1: Update the schema test**

In `products/control-center/api/src/__tests__/media-schema.test.ts`, change the `cleanTitle` assertion (~:70) and any sibling assertions to their negations:

```ts
for (const dropped of ["cleanTitle", "artist", "event", "category", "audioPath", "audioBytes"]) {
  expect(cols).not.toContain(dropped);
}
expect(cols).toContain("rawTitle"); // identity label written by the poller, kept
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd products/control-center/api && bunx vitest run src/__tests__/media-schema.test.ts`
Expected: FAIL — columns still present.

- [ ] **Step 3: Drop the columns**

In `products/control-center/api/src/db/schema.ts`, delete from `mediaSource`:

```ts
videoPolicy: text("video_policy").notNull().default("none"), // 'none' | 'on'
```

and from `mediaItem`:

```ts
cleanTitle: text("clean_title"),
artist: text("artist"),
event: text("event"),
category: text("category"),
audioPath: text("audio_path"),
audioBytes: integer("audio_bytes"),
```

Keep `rawTitle`, `videoPath`, `thumbPath`, `videoBytes`, `durationSec`.

- [ ] **Step 4: Generate and format the migration**

```bash
cd products/control-center/api && bun run db:generate
cd - && bunx biome format --write products/control-center/api/drizzle/meta
```

The `biome format` step is not optional: generated migration meta JSON fails
`bun run lint` without it.

Open the generated `.sql` and confirm it contains seven `DROP COLUMN` statements and nothing else. The tables have zero rows in prod, so no backfill is needed.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd products/control-center/api && bunx vitest run && bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add products/control-center/api
git commit -m "feat(control-center/api): drop enrichment and audio columns"
```

---

### Task 5: Merge the entrypoints

The substance of the merge: `worker` absorbs the poller, the disk guard, both job workers, and the reaper; `media-worker` is deleted. The disk guard moves into its own module so it stays testable without booting the app.

**Files:**
- Create: `products/control-center/worker/src/disk-guard.ts`
- Create: `products/control-center/worker/src/disk-guard.test.ts` (port from `media-worker/src/disk-guard.test.ts`)
- Modify: `products/control-center/worker/src/index.ts`
- Modify: `products/control-center/worker/Dockerfile`
- Modify: `products/control-center/api/src/worker-deps.ts`
- Modify: `products/control-center/api/src/services/notification-service.ts:370-372`
- Delete: `products/control-center/media-worker/`, `products/control-center/api/src/media.ts`

**Interfaces:**
- Consumes: `jobWorker`, `staleJobReaper`, `JobSpec` (Task 2); `runYoutubeIngest` (Task 3).
- Produces: `export const runNotifyJob: JobHandler`; `export function hasSufficientDisk(dir?: string, thresholdBytes?: number): boolean`.

- [ ] **Step 1: Port the disk guard with the new threshold**

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

- [ ] **Step 2: Run the ported test**

Run: `cd products/control-center/worker && bunx vitest run src/disk-guard.test.ts`
Expected: PASS.

- [ ] **Step 3: Export the notify handler as a plain function**

In `products/control-center/api/src/services/notification-service.ts`, replace `registerNotifyHandler`:

```ts
/** The `notify` job handler. Wired at the worker entrypoint. */
export const runNotifyJob: JobHandler = async (payload) => {
  await handleNotifyJob(payload);
};
```

Add `import type { JobHandler } from "../jobs/queue";` and delete the `registerHandler` import.

- [ ] **Step 4: Collapse the barrels**

Replace the media-worker-specific exports in `products/control-center/api/src/worker-deps.ts` — delete the `claimAndRun` export and add:

```ts
export { job, mediaItem, mediaSource } from "./db/schema";
export { jobWorker, staleJobReaper, type JobSpec } from "./jobs/job-worker";
export { enqueueJob } from "./jobs/queue";
export { runNotifyJob } from "./services/notification-service";
export { runPlaylistPollerCycle } from "./services/playlist-poller-service";
export { runYoutubeIngest } from "./services/youtube-ingest-service";
```

Update the file's header comment: it currently explains that media-worker owns the queue and worker drains only `notify`. That is no longer true — say the worker app owns every loop and job type.

Delete `products/control-center/api/src/media.ts` and its `"./media"` entry from `package.json` `exports`.

- [ ] **Step 5: Rewrite the worker entrypoint**

In `products/control-center/worker/src/index.ts`:

- Delete `registerNotifyHandler()` and the `notify-queue` worker object (including its long comment about media-worker being parked — no longer true).
- Add to the imports from `@control-center/api/worker`: `env`, `jobWorker`, `staleJobReaper`, `type JobSpec`, `runNotifyJob`, `runPlaylistPollerCycle`, `runYoutubeIngest`.
- Add `import { hasSufficientDisk } from "./disk-guard";`
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

- Append to the `workers` array, after `asc-version-poll`:

```ts
  {
    // Playlist poller: enumerate each enabled media_source via
    // yt-dlp --flat-playlist and enqueue ingest jobs for unseen video IDs.
    name: "playlist-poller",
    intervalMs: 10 * 60_000,
    runOnStart: true,
    run: runPlaylistPollerCycle,
  },
  ...JOBS.map(jobWorker),
  staleJobReaper(JOBS),
```

- [ ] **Step 6: Add ffmpeg and yt-dlp to the worker image**

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

- [ ] **Step 7: Delete media-worker**

```bash
git rm -r products/control-center/media-worker
bun install
```

- [ ] **Step 8: Verify the whole workspace**

Run: `bun run typecheck && bun run test && bun run lint && bun run knip`
Expected: all pass. `knip` is the check that catches anything the deleted app left orphaned — fix whatever it reports rather than suppressing it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(control-center): merge media-worker into worker

One deployable instead of two. Job types become plain Workers, so
per-type concurrency 1 and type isolation come from the existing
await-before-reschedule runtime contract rather than a new dispatcher.

media-worker had never run a job in prod: it was parked at 0 replicas as
a migration checkpoint, then left parked on the belief that yt-dlp needs
significant memory. It streams to disk through a 1KB buffer, so memory
is flat with respect to file size."
```

---

### Task 6: Runtime cleanups the merge retires

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
- Update the header comment: the per-app stats cadence knob no longer exists, and there is one worker app now, not two.

- [ ] **Step 3: Update the runtime tests**

In `packages/worker-runtime/test/runtime.test.ts`, delete the `statsEveryNRuns: 3` option from the snapshot test and assert against the default cadence instead. Delete any test calling `runtime.stats()` or asserting on `memory`.

- [ ] **Step 4: Verify**

Run: `bun run typecheck && bunx vitest run --dir packages/worker-runtime`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/worker-runtime
git commit -m "refactor(worker-runtime): drop stats(), statsEveryNRuns, per-worker memory

statsEveryNRuns existed only because worker used 60 and media-worker 30;
one app means one constant. stats() had no consumers outside the package.
WorkerStats.memory sampled process-wide memory and stored it per worker,
so post-merge it was the same number duplicated twelve times."
```

---

### Task 7: Infra — one workload, NFS mount, 512M

**Files:**
- Modify: `infra/src/services.ts` (media-worker workload ~:261-289, worker ~:247-259, `mediaWorkerReplicas` at :200, :212, :491, :593, :667)
- Modify: `infra/src/secrets-map.ts:34,68`
- Modify: `packages/platform/src/index.ts:279,448-465,640,734-740`
- Test: `infra/src/__tests__/services.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `worker` workload with `resources: { memory: "512M" }`, the media NFS volume, and `MEDIA_STORAGE_DIR`.

- [ ] **Step 1: Update the infra tests first**

Find the test asserting the declared workload set and remove `media-worker` from it; add assertions that `worker` has the NFS volume and `512M`. Run them to watch the new assertions fail.

Run: `bunx vitest run --dir infra`
Expected: FAIL on the new assertions.

- [ ] **Step 2: Move the volume onto worker and delete the media-worker workload**

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

- [ ] **Step 3: Remove media-worker from the platform manifest**

In `packages/platform/src/index.ts`: remove `"media-worker"` from both union types (:279, :640), the `defineServiceSecretUsage` block (:458-465), and the workload entry (:734-740). Delete `OPENROUTER_API_KEY: secretCatalog.openRouter.apiKey` (:460) — Task 3 removed the env var. Fix the comment at :448 that explains worker running notify because media-worker is parked.

In `infra/src/secrets-map.ts`: remove the `"media-worker"` entries at :34 and :68.

- [ ] **Step 4: Remove the image from CI**

Run: `grep -rn "media-worker" .github/ infra/ packages/ products/ --include="*.yml" --include="*.yaml" --include="*.ts" --include="*.json" | grep -v node_modules`

Remove every remaining hit. Expected locations: the CI build matrix and any per-product path filter.

- [ ] **Step 5: Verify**

Run: `bun run typecheck && bunx vitest run --dir infra && bun run lint`
Expected: PASS, and the grep from Step 4 returns nothing.

- [ ] **Step 6: Commit and watch the deploy**

```bash
git add -A
git commit -m "feat(infra): single worker workload with the media NFS mount

worker takes over media-worker's NFS volume and MEDIA_STORAGE_DIR at
512M -- downloads stream to disk, so the limit covers the Bun process
and a yt-dlp subprocess, not the file."
git push origin main
```

After CI completes, confirm the pod picked up the new image and that yt-dlp is present:

```bash
kubectl -n control-center get pods -l app=worker
kubectl -n control-center exec deploy/worker -- yt-dlp --version
kubectl -n control-center exec deploy/worker -- df -h /app/media
```

Expected: a running pod, a yt-dlp version string, and the NAS share mounted. If the pod is `CrashLoopBackOff`, check `kubectl -n control-center logs deploy/worker` — the most likely cause is the NFS mount failing, not the app.

---

### Task 8: Seed the playlist and verify a real ingest

The first end-to-end exercise of a path that has never run in prod.

**Files:**
- None. This task is operational.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Seed the source**

```bash
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "INSERT INTO media_source (id, kind, external_id, title, enabled)
   VALUES ('src_djsets', 'playlist', 'PL59a6ZZ2kJGrjLI7cb6hxXr4EfmBnzseW', 'DJ Sets', true)
   ON CONFLICT (id) DO NOTHING;"
```

Note the database is `control_center` with an underscore; the namespace and pod use hyphens.

- [ ] **Step 2: Watch the poller enumerate**

The poller runs on start and every 10 minutes.

```bash
kubectl -n control-center logs deploy/worker --tail=50 | grep -i playlist
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT status, count(*) FROM media_item GROUP BY status;"
```

Expected: `media_item` rows appear with status `pending`, and `job` rows of type `youtube_ingest` are queued.

- [ ] **Step 3: Watch the first ingest complete**

```bash
kubectl -n control-center logs deploy/worker --tail=100 | grep -E "yt-dlp|job (claimed|completed)"
kubectl exec -n control-center control-center-1 -- psql -U postgres -d control_center -c \
  "SELECT type, status, attempts, last_error FROM job ORDER BY id DESC LIMIT 10;"
```

Expected: a `job claimed` line, a `yt-dlp download complete` line, then `job completed`, and the row at `done`.

- [ ] **Step 4: Confirm the archive is browsable**

```bash
kubectl -n control-center exec deploy/worker -- find /app/media -maxdepth 2 -type f | head -20
```

Expected: paths shaped `/app/media/<Uploader>/<YYYYMMDD> - <Title> [<id>].<ext>` — readable in VLC, not bare video IDs.

If filenames are mangled or the write fails, the likely cause is characters the Synology's filesystem rejects. Add `--restrict-filenames` to the yt-dlp argv in `ytdlpDownload`, and note it in the spec.

- [ ] **Step 5: Record the outcome**

If anything needed adjusting (disk threshold, `--restrict-filenames`, memory), update `docs/superpowers/specs/2026-07-20-worker-merge-design.md` to match what actually shipped, and commit.

---

### Task 9: Documentation

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
| Job-as-worker plumbing, `claimOne` | 1 |
| `jobWorker`, per-type `maxMs`, AbortSignal | 1, 2 |
| Crash recovery / stale-lease reaper | 2 |
| Runtime cleanups (`stats()`, `statsEveryNRuns`, `memory`) | 6 |
| Merge the apps, Dockerfile, disk guard 50 GB | 5 |
| Video-only ingest, `-N 4`, filename template | 3 |
| Remove LLM enrichment + `OPENROUTER_API_KEY` | 3 |
| Schema migration (7 columns) | 4 |
| Infra: workload, 512M, NFS, secrets | 7 |
| Seed and verify | 8 |
| Docs | 9 |

No gaps.

**Type consistency:** `JobHandler` gains `(payload, signal)` in Task 1 and is used with that shape in Tasks 2, 3, 5. `JobSpec { type, handler, maxMs }` is defined in Task 2 and consumed in Task 5. `ytdlpDownload(videoId, storageDir, signal)` is defined and tested in Task 3 with no other callers. `hasSufficientDisk(dir, thresholdBytes?)` loses its `env` default in Task 5 and every call site passes `dir` explicitly.

**Ordering note:** Tasks 1–4 leave the workspace typecheck-broken in the middle (callers of `claimAndRun` and `registerHandler` still exist until Task 5). That is deliberate — each task's own tests pass, and Task 5 Step 8 is the first full-workspace gate. Do not push between Tasks 1 and 5 expecting green CI; push after Task 5.
