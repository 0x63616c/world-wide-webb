import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@www/logger";
import { beforeAll, describe, expect, test } from "vitest";
import { envSchema } from "../env";
import { createGuestFetchHandler, type GuestServer, startGuestServer } from "../guest-server";

// Silent logger, so the test run isn't drowned in per-request log lines.
const testLogger = createLogger({ service: "guest-api-test", pretty: false, level: "silent" });

let staticDir: string;

beforeAll(() => {
  staticDir = mkdtempSync(join(tmpdir(), "cc-guest-static-"));
  writeFileSync(join(staticDir, "index.html"), "<html>guest portal</html>");
  mkdirSync(join(staticDir, "assets"));
  writeFileSync(join(staticDir, "assets", "app.js"), "console.log('portal')");

  // A secret sibling file OUTSIDE staticDir, used by the traversal tests to
  // prove the guest listener can never read files above its static root.
  const secretDir = join(staticDir, "..");
  writeFileSync(join(secretDir, "cc-guest-secret.txt"), "top secret, not for guests");
});

function handler() {
  return createGuestFetchHandler({ staticDir, logger: testLogger });
}

// -----------------------------------------------------------------------
// Routing/security behaviour, exercised as pure Request -> Response calls
// against the handler (no real socket needed , this is what the mandated
// `bunx vitest run src/__tests__/guest-server.test.ts` command runs under,
// which forks a plain node process with no Bun global available; Bun.serve
// itself is only exercised by the skipIf-guarded integration test below).
// -----------------------------------------------------------------------
describe("createGuestFetchHandler", () => {
  test("responds to a portal procedure (portal.status) , the procedure is reachable and executes", async () => {
    const input = encodeURIComponent(JSON.stringify({ mac: "aa:bb:cc:dd:ee:ff" }));
    const res = await handler()(
      new Request(`http://guest.local/trpc/portal.status?input=${input}`),
    );
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    // No Postgres in this unit-test process, so the call fails on the DB
    // query itself (INTERNAL_SERVER_ERROR) rather than succeeding , that's
    // expected and orthogonal to this test. What matters is that tRPC found
    // and RAN the procedure: a routing-boundary failure would instead be
    // NOT_FOUND (see the sibling test below), never this shape.
    expect(body.error?.data?.code).not.toBe("NOT_FOUND");
  });

  test("a non-portal path (health.ping) 404s , guestRouter has no health key", async () => {
    const res = await handler()(new Request("http://guest.local/trpc/health.ping"));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: { data?: { code?: string } } };
    expect(body.error?.data?.code).toBe("NOT_FOUND");
  });

  test("a batched path mixing a portal and non-portal procedure still 404s the non-portal one", async () => {
    // tRPC's httpBatchLink sends batched calls as a comma-joined path with
    // ?batch=1 , this verifies the per-procedure guard isn't a naive
    // single-path string check that a clever client could route around by
    // smuggling a non-portal procedure into the same batch as a real one.
    // Batch responses are per-item (a mixed batch is HTTP 207), so the
    // assertion is on the health.ping item's own error code, not the
    // aggregate HTTP status.
    const batchInput = encodeURIComponent(JSON.stringify({ 0: {}, 1: {} }));
    const res = await handler()(
      new Request(`http://guest.local/trpc/portal.status,health.ping?batch=1&input=${batchInput}`),
    );
    const body = (await res.json()) as Array<{
      error?: { data?: { code?: string; path?: string } };
    }>;
    expect(body).toHaveLength(2);
    const healthResult = body[1];
    expect(healthResult?.error?.data?.code).toBe("NOT_FOUND");
    expect(healthResult?.error?.data?.path).toBe("health.ping");
  });

  test("/up returns 200 OK", async () => {
    const res = await handler()(new Request("http://guest.local/up"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("OK");
  });

  test("/ serves index.html", async () => {
    const res = await handler()(new Request("http://guest.local/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toBe("<html>guest portal</html>");
  });

  test("an unmatched client route falls back to index.html (SPA)", async () => {
    const res = await handler()(new Request("http://guest.local/join/step-2"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<html>guest portal</html>");
  });

  test("a real static asset is served with its content and content-type", async () => {
    const res = await handler()(new Request("http://guest.local/assets/app.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(await res.text()).toBe("console.log('portal')");
  });

  test("directory traversal outside staticDir is blocked, not leaked via SPA fallback", async () => {
    const res = await handler()(new Request("http://guest.local/../cc-guest-secret.txt"));
    const body = await res.text();
    expect(body).not.toContain("top secret");
  });

  test("an encoded traversal path (%2e%2e) is also blocked", async () => {
    const res = await handler()(new Request("http://guest.local/%2e%2e/cc-guest-secret.txt"));
    const body = await res.text();
    expect(body).not.toContain("top secret");
  });

  test("a deeper encoded traversal (assets/%2e%2e/%2e%2e/cc-guest-secret.txt) is blocked", async () => {
    const res = await handler()(
      new Request("http://guest.local/assets/%2e%2e/%2e%2e/cc-guest-secret.txt"),
    );
    const body = await res.text();
    expect(body).not.toContain("top secret");
  });

  test("OPTIONS preflight returns 204 with CORS headers", async () => {
    const res = await handler()(
      new Request("http://guest.local/trpc/portal.status", { method: "OPTIONS" }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("GUEST_PORT env", () => {
  test("is optional and undefined by default , the listener is off unless configured", () => {
    const parsed = envSchema.parse({});
    expect(parsed.GUEST_PORT).toBeUndefined();
    expect(parsed.GUEST_TLS_DIR).toBeUndefined();
    expect(parsed.GUEST_STATIC_DIR).toBeUndefined();
  });
});

// -----------------------------------------------------------------------
// Real-socket smoke test for the Bun.serve wiring itself. This repo's test
// harness runs vitest with pool "forks", which forks a genuine `node`
// process (confirmed: `process.execPath` resolves to the Homebrew node
// binary even when vitest itself is launched via `bunx`/`bun run`), so
// `Bun` is not defined there and this suite is skipped in that path. It DOES
// run under `bun test` / a real Bun-runtime vitest invocation, giving an
// integration check of startGuestServer beyond the pure-handler tests above.
// -----------------------------------------------------------------------
describe.skipIf(typeof Bun === "undefined")("startGuestServer (Bun.serve integration)", () => {
  let servers: GuestServer[] = [];

  function start(): GuestServer {
    // Port 0 asks the OS for a free ephemeral port, so parallel test runs
    // never collide on a fixed port.
    const server = startGuestServer({ port: 0, staticDir, logger: testLogger });
    servers.push(server);
    return server;
  }

  test("serves /up and a plain-HTTP companion on port + 1", async () => {
    const server = start();
    const res = await fetch(`http://localhost:${server.port}/up`);
    expect(res.status).toBe(200);
    expect(server.httpPort).toBe(server.port + 1);
    const httpRes = await fetch(`http://localhost:${server.httpPort}/up`);
    expect(httpRes.status).toBe(200);
    for (const s of servers) s.stop();
    servers = [];
  });
});
