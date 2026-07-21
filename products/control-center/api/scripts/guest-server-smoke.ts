// Executing TLS smoke test for the guest listener's Bun.serve wiring.
//
// The `startGuestServer` TLS integration test in
// src/__tests__/guest-server.test.ts is `describe.skipIf(typeof Bun ===
// "undefined")` guarded: this repo's mandated `bunx vitest run` invocation
// forks a plain `node` process (no `Bun` global), so that block never
// executes there, and `bun test` is banned repo-wide. This script is the
// actual executing coverage for that wiring: a plain Bun script (NOT a
// vitest/bun-test file) run via `bun run scripts/guest-server-smoke.ts`
// (wired as `bun run test:guest-smoke`), asserting over real sockets with a
// real (throwaway, self-signed) TLS cert.
//
// Exits 0 on success. Exits nonzero with a clear message on any assertion
// failure. If `openssl` isn't on PATH, prints SKIP and exits 0 (same
// tolerance as the vitest suite's opensslAvailable() guard).

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "@www/logger";
import { type GuestServer, startGuestServer } from "../src/guest-server";

function opensslAvailable(): boolean {
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Cert-generation logic duplicated (deliberately, with this pointer comment)
// from generateSelfSignedCert() in src/__tests__/guest-server.test.ts, which
// this script cannot import (it lives under __tests__ and pulls in vitest
// there). Keep the two in sync if the cert shape ever needs to change.
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

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) fail(message);
}

async function main(): Promise<void> {
  if (!opensslAvailable()) {
    console.log("SKIP: openssl not found on PATH, cannot generate a throwaway TLS cert");
    process.exit(0);
  }

  const tlsDir = mkdtempSync(join(tmpdir(), "cc-guest-smoke-tls-"));
  const staticDir = mkdtempSync(join(tmpdir(), "cc-guest-smoke-static-"));
  let server: GuestServer | undefined;

  try {
    generateSelfSignedCert(tlsDir);

    writeFileSync(join(staticDir, "index.html"), "<html>guest portal</html>");
    mkdirSync(join(staticDir, "assets"));
    writeFileSync(join(staticDir, "assets", "app.js"), "console.log('portal')");
    // Secret sibling file OUTSIDE staticDir, for the traversal assertion.
    writeFileSync(join(staticDir, "..", "cc-guest-smoke-secret.txt"), "top secret, not for guests");

    const logger = createLogger({ service: "guest-api-smoke", pretty: false, level: "silent" });
    server = startGuestServer({ port: 0, tlsDir, staticDir, logger });

    // 1. HTTPS /up
    const httpsUp = await fetch(`https://localhost:${server.port}/up`, {
      // @ts-expect-error -- Bun's fetch supports a `tls` option node's lib.dom types don't know about.
      tls: { rejectUnauthorized: false },
    });
    assert(httpsUp.status === 200, `HTTPS /up expected 200, got ${httpsUp.status}`);
    assert((await httpsUp.text()) === "OK", "HTTPS /up expected body 'OK'");

    // 2. plain-HTTP companion on port + 1
    assert(server.httpPort === server.port + 1, "httpPort must be port + 1");
    const httpUp = await fetch(`http://localhost:${server.httpPort}/up`);
    assert(httpUp.status === 200, `plain-HTTP companion /up expected 200, got ${httpUp.status}`);

    // 3. HTTPS /trpc/portal.status , DB may be absent, any valid tRPC
    // envelope is fine; if it's an error with httpStatus >= 500, it must be
    // redacted.
    const input = encodeURIComponent(JSON.stringify({ mac: "aa:bb:cc:dd:ee:ff" }));
    const trpcRes = await fetch(
      `https://localhost:${server.port}/trpc/portal.status?input=${input}`,
      {
        // @ts-expect-error -- see above.
        tls: { rejectUnauthorized: false },
      },
    );
    const trpcText = await trpcRes.text();
    let trpcBody: unknown;
    try {
      trpcBody = JSON.parse(trpcText);
    } catch {
      fail(`portal.status response did not parse as JSON: ${trpcText.slice(0, 200)}`);
    }
    const envelope = trpcBody as { error?: { message?: string; data?: { httpStatus?: number } } };
    if (
      envelope.error &&
      typeof envelope.error.data?.httpStatus === "number" &&
      envelope.error.data.httpStatus >= 500
    ) {
      assert(
        envelope.error.message === "Internal error",
        "5xx portal.status error must be redacted to 'Internal error'",
      );
    }

    // 4. static index served
    const indexRes = await fetch(`https://localhost:${server.port}/`, {
      // @ts-expect-error -- see above.
      tls: { rejectUnauthorized: false },
    });
    assert(indexRes.status === 200, `/ expected 200, got ${indexRes.status}`);
    assert((await indexRes.text()) === "<html>guest portal</html>", "/ expected index.html body");

    // 5. traversal attempt blocked
    const traversalRes = await fetch(
      `https://localhost:${server.port}/../cc-guest-smoke-secret.txt`,
      {
        // @ts-expect-error -- see above.
        tls: { rejectUnauthorized: false },
      },
    );
    const traversalText = await traversalRes.text();
    assert(
      !traversalText.includes("top secret"),
      "traversal attempt must never leak the secret file",
    );

    console.log(
      "PASS: guest-server TLS smoke (HTTPS /up, plain-HTTP companion, portal.status, static, traversal guard)",
    );
  } finally {
    server?.stop();
    rmSync(tlsDir, { recursive: true, force: true });
    rmSync(staticDir, { recursive: true, force: true });
    rmSync(join(staticDir, "..", "cc-guest-smoke-secret.txt"), { force: true });
  }
}

main().catch((err) => {
  fail(err instanceof Error ? (err.stack ?? err.message) : String(err));
});
