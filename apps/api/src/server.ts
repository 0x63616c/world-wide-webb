import { createLogger } from "@repo/logger";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { runMigrations } from "./db/migrate";
import { env } from "./env";
import { getTvArtwork } from "./services/apple-tv-service";
import { getClimate } from "./services/climate-service";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/routers/index";

// Root logger — created ONCE at process startup, bound to every line in this
// process. Domain services use getLogger() (see docs/logging.md §2).
const log = createLogger({ service: "api" });

// Deploys reach this box automatically: push to main -> CI builds the image ->
// CI POSTs the bosun-agent webhook -> `bosun up` rolls the service (CC-a8p).
//
// Apply pending SQL migrations before accepting traffic. Uses drizzle-orm's
// runtime migrator (not drizzle-kit), so the production image ships no build
// toolchain. runMigrations() logs start/done internally; we only need to
// surface the error here (it rethrows, so Swarm crash-backoff retries until
// postgres is reachable and migrated).
try {
  await runMigrations();
} catch (err) {
  log.error({ err }, "migrations failed");
  throw err;
}

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

  // Now-playing artwork proxy (CC-dhhr). The panel can't reach HA and the
  // entity_picture URL embeds an HA token, so the api streams the bytes.
  if (url.pathname === "/media/tv-artwork") {
    const artwork = await getTvArtwork();
    if (!artwork) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    return new Response(artwork.body, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": artwork.headers.get("content-type") ?? "application/octet-stream",
        // The ?v= param busts on artwork change, so short caching is safe.
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  if (url.pathname.startsWith("/trpc")) {
    const res = await fetchRequestHandler({
      endpoint: "/trpc",
      req,
      router: appRouter,
      createContext: () => createContext(),
      onError: ({ path, error, req: errorReq }) => {
        // Build the child logger inline — path is available here but reqId comes
        // from the outer fetch scope, so we log with path + code directly.
        const reqUrl = new URL(errorReq.url);
        const reqLog = log.child({ method: errorReq.method, path: reqUrl.pathname });
        reqLog.error({ err: error, trpcPath: path ?? "<unknown>" }, "trpc error");
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
    // Bind a per-request child logger with a unique request id so every log
    // line for this request carries the same correlation fields.
    const reqId = `req_${Math.random().toString(36).slice(2, 10)}`;
    const reqLog = log.child({ reqId, method: req.method, path: url.pathname });

    let res: Response;
    try {
      res = await handle(req, url);
    } catch (err) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      reqLog.error({ err, status: 500, durationMs }, "request failed");
      throw err;
    }

    const durationMs = +(performance.now() - startedAt).toFixed(1);
    // OPTIONS preflights are transport noise — log at debug so they don't
    // double the info line count in steady state (docs/logging.md §6).
    if (req.method === "OPTIONS") {
      reqLog.debug({ status: res.status, durationMs }, "request completed");
    } else {
      reqLog.info({ status: res.status, durationMs }, "request completed");
    }
    return res;
  },
});

// Startup liveness line (docs/logging.md §6): "api started" with port + env
// is the operator's first grep after a deploy.
log.info({ port: server.port, env: env.NODE_ENV }, "api started");

// The api is request-only (CC-7d5b.1.2). The device-sync and weather-ingest
// loops now run in the dedicated worker process (src/worker.ts), so the api no
// longer starts them in-process.
