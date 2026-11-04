/**
 * A minimal, dedicated listener that serves nothing but the exposition text.
 *
 * Keep internal instrumentation separate from the app's tunneled HTTP port.
 * Compose does not publish this port, and Cloudflare has no route to it.
 * The former Prometheus deployment is retired; the listener remains available
 * for internal diagnostics.
 *
 * `node:http` rather than `Bun.serve` so the same listener works on bun and on
 * node.
 */
import { createServer, type Server } from "node:http";
import type { Logger } from "@www/logger";
import { METRICS_PATH } from "./port";
import { metricsHandler } from "./registry";

export type MetricsServerOptions = {
  port: number;
  /** Bind address on the internal container network. */
  host?: string;
  /** Path the exposition is served on. Defaults to the shared metrics path. */
  path?: string;
  logger?: Logger;
};

export type MetricsServer = {
  /**
   * The port actually bound, or `undefined` before the listen completes. Only
   * interesting when `port: 0` was passed (tests) — in prod the number is the
   * one that was asked for.
   */
  boundPort(): number | undefined;
  close(): void;
};

/**
 * Start the metrics listener. Never throws into the caller's boot path: a
 * failure to bind is logged and swallowed, because losing observability must
 * not take down the service being observed.
 */
export function startMetricsServer(opts: MetricsServerOptions): MetricsServer {
  const path = opts.path ?? METRICS_PATH;
  const server: Server = createServer((req, res) => {
    if (req.url?.split("?")[0] !== path) {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not Found");
      return;
    }
    void metricsHandler()
      .then(async (response) => {
        const body = await response.text();
        res
          .writeHead(response.status, {
            "content-type": response.headers.get("content-type") ?? "text/plain",
          })
          .end(body);
      })
      .catch((err: unknown) => {
        opts.logger?.error({ err }, "metrics collection failed");
        res.writeHead(500, { "content-type": "text/plain" }).end("metrics collection failed");
      });
  });

  server.on("error", (err) => {
    opts.logger?.error({ err, port: opts.port }, "metrics listener failed");
  });

  // Unref'd so an idle metrics listener can never be the reason a process
  // refuses to exit after its real work is done.
  server.listen(opts.port, opts.host ?? "0.0.0.0", () => {
    opts.logger?.info({ port: opts.port, path }, "metrics listener started");
  });
  server.unref();

  return {
    boundPort() {
      const address = server.address();
      return address && typeof address === "object" ? address.port : undefined;
    },
    close() {
      server.close();
    },
  };
}
