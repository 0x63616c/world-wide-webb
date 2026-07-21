import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@www/logger";
import { beforeAll, describe, expect, test } from "vitest";
import { envSchema } from "../env";
import {
  createGuestFetchHandler,
  type GuestServer,
  redactGuestErrorBody,
  startGuestServer,
} from "../guest-server";

// No cert/key material is committed here (gitleaks flags any embedded
// private key as a leak, rightly, since it's indistinguishable from a real
// one at a glance): the TLS test generates a fresh throwaway self-signed
// localhost cert into a temp dir at run time via the system `openssl`
// (present on macOS and CI Linux images), and skips itself if `openssl`
// isn't on PATH.
function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function generateSelfSignedCert(dir: string): void {
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "fullchain.pem");
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-nodes",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ]);
}

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

  test("a raw internal error (no DB in this process) reaches the guest as 'Internal error', never the real message/stack", async () => {
    // portal.status hits the real drizzle repo, which has no Postgres to
    // talk to here, so it throws a raw pg/drizzle error , an INTERNAL_SERVER_ERROR
    // this test does not control the shape of, exactly the "raw DB/internal
    // error thrown in a portal procedure" scenario the redaction guards
    // against. Wired through createGuestFetchHandler end-to-end (not just
    // the pure redactGuestErrorBody unit above) to prove it's actually
    // applied in the handler, not just implemented.
    const input = encodeURIComponent(JSON.stringify({ mac: "aa:bb:cc:dd:ee:ff" }));
    const res = await handler()(
      new Request(`http://guest.local/trpc/portal.status?input=${input}`),
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    const body = JSON.parse(text) as { error: { message: string; data: Record<string, unknown> } };
    expect(body.error.message).toBe("Internal error");
    expect(body.error.data).not.toHaveProperty("stack");
    expect(body.error.data.code).toBe("INTERNAL_SERVER_ERROR");
    // The raw driver error text/stack must not appear anywhere in the body.
    expect(text).not.toMatch(/portal_authorization|portal-repo\.ts|node_modules/);
  });
});

