/**
 * Worker runtime (www-7d5b.1.1). Owns scheduling and health for a set of Workers
 * so each worker only expresses its cadence + one cycle. Mirrors the
 * device-sync-service loop shape , an await-before-reschedule setTimeout per
 * worker so cycles never overlap, each run() wrapped in try/catch so one failing
 * cycle never kills its own loop or a sibling's , but generalizes it: stats are
 * accumulated per worker and exposed via stats().
 */
import type { Logger } from "@www/logger";
import type { Worker, WorkerRuntime, WorkerStats } from "./types";

// Mutable per-worker bookkeeping. Kept in a closure (no module-global state) so
// multiple runtimes can coexist (e.g. in tests).
interface WorkerState {
  worker: Worker;
  stats: WorkerStats;
  timer: ReturnType<typeof setTimeout> | null;
}

// How many cycles between periodic debug stats snapshots.
// At a 2s interval this fires roughly every 60s per worker without flooding logs.
const STATS_EVERY_N_RUNS = 30;

export type WorkerRuntimeOptions = {
  /** Structured logger bound to this process root (service: "media-worker"). */
  logger: Logger;
};

export function createWorkerRuntime(workers: Worker[], opts: WorkerRuntimeOptions): WorkerRuntime {
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
    // Bind the worker name once so every log line from this cycle carries it.
    const workerLog = logger.child({ worker: state.worker.name });
    const prevConsecutiveFailures = state.stats.consecutiveFailures;
    try {
      await state.worker.run();
      state.stats.consecutiveFailures = 0;
      state.stats.lastError = null;
      // Recovery transition: log when a previously failing worker clears its streak.
      if (prevConsecutiveFailures > 0) {
        workerLog.info({ clearedStreak: prevConsecutiveFailures }, "worker recovered");
      }
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      state.stats.consecutiveFailures += 1;
      state.stats.lastError = err instanceof Error ? err.message : String(err);
      // Failure-onset transition: distinct message when a healthy worker first fails.
      if (prevConsecutiveFailures === 0) {
        workerLog.error(
          { err, consecutiveFailures: state.stats.consecutiveFailures, durationMs },
          "worker entered failing state",
        );
      } else {
        // Ongoing failure: log every cycle so the streak stays visible in prod.
        workerLog.error(
          { err, consecutiveFailures: state.stats.consecutiveFailures, durationMs },
          "worker cycle failed",
        );
      }
    } finally {
      state.stats.totalRuns += 1;
      state.stats.lastRunAt = new Date();
      state.stats.lastDurationMs = Date.now() - startedAt;
      state.stats.memory = process.memoryUsage();
    }

    // Slow-cycle warning: this cycle took longer than its own configured interval.
    const lastDurationMs = state.stats.lastDurationMs ?? 0;
    if (lastDurationMs > state.worker.intervalMs) {
      workerLog.warn(
        {
          lastDurationMs,
          intervalMs: state.worker.intervalMs,
          ratio: Math.round((lastDurationMs / state.worker.intervalMs) * 100) / 100,
        },
        "worker cycle exceeded interval",
      );
    }

    // Periodic debug stats snapshot , roughly every ~60s, not every cycle.
    if (state.stats.totalRuns % STATS_EVERY_N_RUNS === 0) {
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

    // Re-check after the await: stop() may have fired during the cycle, in which
    // case we must NOT schedule another tick.
    if (!running) return;
    state.timer = setTimeout(() => void cycle(state), state.worker.intervalMs);
  };

  return {
    start() {
      if (running) return;
      running = true;
      // Log each worker registration so startup is fully observable.
      for (const state of states) {
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
      // Log which workers had a pending timer so operators can see what was
      // pre-empted by the shutdown signal.
      const withTimer = states.filter((s) => s.timer !== null).map((s) => s.worker.name);
      logger.info({ timersCleared: withTimer }, "worker runtime stopped");
      for (const state of states) {
        if (state.timer !== null) {
          clearTimeout(state.timer);
          state.timer = null;
        }
      }
      // Final stats snapshot per worker at shutdown for post-mortem.
      for (const state of states) {
        logger.info(
          {
            worker: state.worker.name,
            totalRuns: state.stats.totalRuns,
            consecutiveFailures: state.stats.consecutiveFailures,
            lastDurationMs: state.stats.lastDurationMs,
          },
          "worker final stats",
        );
      }
    },

    stats() {
      // Return shallow copies so callers can't mutate internal bookkeeping.
      return states.map((s) => ({ ...s.stats }));
    },
  };
}
