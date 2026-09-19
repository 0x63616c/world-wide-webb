/**
 * Worker app entrypoint (www-xjba). No HTTP , this is its own deployable package
 * (@control-center/worker) and its own image (control-center-worker), running the
 * continuous reconcile/ingest loops the api used to start in-process. Splitting
 * it out of api keeps the api request-only and lets the loops build, ship,
 * scale, and restart on their own image (www-7d5b.1.2 promoted to a real app).
 *
 * Apps own domain cycles and cadence in features/<id>/worker.ts. Codegen folds
 * those facets into workers.gen.ts; this package owns process lifecycle,
 * migrations, metrics, and graceful shutdown.
 *
 * There is no durable job queue any more (The Simplification §3). Every piece of
 * scheduled work this process runs is a declared cycle with a fixed interval, so
 * there is nothing to claim, lease, reap or hand back on shutdown.
 */
import "./boot-env";
import { runMigrations } from "@control-center/api/worker";
import { GENERATED_WORKERS } from "@features/_generated/workers.gen";
import { createLogger, installFatalHandlers } from "@www/logger";
import { ENV as config } from "@www/platform/env";
import { initMetrics, startMetricsServer } from "@www/platform/metrics";
import { createWorkerRuntime, type Worker } from "@www/worker-runtime";

const log = createLogger({ service: "worker" });

// An escaping async throw or an untracked rejected promise otherwise kills
// this process with zero structured output; see docs/logging.md.
installFatalHandlers(log);

// Prometheus registry + exposition listener (#214). The worker serves no HTTP
// of its own, so this dedicated port is the ONLY listener it has; it fronts no
// Kubernetes Service (Prometheus scrapes the pod IP off the annotations set by
// `WorkloadSpec.scrape`), so it is reachable in-cluster only and never through
// the Cloudflare tunnel. Started before the loops so the very first cycle's
// metrics are already collectable.
initMetrics({ service: "worker" });
startMetricsServer({ port: config.METRICS_PORT, logger: log });

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

const workers: Worker[] = [...GENERATED_WORKERS];

// Startup line: single unmistakable signal in the pod logs that the process
// booted and configured its logger. See docs/logging.md §6.
log.info({ workers: workers.map((w) => w.name), env: config.NODE_ENV }, "worker started");

const runtime = createWorkerRuntime(workers, { logger: log });
runtime.start();

// Graceful shutdown: stop scheduling new cycles so the orchestrator can replace
// the pod without an in-flight reschedule racing the kill. stop() emits the
// final per-worker stats snapshot ("worker final stats"), so the last known
// health state is captured before the process exits.
let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    // A second signal during the shutdown window must not restart the sequence.
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, "worker stopping");
    runtime.stop();
    log.info({ signal }, "worker stopped");
    process.exit(0);
  });
}
