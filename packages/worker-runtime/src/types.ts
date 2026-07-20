/**
 * Uniform worker abstraction. A Worker is a named interval loop with a single
 * async cycle; the runtime owns scheduling, failure isolation, and stats so each
 * worker (device-sync, weather-ingest, party engine, the light enforcer) only has
 * to express its cadence and one cycle, not its own setTimeout/try-catch plumbing
 * (www-7d5b.1.1).
 */
export interface Worker {
  /** Stable identifier, used as the stats key. Must be unique within a runtime. */
  name: string;
  /** Delay between the end of one cycle and the start of the next. */
  intervalMs: number;
  /** Run a cycle immediately on start instead of waiting one interval first. */
  runOnStart?: boolean;
  /** One reconcile/ingest cycle. The runtime wraps this; it may throw. */
  run(): Promise<void>;
}

/** Per-worker health/telemetry, tracked internally for failure streaks and the debug snapshot. */
export interface WorkerStats {
  name: string;
  /** Wall-clock time the last cycle finished (success OR failure), null until first run. */
  lastRunAt: Date | null;
  /** Duration of the last cycle in ms, null until first run. */
  lastDurationMs: number | null;
  /** Total cycles attempted (success + failure). */
  totalRuns: number;
  /** Streak of failures since the last success; reset to 0 on any success. */
  consecutiveFailures: number;
  /** Message from the last failing cycle; null after a success. */
  lastError: string | null;
}

/** Handle returned by createWorkerRuntime: lifecycle only. */
export interface WorkerRuntime {
  start(): void;
  stop(): void;
}