// -----------------------------------------------------------------------
// redactGuestErrorBody: pure-function unit tests against realistic tRPC
// error envelopes (as observed from an actual portal.status call against a
// DB-less process, and from a mixed batch , see guest-server.ts's comment
// on why this can't gate on the aggregate HTTP status).
// -----------------------------------------------------------------------
describe("redactGuestErrorBody", () => {
  test("redacts message + stack for a >=500 single-call error", () => {
    const body = {
      error: {
        message:
          'Failed query: select "id" from "portal_authorization" where "mac" = $1\nparams: aa:bb:cc:dd:ee:ff',
        code: -32603,
        data: {
          code: "INTERNAL_SERVER_ERROR",
          httpStatus: 500,
          stack:
            "Error: Failed query: ...\n    at Object.findAuthorizationByMac (portal-repo.ts:49:21)",
          path: "portal.status",
        },
      },
    };
    const redacted = redactGuestErrorBody(body) as typeof body;
    expect(redacted.error.message).toBe("Internal error");
    expect(redacted.error.data).not.toHaveProperty("stack");
    // Non-sensitive fields survive untouched.
    expect(redacted.error.data.code).toBe("INTERNAL_SERVER_ERROR");
    expect(redacted.error.data.httpStatus).toBe(500);
    expect(redacted.error.data.path).toBe("portal.status");
  });

  test("leaves a BAD_REQUEST (wrong-password copy) untouched , guests need this", () => {
    const body = {
      error: {
        message: "WRONG_PASSWORD: incorrect WiFi password",
        code: -32600,
        data: { code: "BAD_REQUEST", httpStatus: 400, path: "portal.checkPassword" },
      },
    };
    const redacted = redactGuestErrorBody(body) as typeof body;
    expect(redacted).toEqual(body);
  });

  test("leaves a NOT_FOUND (routing 404) untouched", () => {
    const body = {
      error: {
        message: 'No procedure found on path "health.ping"',
        code: -32004,
        data: { code: "NOT_FOUND", httpStatus: 404, path: "health.ping" },
      },
    };
    const redacted = redactGuestErrorBody(body) as typeof body;
    expect(redacted).toEqual(body);
  });

  test("redacts only the >=500 item in a mixed batch, leaving the 404 item intact", () => {
    const body = [
      {
        error: {
          message: "Failed query: select ... from portal_authorization",
          code: -32603,
          data: {
            code: "INTERNAL_SERVER_ERROR",
            httpStatus: 500,
            stack: "Error: Failed query ...",
            path: "portal.status",
          },
        },
      },
      {
        error: {
          message: 'No procedure found on path "health.ping"',
          code: -32004,
          data: { code: "NOT_FOUND", httpStatus: 404, path: "health.ping" },
        },
      },
    ];
    const redacted = redactGuestErrorBody(body) as typeof body;
    expect(redacted[0]?.error.message).toBe("Internal error");
    expect(redacted[0]?.error.data).not.toHaveProperty("stack");
    expect(redacted[1]?.error).toEqual(body[1]?.error);
  });

  test("passes a successful (non-error) response through untouched", () => {
    const body = { result: { data: { state: "fresh" } } };
    expect(redactGuestErrorBody(body)).toEqual(body);
  });

  test("redacts message but preserves data.portalCode for a >=500 PortalError (e.g. not_configured)", () => {
    // A typed PortalError can still map onto a 5xx httpStatus (e.g. the
    // portal being unconfigured is a server-side condition, not a guest
    // input error) while carrying a `portalCode` the guest client UI
    // switches on. Redaction must blank the raw message but MUST NOT drop
    // portalCode along with it , only `stack` is stripped.
    const body = {
      error: {
        message: "Portal is not configured",
        code: -32603,
        data: {
          code: "SERVICE_UNAVAILABLE",
          httpStatus: 503,
          portalCode: "not_configured",
          path: "portal.status",
        },
      },
    };
    const redacted = redactGuestErrorBody(body) as typeof body;
    expect(redacted.error.message).toBe("Internal error");
    expect(redacted.error.data.portalCode).toBe("not_configured");
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
//
// `bun test` is banned repo-wide though, so in practice this block never
// executes in CI or local dev today , it's kept because it documents intent
// and would start running again the moment vitest is ever invoked under a
// real Bun runtime. The coverage that DOES actually execute today for this
// TLS wiring is ../../scripts/guest-server-smoke.ts (`bun run
// test:guest-smoke`), a plain Bun script asserting over real sockets against
// a throwaway self-signed cert.
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

  test.skipIf(!opensslAvailable())(
    "with tlsDir set, serves /up over real TLS on the main port, and the plain-HTTP companion still answers",
    async () => {
      // Exercises the Bun.serve `tls:` wiring (fullchain.pem/key.pem reads)
      // that the test above never touches, since it starts the server
      // without tlsDir , this is the fix for that gap.
      const tlsDir = mkdtempSync(join(tmpdir(), "cc-guest-tls-"));
      generateSelfSignedCert(tlsDir);

      const server = startGuestServer({ port: 0, staticDir, tlsDir, logger: testLogger });
      servers.push(server);

      // Throwaway self-signed cert isn't in any trust store, so verification
      // must be disabled for this test client , that's the point of using a
      // self-signed cert here at all, not a claim about production TLS trust.
      const res = await fetch(`https://localhost:${server.port}/up`, {
        tls: { rejectUnauthorized: false },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("OK");

      // The plain-HTTP OS-detection companion must stay plain HTTP even when
      // the main listener is TLS , a captive-portal client must never hit a
      // cert prompt while deciding whether the network is captive.
      expect(server.httpPort).toBe(server.port + 1);
      const httpRes = await fetch(`http://localhost:${server.httpPort}/up`);
      expect(httpRes.status).toBe(200);

      for (const s of servers) s.stop();
      servers = [];
    },
  );
});
