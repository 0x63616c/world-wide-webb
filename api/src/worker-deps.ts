/**
 * Barrel of everything the worker app (@control-center/worker) needs from the api domain
 * (www-xjba). The worker package owns the scheduling framework + job registry;
 * the actual reconcile/ingest cycles, the env, and the migrator still live here
 * and are re-exported through the `@control-center/api/worker` subpath so products/control-center/worker has a
 * single, explicit import surface rather than reaching into internal paths.
 *
 * There is one barrel because there is one worker app: since media-worker was
 * folded into worker, that single process owns every loop and every job type ,
 * the home-control enforcers, the pollers, and the whole durable queue. Job
 * handlers are plain exported functions the entrypoint passes into jobWorker,
 * so what runs is readable at the call site rather than hidden in a registry.
 *
 * Interim: this barrel is the documented seam between worker and api. The planned
 * packages/core extraction (shared domain) will move these out of products/control-center/api and
 * delete this file; until then, keep the export surface minimal.
 */
export { runMigrations } from "./db/migrate";
export { env } from "./env";
// Durable job queue. Each type is wrapped as its own Worker at the entrypoint.
export { type JobSpec, jobWorker, staleJobReaper } from "./jobs/job-worker";
// Graceful shutdown: hand claimed rows back to `queued` instead of stranding
// them at `running` until the reaper's lease expires.
export { releaseInFlightJobsWithTimeout } from "./jobs/queue";
export { runAscVersionPollCycle } from "./services/asc-version-service";
export { runClimateEnforcerCycle } from "./services/climate-enforcer-service";
export { runDeviceSyncCycle } from "./services/device-sync-service";
export { runGithubPollCycle } from "./services/github-actions-service";
export { runEnforcerCycle } from "./services/light-enforcer-service";
export { runNotifyJob } from "./services/notification-service";
export { reconcilePartyMode } from "./services/party-service";
export { runPlaylistPollerCycle } from "./services/playlist-poller-service";
export { runSonosVolumeEnforcerCycle } from "./services/sonos-volume-enforcer-service";
export { runWeatherIngestCycle } from "./services/weather-ingest-service";
export { runWeightIngestCycle } from "./services/weight-service";
export { runYoutubeIngest } from "./services/youtube-ingest-service";
