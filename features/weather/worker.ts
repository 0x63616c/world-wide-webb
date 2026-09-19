import { defineWorkerCycles } from "@app-kit";
import { getLogger } from "@www/logger";
import { db } from "./db";
import { runWeatherIngestCycle } from "./ingest";
import { purgeWeatherData } from "./purge";

/**
 * Both weather tables are append-only (ingest inserts a fresh row per forecast
 * hour every cycle), so they need a retention sweep or they grow without bound.
 * The sweep is hourly rather than daily: a worker cycle's clock restarts with
 * the pod, so a 24h interval would skip its run on every deploy, and the sweep
 * is cheap when there is nothing past the cutoff (two DELETEs matching zero
 * rows). The batch caps in purge.ts bound the work of a catch-up run.
 */
async function runWeatherPurgeCycle(): Promise<void> {
  const counts = await purgeWeatherData(db);
  if (counts.readings > 0 || counts.dailyReadings > 0) {
    // Resolved per cycle, not at module scope: codegen imports this facet in a
    // plain bun process where the root logger was never created.
    getLogger().info(
      { worker: "weather-purge", ...counts },
      "weather retention purge removed rows",
    );
  }
}

export const cycles = defineWorkerCycles([
  {
    name: "weather-ingest",
    intervalMs: 5 * 60_000,
    runOnStart: true,
    run: runWeatherIngestCycle,
  },
  {
    name: "weather-purge",
    intervalMs: 60 * 60_000,
    runOnStart: true,
    run: runWeatherPurgeCycle,
  },
]);
