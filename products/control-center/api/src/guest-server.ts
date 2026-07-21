import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { createLogger, type Logger } from "@www/logger";
import { createContext } from "./trpc/context";
import { guestRouter } from "./trpc/guest-router";

// Structural security boundary (ADR-0006): this is the ONLY listener
// unauthenticated LAN guests (the WiFi captive-portal network) ever reach. It
// mounts exactly `guestRouter` (portal.* only, see trpc/guest-router.ts), never
// the full `appRouter`, so no other tRPC procedure is ever reachable through
// GUEST_PORT no matter what path or batch shape a client sends.

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Minimal extension -> content-type map for the guest SPA bundle (Vite output:
// html/js/css/json/images/fonts). Anything unrecognised falls back to
// octet-stream , this is a static asset server, not a general file host.
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function contentTypeFor(path: string): string {
  return CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export interface StartGuestServerOptions {
  /** TLS port. A plain-HTTP companion is also started on port + 1. */
  port: number;
  /** Directory holding fullchain.pem + key.pem (cert-manager projection). Omit for plain HTTP only. */
  tlsDir?: string;
  /** Built guest web bundle (SPA) to serve static files from. */
  staticDir: string;
  logger?: Logger;
}

export interface GuestServer {
  /** The TLS (or, if tlsDir is unset, plain) listener port. */
  port: number;
  /** The always-plain-HTTP companion listener port (port + 1), for captive-portal OS detection probes. */
  httpPort: number;
  stop(): void;
}

// Resolves a URL pathname to a file under staticDir, refusing to escape it
// (guest-facing, so directory traversal is a required-blocked case, not just a
// nicety). Returns null if the decoded/resolved path would land outside
// staticDir.
function resolveStaticPath(staticDir: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const root = resolve(staticDir);
  const candidate = resolve(root, `.${decoded}`);
  if (candidate !== root && !candidate.startsWith(root + sep)) {
    return null;
  }
  return candidate;
}

async function readIfExists(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

async function serveStatic(staticDir: string, pathname: string): Promise<Response> {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolveStaticPath(staticDir, requested);
  if (filePath === null) {
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  }

  let body = await readIfExists(filePath);
  let servedPath = filePath;
  if (body === null) {
    // SPA fallback: any unmatched path (a client-side route, or a traversal
    // attempt that resolved to nothing) serves index.html, never a directory
    // listing or a bubbled-up filesystem error.
    const fallback = resolveStaticPath(staticDir, "/index.html");
    if (fallback === null) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
    body = await readIfExists(fallback);
    servedPath = fallback;
    if (body === null) {
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    }
  }

  return new Response(new Uint8Array(body), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": contentTypeFor(servedPath) },
  });
}

/**
 * Builds the guest routing logic as a pure `Request -> Response` function:
 * `/up`, `/trpc/portal.*` (portal-only, via guestRouter), and static files
 * from `staticDir` with SPA fallback + traversal guard. Deliberately has no
 * dependency on any particular listener (Bun.serve, node:http, tests) , this
 * is what `startGuestServer` binds to a real port, and what unit tests call
 * directly with a constructed `Request` to verify routing/security behaviour
 * without needing a real socket.
 */
export function createGuestFetchHandler(opts: {
  staticDir: string;
  logger: Logger;
}): (req: Request) => Promise<Response> {
  const { staticDir, logger: log } = opts;

  return async function handle(req: Request): Promise<Response> {
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
        router: guestRouter,
        createContext: () => createContext(),
        onError: ({ path, error, req: errorReq }) => {
          const reqUrl = new URL(errorReq.url);
          log
            .child({ method: errorReq.method, path: reqUrl.pathname })
            .error({ err: error, trpcPath: path ?? "<unknown>" }, "guest trpc error");
        },
      });
      for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
      return res;
    }

    return serveStatic(staticDir, url.pathname);
  };
}

function withRequestLogging(
  handle: (req: Request) => Promise<Response>,
  log: Logger,
  listener: string,
): (req: Request) => Promise<Response> {
  return async function fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const startedAt = performance.now();
    const reqId = `req_${Math.random().toString(36).slice(2, 10)}`;
    const reqLog = log.child({ reqId, method: req.method, path: url.pathname, listener });

    let res: Response;
    try {
      res = await handle(req);
    } catch (err) {
      const durationMs = +(performance.now() - startedAt).toFixed(1);
      reqLog.error({ err, status: 500, durationMs }, "guest request failed");
      throw err;
    }

    const durationMs = +(performance.now() - startedAt).toFixed(1);
    if (req.method === "OPTIONS") {
      reqLog.debug({ status: res.status, durationMs }, "guest request completed");
    } else {
      reqLog.info({ status: res.status, durationMs }, "guest request completed");
    }
    return res;
  };
}

/**
 * Starts the guest (captive-portal) HTTP surface via `Bun.serve`: `/up`,
 * `/trpc/portal.*`, and static files from `staticDir` with SPA fallback (see
 * `createGuestFetchHandler`). TLS on `port` when `tlsDir` is set (reading
 * fullchain.pem + key.pem, the cert-manager secret projection the old nginx
 * portal used); ALWAYS also starts a plain-HTTP companion on `port + 1` for
 * captive-portal OS detection probes, which must not hit a TLS handshake or
 * cert prompt to decide whether the network is "captive".
 *
 * Runs only under the Bun runtime (production/dev, via `bun src/server.ts`).
 * Routing/security behaviour is unit-tested via `createGuestFetchHandler`
 * directly, which needs no real socket and no Bun-specific API.
 */
export function startGuestServer(opts: StartGuestServerOptions): GuestServer {
  const log = opts.logger ?? createLogger({ service: "guest-api" });
  const handle = createGuestFetchHandler({ staticDir: opts.staticDir, logger: log });
  const fetch = withRequestLogging(handle, log, "guest");
  const httpFetch = withRequestLogging(handle, log, "guest-http");

  const tls = opts.tlsDir
    ? {
        cert: Bun.file(`${opts.tlsDir}/fullchain.pem`),
        key: Bun.file(`${opts.tlsDir}/key.pem`),
      }
    : undefined;

  const mainServer = Bun.serve({
    port: opts.port,
    ...(tls ? { tls } : {}),
    fetch,
  });

  const httpServer = Bun.serve({
    port: opts.port + 1,
    fetch: httpFetch,
  });

  log.info(
    { port: mainServer.port, httpPort: httpServer.port, tls: Boolean(tls) },
    "guest api started",
  );

  return {
    port: mainServer.port ?? opts.port,
    httpPort: httpServer.port ?? opts.port + 1,
    stop() {
      mainServer.stop(true);
      httpServer.stop(true);
    },
  };
}
