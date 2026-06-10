/**
 * Worker app entrypoint (www-xjba). No HTTP — this is its own deployable package
 * (@repo/worker) and its own image (control-center-worker), running the
 * continuous reconcile/ingest loops the api used to start in-process. Splitting
 * it out of apps/api keeps the api request-only and lets the loops build, ship,
 * scale, and restart on their own image (www-7d5b.1.2 promoted to a real app).
 *
 * The domain cycles (enforce lights/climate, sync fans, party, ingest weather)
 * still live in @repo/api and are imported via its ./worker barrel; this package
 * owns only the worker framework (runtime/types) and the job registry below —
 * which capability runs on what cadence. The eventual packages/core extraction
 * will dissolve the api dependency; until then this is the seam.
 */
import {
  env,
  reconcilePartyMode,
  runClimateEnforcerCycle,
  runDeviceSyncCycle,
  runEnforcerCycle,
  runMigrations,
  runSonosVolumeEnforcerCycle,
  runWeatherIngestCycle,
} from "@repo/api/worker";
import { createLogger } from "@repo/logger";
import { createWorkerRuntime } from "./runtime";
import type { Worker } from "./types";

const log = createLogger({ service: "worker" });

// Apply pending migrations before any cycle touches the DB. The api also runs
// this at boot; whichever wins is idempotent, and the worker must not poll a
// schema it hasn't migrated if it happens to start first.
try {
  await runMigrations();
  log.info("migrations done");
} catch (err) {
  log.error({ err }, "migrations failed");
  process.exit(1);
}

const workers: Worker[] = [
  {
    // DB-authoritative light enforcer (www-7d5b.2.6): reconciles desired→HA for the
    // managed lights every ~1s. The sole owner of light/switch reconcile now —
    // device-sync no longer touches them.
    name: "light-enforcer",
    intervalMs: 1_000,
    runOnStart: true,
    run: runEnforcerCycle,
  },
  {
    // DB-authoritative climate enforcer (www-unxz.2): reconciles desired→HA for the
    // single house thermostat every ~1s (enforce policy — the dashboard wins).
    // Writes real ambient/hvac_action into reportedState so getClimate reads the
    // DB row with no HA call.
    name: "climate-enforcer",
    intervalMs: 1_000,
    runOnStart: true,
    run: runClimateEnforcerCycle,
  },
  {
    // DB-authoritative Sonos volume enforcer (www-5mek): desiredState is truth,
    // the player is the actuator. Reconciles every ~1s — push inside the command
    // window, adopt external changes (Sonos app / hardware buttons) outside it.
    name: "sonos-volume-enforcer",
    intervalMs: 1_000,
    runOnStart: true,
    run: runSonosVolumeEnforcerCycle,
  },
  {
    // Fan-only since the cutover; lights moved to the enforcer above.
    name: "device-sync",
    intervalMs: 1_000,
    runOnStart: true,
    run: runDeviceSyncCycle,
  },
  {
    // Party-mode reconciler (www-7d5b.3.3): reads the lamp_mode DB row + lamp
    // on-state and starts/stops/restarts the in-process party animation engine.
    // DB-row-as-truth makes party durable across worker restarts (re-arms here).
    name: "party-mode",
    intervalMs: 2_000,
    runOnStart: true,
    run: reconcilePartyMode,
  },
  {
    name: "weather-ingest",
    intervalMs: 5 * 60_000,
    runOnStart: true,
    run: runWeatherIngestCycle,
  },
];

// Startup line: single unmistakable signal in docker service logs that the
// process booted and configured its logger. See docs/logging.md §6.
log.info({ workers: workers.map((w) => w.name), env: env.NODE_ENV }, "worker started");

const runtime = createWorkerRuntime(workers, { logger: log });
runtime.start();

// Graceful shutdown: stop scheduling new cycles so Swarm can replace the task
// without an in-flight reschedule racing the kill.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info({ signal }, "worker stopping");
    // Emit a final per-worker stats snapshot on shutdown so the last known
    // health state is captured in the log stream before the process exits.
    for (const s of runtime.stats()) {
      log.info(
        {
          worker: s.name,
          totalRuns: s.totalRuns,
          consecutiveFailures: s.consecutiveFailures,
          lastDurationMs: s.lastDurationMs,
          lastError: s.lastError,
        },
        "worker shutdown stats",
      );
    }
    runtime.stop();
    process.exit(0);
  });
}
