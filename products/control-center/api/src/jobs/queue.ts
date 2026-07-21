/**
 * Generic durable job queue (www-kp4k.12). Provides:
 *   - enqueueJob: insert a new job row, claimable immediately or at a future time
 *   - claimOne: atomic FOR UPDATE SKIP LOCKED claim of ONE row of ONE type,
 *     run under a timeout → ack/nack
 *
 * Claim is done with raw SQL so we get the true FOR UPDATE SKIP LOCKED
 * atomicity that prevents two claimers from taking the same row. The ORM layer
 * (drizzle) does not expose SKIP LOCKED in its query builder, so we drop to
 * sql`` for the claim step only.
 *
 * Retry strategy: exponential backoff capped at 1h.
 *   delay = min(60 * 60, 30 * 2^(attempts - 1)) seconds
 *
 * Idempotency:  handlers are responsible for their own idempotency;
 *   the queue guarantees at-least-once delivery, not exactly-once.
 */

import { getLogger } from "@www/logger";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { job } from "../db/schema";

/**
 * Handler signature: receives the JSON payload plus an AbortSignal that fires
 * when the job exceeds its type's maxMs. Handlers that spawn subprocesses MUST
 * forward the signal (execFile accepts one) or the subprocess outlives the job.
 */
export type JobHandler<T = unknown> = (payload: T, signal: AbortSignal) => Promise<void>;

/** Every job type the queue knows how to run. Typo'd types compile-fail here
 *  instead of silently registering a worker that claims nothing forever. */
export type JobType = "notify" | "youtube_ingest";

export interface EnqueueOptions {
  priority?: number;
  runAfter?: Date;
  maxAttempts?: number;
}

/**
 * Insert a new job into the queue. Returns the serial id of the created row.
 * The job is immediately claimable unless runAfter is in the future.
 */
export async function enqueueJob(
  type: JobType,
  payload: unknown,
  opts: EnqueueOptions = {},
): Promise<number> {
  const row = await db
    .insert(job)
    .values({
      type,
      payload: payload as Record<string, unknown>,
      priority: opts.priority ?? 0,
      runAfter: opts.runAfter ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 5,
    })
    .returning({ id: job.id });
  if (!row[0]) throw new Error("enqueueJob: insert returned no row");
  return row[0].id;
}

/**
 * Exponential backoff: delay = min(3600, 30 * 2^(attempts - 1)) seconds.
 * After 5 failures: 30s, 60s, 120s, 240s, 480s (capped at 1h beyond that).
 */
function backoffSec(attempts: number): number {
  return Math.min(3600, 30 * 2 ** (attempts - 1));
}

/**
 * Jobs this process has claimed and is currently running, keyed by job id.
 *
 * Module-level because there is exactly one queue per process (one `db`), and
 * the shutdown handler lives in a different package (the worker entrypoint)
 * with no handle on any individual claimOne call.
 */
interface InFlightJob {
  type: JobType;
  controller: AbortController;
  /** True once releaseInFlightJobs has requeued the row; claimOne then keeps
   *  its hands off the row rather than racing the release with its own write. */
  released: boolean;
}

const inFlight = new Map<number, InFlightJob>();

/** Bound the shutdown release so a hung DB cannot outlast the pod's grace period. */
const RELEASE_TIMEOUT_MS = 10_000;

/**
 * Requeue every job this process currently holds, for a *graceful* shutdown.
 *
 * Deploys are routine here (every push to main replaces the worker pod), and a
 * pod replaced mid-download otherwise leaves its row at `running` until the
 * reaper's lease expires , maxMs + grace, which is 65 minutes for
 * youtube_ingest. Releasing on SIGTERM turns that into seconds.
 *
 * `attempts` is decremented because claimOne incremented it at claim time and
 * no real attempt occurred , a deploy is not the job's fault. That cannot mask
 * a genuinely poisonous job: this path only runs on a signal the process
 * survives long enough to handle. An OOM kill or eviction is SIGKILL, never
 * reaches here, and is still caught by the reaper's max_attempts ceiling.
 *
 * The abort comes first so a subprocess (yt-dlp) dies cleanly and flushes its
 * `.part` file, which the requeued attempt then resumes from.
 *
 * Returns the number of rows released.
 */
