import { createContext } from "@control-center/api/trpc-context";
import { createLogger } from "@repo/logger";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { captivePortalApiRouter } from "./router";

const log = createLogger({ service: "captive-portal-api" });

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function portFromEnv(): number {
  const raw = Bun.env.PORT ?? "4211";
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT for captive portal API: ${raw}`);
  }
  return port;
}

async function handle(req: Request, url: URL): Promise<Response> {
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
      router: captivePortalApiRouter,
      createContext: () => createContext(),
      onError: ({ path, error, req: errorReq }) => {
        const reqUrl = new URL(errorReq.url);
        log
          .child({ method: errorReq.method, path: reqUrl.pathname })
          .error({ err: error, trpcPath: path ?? "<unknown>" }, "captive portal trpc error");
      },
    });
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
}

const server = Bun.serve({
  port: portFromEnv(),
  async fetch(req) {
    const url = new URL(req.url);
    const startedAt = performance.now();
    const reqId = `req_${Math.random().toString(36).slice(2, 10)}`;
    const reqLog = log.child({ reqId, method: req.method, path: url.pathname });

    let res: Response;
    try {
      res = await handle(req, url);
    } catch (err) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      reqLog.error({ err, status: 500, durationMs }, "captive portal request failed");
      throw err;
    }

    const durationMs = +(performance.now() - startedAt).toFixed(1);
    if (req.method === "OPTIONS") {
      reqLog.debug({ status: res.status, durationMs }, "captive portal request completed");
    } else {
      reqLog.info({ status: res.status, durationMs }, "captive portal request completed");
    }
    return res;
  },
});

log.info({ port: server.port }, "captive portal api started");
