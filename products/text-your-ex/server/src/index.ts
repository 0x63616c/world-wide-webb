import { existsSync } from "node:fs";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { api, type Env } from "./api";
import { authMiddleware } from "./auth";
import { initSchema } from "./db";
import { ensureSeed } from "./seed";

initSchema();
ensureSeed(); // idempotent: seeds demo data on first boot

const app = new Hono<Env>();

app.use("*", cors());
app.use("/api/*", authMiddleware);
app.route("/api", api);

// In production, serve the built web app.
const WEB_DIST = new URL("../../web/dist", import.meta.url).pathname;
if (existsSync(WEB_DIST)) {
  app.use("/*", serveStatic({ root: WEB_DIST }));
  // SPA fallback
  app.get("*", serveStatic({ path: "index.html", root: WEB_DIST }));
}

const port = Number(process.env.PORT ?? 8787);
console.log(`[tye] server listening on http://localhost:${port}`);

export default { port, fetch: app.fetch };
