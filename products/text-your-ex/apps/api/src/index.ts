import { runMigrations } from "./db/migrate";
import { requireDatabaseUrl } from "./env";
import { ensureSeed, resetAndSeed } from "./seed";
import { buildApp } from "./server";

// Fail fast at boot if the database is not configured (buildDatabaseUrl returns
// undefined rather than throwing so the db layer can be imported in unit tests).
requireDatabaseUrl();

await runMigrations();
// TYE_RESET=1 forces a clean reseed at boot (e2e). Otherwise seed only if empty.
// Both paths are no-ops in production (guarded in seed / ensureSeed).
if (process.env.TYE_RESET === "1" && process.env.APP_ENV !== "production") {
  await resetAndSeed();
} else {
  await ensureSeed();
}

const app = buildApp();

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch };
