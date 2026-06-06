import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { getClimate } from "./services/climate-service";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/routers/index";

// Deploys reach this box automatically: push to main -> CI builds the image ->
// CI POSTs the bosun-agent webhook -> `bosun up` rolls the service (CC-a8p).
//
// Apply pending SQL migrations before accepting traffic. Uses drizzle-orm's
// runtime migrator (not drizzle-kit), so the production image ships no build
// toolchain. A failure throws and exits non-zero; Swarm crash-backoff retries
// until postgres is reachable and migrated.
await runMigrations();

// CORS for the Vite dev server (web on :4200). In production the api serves the
// built web bundle from the same origin, so these are dev conveniences.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Routes a single request. Wrapped by fetch() below, which logs every call.
async function handle(req: Request, url: URL): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (url.pathname === "/up") {
    return new Response("OK", { status: 200, headers: CORS_HEADERS });
  }

  // Deploy-health probe target (CC-hya3). Bosun's `verify` curls this to prove
  // the api can reach live Home Assistant, decoupled from the tRPC wire format so
  // a procedure rename can't silently turn the probe advisory-red (which is how
  // the old /api/climate.now probe rotted). getClimate() throws on an HA outage
  // or misconfig (services-throw convention), surfacing as a 500 -> red probe.
  if (url.pathname === "/health/climate") {
    const { ambient } = await getClimate();
    return Response.json({ ambient }, { status: 200, headers: CORS_HEADERS });
  }

  if (url.pathname.startsWith("/trpc")) {
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => createContext(),
      onError: ({ path, error }) => {
        console.error(`tRPC error on ${path ?? "<unknown>"}: ${error.message}`);
      },
    });
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
}

const server = Bun.serve({
  port: env.PORT,
  async fetch(req) {
    const url = new URL(req.url);
    // Single chokepoint: every network request (OPTIONS, /up, /trpc, 404)
    // routes through handle(), so logging here captures all of them with
    // method, path, status, and wall-clock duration.
    const startedAt = performance.now();
    let res: Response;
    try {
      res = await handle(req, url);
    } catch (error) {
      const ms = (performance.now() - startedAt).toFixed(1);
      console.error(`${req.method} ${url.pathname} -> 500 (${ms}ms)`, error);
      throw error;
    }
    const ms = (performance.now() - startedAt).toFixed(1);
    // warn, not info: biome's noConsole allows only error/warn, and the startup
    // log below already uses warn for server-side informational output.
    console.warn(`${req.method} ${url.pathname}${url.search} -> ${res.status} (${ms}ms)`);
    return res;
  },
});

console.warn(`API started on port ${server.port} (env=${env.NODE_ENV})`);

// The api is request-only (CC-7d5b.1.2). The device-sync and weather-ingest
// loops now run in the dedicated worker process (src/worker.ts), so the api no
// longer starts them in-process.
