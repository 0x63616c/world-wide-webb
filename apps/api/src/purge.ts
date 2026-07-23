/**
 * Data-hygiene purge entrypoint (www-q002.18). The api image ships this as
 * a second bundle (purge.js); the "portal-data-purge" CronJob runs it once
 * a day as a one-shot job (`bun purge.js`) and it exits. NOT a worker loop
 * (PRD Backend rule 7), the scheduler owns the cadence.
 *
 * It runs every retention purge the control-center owns that hasn't yet moved
 * onto the S2 cron seam:
 *  - wake photos: burst frames captured more than 90 days ago (row + file).
 *
 * The portal purge moved onto the S2 cron seam (see
 * `features/guest-wifi/jobs.ts`'s `purgeCron`, run by the `guest-wifi-purge` k8s
 * CronJob via `bun cron.js guest-wifi-purge`); the weather purge moved the same
 * way (`features/weather/jobs.ts`'s `purgeCron`, `weather-purge` CronJob); the
 * frontend-log purge moved the same way too (`features/felogs/jobs.ts`'s
 * `purgeCron`, `felogs-purge` CronJob). The CronJob that runs THIS bundle keeps
 * its original "portal-data-purge" name so the existing Kubernetes object isn't
 * orphaned, even though it is no longer portal-only.
 *
 * It reuses the same DATABASE_URL wiring as the api (env.ts builds it from the
 * mounted POSTGRES_PASSWORD secret), connects, runs one pass of each purge, logs
 * the per-table counts via @www/logger, and closes the pool. A failure exits
 * non-zero so the job is recorded as failed (no silent swallow).
 */
import { createLogger } from "@www/logger";
import { db, pool } from "./db/index";
import { purgeGithubRuns } from "./services/github-purge-service";
import { purgeWakePhotos } from "./services/wake-photo-purge-service";

const log = createLogger({ service: "api" });

try {
  const wakePhotos = await purgeWakePhotos(db);
  const github = await purgeGithubRuns(db);
  log.info(
    {
      wakePhotos: wakePhotos.photos,
      githubRuns: github.runs,
      githubLogTails: github.logTails,
    },
    "data purge complete",
  );
  if (wakePhotos.truncated) {
    log.warn({}, "wake-photo purge hit its batch cap; a backlog remains for the next run");
  }
  await pool.end();
} catch (err) {
  log.error({ err }, "data purge failed");
  await pool.end().catch(() => {});
  process.exit(1);
}
