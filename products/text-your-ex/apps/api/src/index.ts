import { runMigrations } from "./db/migrate";
import { ensureSeed } from "./seed";
import { buildApp } from "./server";

await runMigrations();
await ensureSeed(); // no-op in production (APP_ENV=production guard in ensureSeed)

const app = buildApp();

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch };
