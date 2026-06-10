/**
 * Portal data-hygiene purge entrypoint (www-q002.18). The api image ships this as
 * a second bundle (purge.js); the bosun cronJob "portal-data-purge" runs it once
 * a day as a one-shot Swarm job (`bun purge.js`) and it exits. NOT a worker loop
 * (PRD Backend rule 7) — bosun's scheduler owns the cadence.
 *
 * It reuses the same DATABASE_URL wiring as the api (env.ts builds it from the
 * mounted POSTGRES_PASSWORD secret), connects, runs one purge pass, logs the
 * per-table counts via @repo/logger, and closes the pool. A failure exits
 * non-zero so the job is recorded as failed (no silent swallow).
 */
import { createLogger } from "@repo/logger";
import { db, pool } from "./db/index";
import { purgePortalData } from "./services/portal-purge-service";

const log = createLogger({ service: "api" });

try {
  const counts = await purgePortalData(db);
  log.info({ ...counts }, "portal data purge complete");
  await pool.end();
} catch (err) {
  log.error({ err }, "portal data purge failed");
  await pool.end().catch(() => {});
  process.exit(1);
}
