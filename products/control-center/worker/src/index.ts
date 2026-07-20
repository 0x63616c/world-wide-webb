/**
 * Worker app entrypoint (www-xjba). No HTTP , this is its own deployable package
 * (@control-center/worker) and its own image (control-center-worker), running the
 * continuous reconcile/ingest loops the api used to start in-process. Splitting
 * it out of products/control-center/api keeps the api request-only and lets the loops build, ship,
 * scale, and restart on their own image (www-7d5b.1.2 promoted to a real app).
 *
 * The domain cycles (enforce lights/climate, sync fans, party, ingest weather)
 * still live in @control-center/api and are imported via its ./worker barrel; this package
 * owns only the worker framework (runtime/types) and the job registry below ,
 * which capability runs on what cadence. The eventual packages/core extraction
 * will dissolve the api dependency; until then this is the seam.
 */
import {
  claimAndRun,
  env,
  reconcilePartyMode,
  registerNotifyHandler,
  registerYoutubeIngestHandler,
  runAscVersionPollCycle,
  runClimateEnforcerCycle,
  runDeviceSyncCycle,
  runEnforcerCycle,
  runGithubPollCycle,
  runMigrations,
  runPlaylistPollerCycle,
  runSonosVolumeEnforcerCycle,
  runWeatherIngestCycle,
} from "@control-center/api/worker";
import { createLogger } from "@www/logger";
import { createWorkerRuntime, type Worker } from "@www/worker-runtime";
import { hasSufficientDisk } from "./disk-guard";

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

// Job handlers must be registered synchronously before the runtime starts
// claiming. This process is the only queue consumer, so every handler is
// registered here.
registerNotifyHandler();
registerYoutubeIngestHandler();

const workers: Worker[] = [
  {
    // DB-authoritative light enforcer (www-7d5b.2.6): reconciles desired→HA for the
    // managed lights every ~1s. The sole owner of light/switch reconcile now ,
    // device-sync no longer touches them.
    name: "light-enforcer",
    intervalMs: 1_000,
    runOnStart: true,
    run: runEnforcerCycle,
  },
  {
    // DB-authoritative climate enforcer (www-unxz.2): reconciles desired→HA for the
    // single house thermostat every ~1s (enforce policy , the dashboard wins).
    // Writes real ambient/hvac_action into reportedState so getClimate reads the
    // DB row with no HA call.
    name: "climate-enforcer",
    intervalMs: 1_000,
    runOnStart: true,
    run: runClimateEnforcerCycle,
  },
  {
    // DB-authoritative Sonos volume enforcer (www-5mek): desiredState is truth,
    // the player is the actuator. Reconciles every ~1s , push inside the command
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
  {
    // GitHub Actions deploy poller (Deploys tile): 10s tick, but the cycle
    // self-gates to one real poll per 60s while no run is in flight, so idle
    // cost is ~60 req/hr and a deploy is picked up within 10s. A no-op when
    // GITHUB_ACTIONS_TOKEN is unset.
    name: "github-actions-poll",
    intervalMs: 10_000,
    runOnStart: true,
    run: runGithubPollCycle,
  },
  {
    // App Store Connect TestFlight-build poller: upserts the latest installable
    // shell build into asc_build_status so the board can show "update available".
    // 1/min is ~1.7% of ASC's 3600/hr budget; a no-op when ASC_* env is unset.
    name: "asc-version-poll",
    intervalMs: 60_000,
    runOnStart: true,
    run: runAscVersionPollCycle,
  },
  {
    // Durable job queue consumer: APNs fan-out (`notify`) and media ingest
    // (`youtube_ingest`).
    //
    // There is no type filter. media-worker used to own the queue while this
    // process claimed only `notify` to avoid stealing media jobs it had no
    // handler for; media-worker is now merged into this app, so one process
    // registers every handler and drains every type.
    name: "queue-worker",
    intervalMs: 2_000,
    runOnStart: true,
    run: async () => {
      // Check disk before claiming , a full NAS must not start a new download.
      // Guarding at the worker level applies it to every claim regardless of
      // handler. hasSufficientDisk emits the structured warn when space is low.
      if (!hasSufficientDisk(env.MEDIA_STORAGE_DIR)) {
        return;
      }
      await claimAndRun();
    },
  },
  {
    // Playlist poller: enumerate each enabled media_source via
    // yt-dlp --flat-playlist and enqueue ingest jobs for unseen video IDs.
    // Metadata only -- no video data -- so 2 minutes is ~720 requests/day from
    // one IP, well inside anything YouTube pushes back on. Going lower buys
    // little: the download itself dominates end-to-end latency.
    name: "playlist-poller",
    intervalMs: 2 * 60_000,
    runOnStart: true,
    run: runPlaylistPollerCycle,
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
    // stop() emits the final per-worker stats snapshot ("worker final stats")
    // so the last known health state is captured before the process exits.
    runtime.stop();
    process.exit(0);
  });
}
