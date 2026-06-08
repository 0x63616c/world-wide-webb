/**
 * Worker runtime (www-7d5b.1.1). Owns scheduling and health for a set of Workers
 * so each worker only expresses its cadence + one cycle. Mirrors the
 * device-sync-service loop shape — an await-before-reschedule setTimeout per
 * worker so cycles never overlap, each run() wrapped in try/catch so one failing
 * cycle never kills its own loop or a sibling's — but generalizes it: stats are
 * accumulated per worker and exposed via stats().
 */
import type { Worker, WorkerRuntime, WorkerStats } from "./types";

// Mutable per-worker bookkeeping. Kept in a closure (no module-global state) so
// multiple runtimes can coexist (e.g. in tests).
interface WorkerState {
  worker: Worker;
  stats: WorkerStats;
  timer: ReturnType<typeof setTimeout> | null;
}

export function createWorkerRuntime(workers: Worker[]): WorkerRuntime {
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

  // One cycle: run(), record stats, then reschedule — but only if still running.
  // A failure is isolated (caught, recorded) so the loop and siblings continue.
  const cycle = async (state: WorkerState): Promise<void> => {
    if (!running) return;
    const startedAt = Date.now();
    try {
      await state.worker.run();
      state.stats.consecutiveFailures = 0;
      state.stats.lastError = null;
    } catch (err) {
      state.stats.consecutiveFailures += 1;
      state.stats.lastError = err instanceof Error ? err.message : String(err);
    } finally {
      state.stats.totalRuns += 1;
      state.stats.lastRunAt = new Date();
      state.stats.lastDurationMs = Date.now() - startedAt;
      state.stats.memory = process.memoryUsage();
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
        if (state.worker.runOnStart) {
          void cycle(state);
        } else {
          state.timer = setTimeout(() => void cycle(state), state.worker.intervalMs);
        }
      }
    },

    stop() {
      running = false;
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
