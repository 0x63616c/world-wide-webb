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
        SET status = 'done', last_error = null, locked_at = null, updated_at = now()
        WHERE id = ${claimed.id}
      `,
    );
  } catch (err) {
    // Abort on any failure, not just timeout: a handler that threw may still
    // have work in flight behind the signal.
    controller.abort();
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
  }

  return true;
}
