import { runMigrations } from "./db/migrate";
import { requireDatabaseUrl } from "./env";
import { ensureSeed } from "./seed";
import { buildApp } from "./server";

// Fail fast at boot if the database is not configured (buildDatabaseUrl returns
// undefined rather than throwing so the db layer can be imported in unit tests).
requireDatabaseUrl();

await runMigrations();
await ensureSeed(); // no-op in production (APP_ENV=production guard in ensureSeed)

const app = buildApp();

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch };
