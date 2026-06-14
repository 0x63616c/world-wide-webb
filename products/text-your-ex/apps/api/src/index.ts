import { Hono } from "hono";
import { cors } from "hono/cors";
import { api, type Env } from "./api";
import { authMiddleware } from "./auth";
import { runMigrations } from "./db/migrate";
import { ensureSeed } from "./seed";

await runMigrations();
await ensureSeed(); // no-op in production (APP_ENV=production guard in ensureSeed)

const app = new Hono<Env>();

// Allow specific origins only; CORS is tightened in server.ts when that module lands.
app.use("*", cors());
app.use("/api/*", authMiddleware);
app.route("/api", api);

const port = Number(process.env.PORT ?? 8787);

export default { port, fetch: app.fetch };
