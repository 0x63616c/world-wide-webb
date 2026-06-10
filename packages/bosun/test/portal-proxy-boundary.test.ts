import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Guards the captive-portal scoped-proxy SECURITY BOUNDARY (www-q002.20). The
// portal nginx is the only thing between an untrusted guest on the open WLAN and
// the dashboard api. A tRPC batch comma-joins procedure names in the PATH
// (/api/trpc/portal.sendCode,lights.list), so a naive prefix match on `portal.`
// would let a hand-crafted batch smuggle a dashboard procedure through. This test
// asserts the conf keeps the HARDENED form (all-portal-only match + encoded-comma
// reject + the proxy-set marker) so a refactor can't silently reopen the hole.
//
// This is a content guard, not a behavioural one. The live attack matrix is
// proven by running the built image (scripts/curl matrix in the ticket). But a
// content guard runs in the vitest gate (CI's test job → blocks deploy), so a
// regression to a loose prefix match fails CI here.

const REPO_ROOT = new URL("../../../", import.meta.url).pathname;
const CONF = readFileSync(join(REPO_ROOT, "apps/captive-portal/_portal_locations.conf"), "utf8");

describe("captive-portal proxy boundary (www-q002.20)", () => {
  it("scopes the portal proxy to an ALL-portal proc list, not a bare prefix", () => {
    // The hardened location: a single portal proc OR a comma list where EVERY
    // segment is portal.*, anchored end ($), so a mixed batch falls through.
    expect(CONF).toContain('location ~ "^/api/trpc/portal\\.[^,/]*(?:,portal\\.[^,/]*)*$"');
    // The OLD loose prefix match must be gone (it allowed mixed batches).
    expect(CONF).not.toContain("location ~ ^/api/trpc/portal\\. {");
  });

  it("rejects an encoded comma (%2c) in the raw request URI (defence in depth)", () => {
    expect(CONF).toMatch(/if\s*\(\$request_uri\s*~\*?\s*"%2c"\)\s*\{\s*return 404;/i);
  });

  it("still 404s everything else under /api (the guest-VLAN boundary)", () => {
    expect(CONF).toMatch(/location \/api\/ \{\s*return 404;/);
  });

  it("sets the X-Portal-Scope marker so the api can enforce layer B", () => {
    // proxy_set_header REDEFINES, so a client-forged copy is overwritten here.
    expect(CONF).toContain("proxy_set_header X-Portal-Scope portal;");
  });
});
