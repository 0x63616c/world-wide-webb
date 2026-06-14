/**
 * Worker runtime (www-7d5b.1.1). Owns scheduling and health for a set of Workers
 * so each worker only expresses its cadence + one cycle. Mirrors the
 * device-sync-service loop shape , an await-before-reschedule setTimeout per
 * worker so cycles never overlap, each run() wrapped in try/catch so one failing
 * cycle never kills its own loop or a sibling's , but generalizes it: stats are
 * accumulated per worker and exposed via stats().
 */
import type { Logger } from "@repo/logger";
import type { Worker, WorkerRuntime, WorkerStats } from "./types";

// Mutable per-worker bookkeeping. Kept in a closure (no module-global state) so
// multiple runtimes can coexist (e.g. in tests).
interface WorkerState {
  worker: Worker;
  stats: WorkerStats;
  timer: ReturnType<typeof setTimeout> | null;
}

// Emit a periodic stats snapshot every N runs. At debug level only , not
// every 1s cycle spam. ~60 cycles on the 1s workers, 12 on 5m weather-ingest.
const STATS_SNAPSHOT_INTERVAL = 60;

export function createWorkerRuntime(workers: Worker[], opts: { logger: Logger }): WorkerRuntime {
  const { logger } = opts;

  const seen = new Set<string>();
  for (const w of workers) {
    if (seen.has(w.name)) throw new Error(`Duplicate worker name: ${w.name}`);
    seen.add(w.name);
  }

  const states: WorkerState[] = workers.map((worker) => ({
    worker,
    timer: null,
    stats: {
      name: worker.name,
      lastRunAt: null,
      lastDurationMs: null,
      totalRuns: 0,
      consecutiveFailures: 0,
      lastError: null,
      memory: null,
    },
  }));

  let running = false;

  // One cycle: run(), record stats, then reschedule , but only if still running.
  // A failure is isolated (caught, recorded) so the loop and siblings continue.
  const cycle = async (state: WorkerState): Promise<void> => {
    if (!running) return;
    const startedAt = Date.now();
    // Bind per-worker context once so every log line from this cycle carries it.
    const workerLog = logger.child({ worker: state.worker.name });
    // Track the failure streak before this cycle so we can detect transitions.
    const prevFailures = state.stats.consecutiveFailures;

    try {
      await state.worker.run();

      // Recovery transition: the streak just ended , log the onset so the
      // exact recovery is greppable (not logged every healthy cycle).
      if (prevFailures > 0) {
        workerLog.info({ consecutiveFailures: prevFailures }, "worker recovered");
      }

      state.stats.consecutiveFailures = 0;
      state.stats.lastError = null;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      state.stats.consecutiveFailures += 1;
      state.stats.lastError = err instanceof Error ? err.message : String(err);

      // Every failing cycle is logged so the failure is visible in stdout, not
      // buried in the invisible in-memory stats() (the bug this fixes).
      workerLog.error(
        { err, consecutiveFailures: state.stats.consecutiveFailures, durationMs },
        "worker cycle failed",
      );

      // Failure-onset transition: first failure after a clean streak. Logged as
      // a distinct line so the exact onset is greppable separate from the
      // repeated per-cycle error above.
      if (prevFailures === 0) {
        workerLog.error(
          { consecutiveFailures: state.stats.consecutiveFailures },
          "worker entered failing state",
        );
      }
    } finally {
      state.stats.totalRuns += 1;
      state.stats.lastRunAt = new Date();
      state.stats.lastDurationMs = Date.now() - startedAt;
      state.stats.memory = process.memoryUsage();
    }

    // Periodic stats snapshot at debug level , not every cycle (1s would spam).
    if (state.stats.totalRuns % STATS_SNAPSHOT_INTERVAL === 0) {
      workerLog.debug(
        {
          totalRuns: state.stats.totalRuns,
          consecutiveFailures: state.stats.consecutiveFailures,
          lastDurationMs: state.stats.lastDurationMs,
          rss: state.stats.memory?.rss,
          heapUsed: state.stats.memory?.heapUsed,
        },
        "worker stats snapshot",
      );
    }

    // Slow-cycle warning: this cycle took longer than its own interval, which
    // means the next cycle is already overdue before it starts.
    if (
      state.stats.lastDurationMs !== null &&
      state.stats.lastDurationMs > state.worker.intervalMs
    ) {
      workerLog.warn(
        {
          lastDurationMs: state.stats.lastDurationMs,
          intervalMs: state.worker.intervalMs,
          ratio: state.stats.lastDurationMs / state.worker.intervalMs,
        },
        "worker cycle exceeded interval",
      );
    }

    // Re-check after the await: stop() may have fired during the cycle, in which
    // case we must NOT schedule another tick.
    if (!running) return;
    state.timer = setTimeout(() => void cycle(state), state.worker.intervalMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      for (const state of states) {
        // Log each registered worker at startup so the operator can see exactly
        // which loops are active and their cadences.
        logger.info(
          {
            worker: state.worker.name,
            intervalMs: state.worker.intervalMs,
            runOnStart: state.worker.runOnStart ?? false,
          },
          "worker registered",
        );

        if (state.worker.runOnStart) {
          void cycle(state);
        } else {
          state.timer = setTimeout(() => void cycle(state), state.worker.intervalMs);
        }
      }
    },

    stop() {
      running = false;
      // Log which workers still had a pending timer at shutdown , useful for
      // diagnosing whether a cycle was in-flight vs waiting for its interval.
      const withTimer = states.filter((s) => s.timer !== null).map((s) => s.worker.name);
      logger.info({ timersCleared: withTimer }, "worker runtime stopped");

      for (const state of states) {
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
      }
    },

    stats() {
      // Return shallow copies so callers can't mutate internal bookkeeping.
      return states.map((s) => ({ ...s.stats }));
    },
  };
}
