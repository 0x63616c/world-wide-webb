/**
 * Generic durable job queue (www-kp4k.12). Provides:
 *   - enqueueJob: insert a new job row, claimable immediately or at a future time
 *   - registerHandler: bind a typed async handler to a job type string
 *   - claimAndRun: atomic FOR UPDATE SKIP LOCKED claim → dispatch → ack/nack
 *
 * Claim is done with raw SQL so we get the true FOR UPDATE SKIP LOCKED
 * atomicity that prevents two queueWorker instances from claiming the same row.
 * The ORM layer (drizzle) does not expose SKIP LOCKED in its query builder,
 * so we drop to sql`` for the claim step only.
 *
 * Retry strategy: exponential backoff capped at 1h.
 *   delay = min(60 * 60, 30 * 2^(attempts - 1)) seconds
 *
 * Idempotency:  handlers are responsible for their own idempotency;
 *   the queue guarantees at-least-once delivery, not exactly-once.
 */

import { getLogger } from "@repo/logger";
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { job } from "../db/schema";

// Handler signature — receives the JSON payload and returns void (or throws).
export type JobHandler<T = unknown> = (payload: T) => Promise<void>;

// Registry: maps type string → handler fn. Module-level singleton so workers
// in the same process share the same registry. Do NOT export the map directly —
// only registerHandler and claimAndRun touch it.
const handlers = new Map<string, JobHandler>();

/**
 * Register a handler for a job type. Call this at process startup before the
 * queueWorker begins claiming. Registering the same type twice is an error —
 * two handlers for the same type is always a misconfiguration.
 */
export function registerHandler<T>(type: string, handler: JobHandler<T>): void {
  if (handlers.has(type)) throw new Error(`Handler already registered for type: ${type}`);
  handlers.set(type, handler as JobHandler);
}

/** @public — test helper; lets test code reset the handler registry between cases */
export function _clearHandlersForTest(): void {
  handlers.clear();
}

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
  type: string,
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
 * Claim ONE queued job (status=queued, run_after<=now) atomically via
 * SELECT … FOR UPDATE SKIP LOCKED, dispatch to its registered handler,
 * then either mark done or handle the failure (retry or permanent fail).
 *
 * Returns true if a job was claimed and processed, false if the queue was empty.
 * Callers (queueWorker) loop calling this until it returns false.
 */
export async function claimAndRun(): Promise<boolean> {
  // Use a transaction so the claim + status update is atomic. If the handler
  // throws after we update status=running, the catch block updates it again in
  // its own statement — both are inside the transaction only for the claim step;
  // the handler itself runs OUTSIDE the transaction so a long download does not
  // hold a lock on the job row for its duration.
  const claimed = await db.transaction(async (tx) => {
    // Raw SQL: ORDER BY priority DESC (higher = more urgent), then FIFO by
    // created_at. FOR UPDATE SKIP LOCKED means a second concurrent claimer
    // skips any row another transaction is already updating — exactly the
    // single-flight guarantee we need (www-kp4k.12 AC).
    const rows = await tx.execute(
      sql`
        SELECT id, type, payload, attempts, max_attempts
        FROM job
        WHERE status = 'queued'
          AND run_after <= now()
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `,
    );
    const row = rows.rows[0] as
      | { id: number; type: string; payload: unknown; attempts: number; max_attempts: number }
      | undefined;
    if (!row) return null;

    // Mark running inside the same transaction that holds the row lock.
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

  if (!claimed) {
    getLogger().debug("job queue empty");
    return false;
  }

  const handler = handlers.get(claimed.type);
  if (!handler) {
    // No handler registered — permanently fail so it doesn't loop forever.
    getLogger().error(
      { jobId: claimed.id, type: claimed.type },
      "no handler registered for job type",
    );
    await db.execute(
      sql`
        UPDATE job
        SET status = 'failed',
            last_error = ${`No handler registered for type: ${claimed.type}`},
            updated_at = now()
        WHERE id = ${claimed.id}
      `,
    );
    return true;
  }

  getLogger().info(
    { jobId: claimed.id, type: claimed.type, attempts: claimed.attempts },
    "job claimed",
  );

  const claimStartedAt = performance.now();
  try {
    await handler(claimed.payload);
    const durationMs = +(performance.now() - claimStartedAt).toFixed(1);
    // Success: mark done and record no error.
    getLogger().info({ jobId: claimed.id, type: claimed.type, durationMs }, "job completed");
    await db.execute(
      sql`
        UPDATE job
        SET status = 'done',
            last_error = null,
            updated_at = now()
        WHERE id = ${claimed.id}
      `,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const nextAttempts = claimed.attempts + 1; // attempts was incremented above
    if (nextAttempts < claimed.max_attempts) {
      // Retry: exponential backoff on run_after, reset to queued.
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
      // Exhausted: permanently failed.
      getLogger().error(
        { jobId: claimed.id, type: claimed.type, attempts: nextAttempts, err },
        "job permanently failed",
      );
      await db.execute(
        sql`
          UPDATE job
          SET status = 'failed',
              last_error = ${msg},
              updated_at = now()
          WHERE id = ${claimed.id}
        `,
      );
    }
  }

  return true;
}
