/**
 * Worker process entrypoint (www-7d5b.1.2). No HTTP — this is a separate swarm
 * service (same image as the api) that runs the continuous reconcile/ingest
 * loops the api used to start in-process. Splitting them out keeps the api
 * request-only and lets the loops scale/restart independently.
 *
 * Each loop is expressed as a Worker (name + interval + one cycle); the runtime
 * owns scheduling, failure isolation, and stats. Cycles reuse the existing
 * single-cycle functions (runDeviceSyncCycle, runWeatherIngestCycle) — the old
 * bespoke startX setTimeout wrappers are gone.
 */
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { runDeviceSyncCycle } from "./services/device-sync-service";
import { runEnforcerCycle } from "./services/light-enforcer-service";
import { reconcilePartyMode } from "./services/party-service";
import { runWeatherIngestCycle } from "./services/weather-ingest-service";
import { createWorkerRuntime } from "./worker/runtime";
import type { Worker } from "./worker/types";

// Apply pending migrations before any cycle touches the DB. The api also runs
// this at boot; whichever wins is idempotent, and the worker must not poll a
// schema it hasn't migrated if it happens to start first.
await runMigrations();

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
    run: () => reconcilePartyMode(),
  },
  {
    name: "weather-ingest",
    intervalMs: 5 * 60_000,
    runOnStart: true,
    run: runWeatherIngestCycle,
  },
];

const runtime = createWorkerRuntime(workers);
runtime.start();

console.warn(
  `Worker started (env=${env.NODE_ENV}); workers: ${workers.map((w) => w.name).join(", ")}`,
);

// Graceful shutdown: stop scheduling new cycles so Swarm can replace the task
// without an in-flight reschedule racing the kill.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.warn(`Worker received ${signal}; stopping runtime`);
    runtime.stop();
    process.exit(0);
  });
}
