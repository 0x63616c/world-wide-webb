/**
 * Data-hygiene purge entrypoint (www-q002.18). The api image ships this as
 * a second bundle (purge.js); the "portal-data-purge" CronJob runs it once
 * a day as a one-shot job (`bun purge.js`) and it exits. NOT a worker loop
 * (PRD Backend rule 7), the scheduler owns the cadence.
 *
 * It runs every retention purge the control-center owns:
 *  - portal: authorizations expired more than 90 days ago.
 *  - weather: readings recorded more than 30 days ago (both weather tables).
 *  - frontend logs: entries captured more than 30 days ago.
 *
 * The CronJob keeps its original "portal-data-purge" name so the existing
 * Kubernetes object isn't orphaned, even though it is no longer portal-only.
 *
 * It reuses the same DATABASE_URL wiring as the api (env.ts builds it from the
 * mounted POSTGRES_PASSWORD secret), connects, runs one pass of each purge, logs
 * the per-table counts via @www/logger, and closes the pool. A failure exits
 * non-zero so the job is recorded as failed (no silent swallow).
 */
import { createLogger } from "@www/logger";
import { db, pool } from "./db/index";
import { purgeFrontendLogs } from "./services/frontend-log-purge-service";
import { purgePortalData } from "./services/portal-purge-service";
import { purgeWeatherData } from "./services/weather-purge-service";

const log = createLogger({ service: "api" });

try {
  const portal = await purgePortalData(db);
  const weather = await purgeWeatherData(db);
  const frontendLogs = await purgeFrontendLogs(db);
  log.info({ ...portal, ...weather, frontendLogs: frontendLogs.logs }, "data purge complete");
  if (weather.truncated) {
    log.warn({}, "weather purge hit its batch cap; a backlog remains for the next run");
  }
  if (frontendLogs.truncated) {
    log.warn({}, "frontend-log purge hit its batch cap; a backlog remains for the next run");
  }
  await pool.end();
} catch (err) {
  log.error({ err }, "data purge failed");
  await pool.end().catch(() => {});
  process.exit(1);
}