export async function releaseInFlightJobs(): Promise<number> {
  const entries = [...inFlight.entries()];
  if (entries.length === 0) return 0;

  // Mark released BEFORE aborting: the abort makes handlers reject synchronously
  // enough that claimOne's catch must already see the flag and skip its write.
  for (const [, entry] of entries) {
    entry.released = true;
    entry.controller.abort();
  }

  let released = 0;
  for (const [id, entry] of entries) {
    try {
      await db.execute(
        sql`
          UPDATE job
          SET status = 'queued',
              attempts = GREATEST(attempts - 1, 0),
              run_after = now(),
              locked_at = null,
              updated_at = now()
          WHERE id = ${id} AND status = 'running'
        `,
      );
      released += 1;
      getLogger().info({ jobId: id, type: entry.type }, "job released on shutdown");
    } catch (err) {
      // Best effort: a failed release just falls back to the reaper's lease.
      getLogger().error({ jobId: id, type: entry.type, err }, "job release on shutdown failed");
    }
  }
  return released;
}

/**
 * releaseInFlightJobs under a hard deadline. Kubernetes gives the pod
 * terminationGracePeriodSeconds (30s by default) before SIGKILL, so a wedged
 * connection must not consume the whole window , resolves either way.
 */
export async function releaseInFlightJobsWithTimeout(
  timeoutMs = RELEASE_TIMEOUT_MS,
): Promise<number> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      releaseInFlightJobs(),
      new Promise<number>((resolve) => {
        timer = setTimeout(() => {
          getLogger().error({ timeoutMs }, "job release on shutdown timed out");
          resolve(0);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

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
  type: JobType,
  handler: JobHandler,
  maxMs: number,
): Promise<boolean> {
  // Use a transaction so the claim + status update is atomic. The handler runs
  // OUTSIDE the transaction so a long download does not hold a lock on the job
  // row for its duration.
  const claimed = await db.transaction(async (tx) => {
    // ORDER BY priority DESC (higher = more urgent), then FIFO by created_at.
    // FOR UPDATE SKIP LOCKED means a second concurrent claimer skips any row
    // another transaction is already updating , the single-flight guarantee.
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
    { jobId: claimed.id, type: claimed.type, attempts: claimed.attempts + 1 },
    "job claimed",
  );

  const controller = new AbortController();
  const startedAt = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  // Registered for the whole run so a shutdown can abort the work and hand the
  // row back; removed in `finally` so a completed job is never re-released.
  const entry: InFlightJob = { type, controller, released: false };
  inFlight.set(claimed.id, entry);

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
    // A shutdown release already handed the row back to `queued`; marking it
    // done here would resurrect a job whose work was cut short mid-flight.
    if (entry.released) return true;
    getLogger().info({ jobId: claimed.id, type: claimed.type, durationMs }, "job completed");
    await db.execute(
      sql`
        UPDATE job
        SET status = 'done', last_error = null, locked_at = null, updated_at = now()
        WHERE id = ${claimed.id}
      `,
    );
  } catch (err) {
    // Abort on any failure, not just timeout: a handler that threw may still
    // have work in flight behind the signal.
    controller.abort();
    // The handler rejected *because* we aborted it for shutdown. The release
    // already requeued the row; retrying here would burn an attempt (or, at
    // max_attempts, permanently fail) a job that never actually failed.
    if (entry.released) return true;
    const msg = err instanceof Error ? err.message : String(err);
    const nextAttempts = claimed.attempts + 1; // attempts was incremented above
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
              locked_at = null,
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
          SET status = 'failed', last_error = ${msg}, locked_at = null, updated_at = now()
          WHERE id = ${claimed.id}
        `,
      );
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    inFlight.delete(claimed.id);
  }

  return true;
}
