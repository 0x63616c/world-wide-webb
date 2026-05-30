import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { env } from "./env";
import { startDeviceSyncService } from "./services/device-sync-service";
import { createContext } from "./trpc/context";
import { appRouter } from "./trpc/routers/index";

// CORS for the Vite dev server (web on :4200). In production the api serves the
// built web bundle from the same origin, so these are dev conveniences.
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = Bun.serve({
  port: env.PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/up") {
      return new Response("OK", { status: 200, headers: CORS_HEADERS });
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
  },
});

console.warn(`API started on port ${server.port} (env=${env.NODE_ENV})`);

// Start the device sync service after the server is ready.
// Polls HA every 1s to reconcile desired/reported state.
startDeviceSyncService();
