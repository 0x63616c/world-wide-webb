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

// www-q002.14: the cert volume is mounted READ-ONLY (portal-certs:/certs:ro), so
// nginx must NOT read its cert straight from /certs and the entrypoint must NOT
// try to write the placeholder there (that crash-looped the container on a fresh
// deploy: ro mount + empty volume → openssl write fails → nginx can't load a cert
// → exit). nginx reads from a WRITABLE image-internal dir the entrypoint
// populates (real cert copied from /certs when present, else a placeholder).
describe("captive-portal TLS cert paths (www-q002.14 ro-volume crash-loop fix)", () => {
  const NGINX = readFileSync(join(REPO_ROOT, "apps/captive-portal/nginx.conf"), "utf8");
  const ENTRY = readFileSync(
    join(REPO_ROOT, "apps/captive-portal/docker-entrypoint-portal.sh"),
    "utf8",
  );

  it("nginx reads the cert from the writable internal dir, not the read-only /certs volume", () => {
    expect(NGINX).toContain("ssl_certificate     /etc/nginx/portal-certs/fullchain.pem;");
    expect(NGINX).toContain("ssl_certificate_key /etc/nginx/portal-certs/key.pem;");
    // The OLD bug: pointing ssl_certificate straight at the ro /certs volume.
    expect(NGINX).not.toContain("ssl_certificate     /certs/");
    expect(NGINX).not.toContain("ssl_certificate_key /certs/key.pem;");
  });

  it("the entrypoint mints the placeholder into the writable dir, never the ro volume", () => {
    // The placeholder openssl write must target the LIVE (writable) dir.
    expect(ENTRY).toContain("LIVE_DIR=/etc/nginx/portal-certs");
    expect(ENTRY).toMatch(/-keyout "\$LIVE_KEY" -out "\$LIVE_FULLCHAIN"/);
    // It must NOT write the placeholder to the read-only /certs volume (the bug).
    expect(ENTRY).not.toMatch(/-keyout "?\/certs\//);
  });
});
