import { describe, expect, test } from "vitest";
import { desiredCnames, desiredIngressRules, tunnelCnameTarget } from "../src/routes.ts";

// ADOPT-ONLY (www-j934.2): the ingress rules + CNAMEs must mirror the LIVE state
// (verified 2026-06-11) exactly for a zero-diff import. Ingress = 5 hosts;
// CNAMEs = those 5 PLUS the stray hooks-test leftover (asymmetric on purpose).
// portainer + hooks are adopted as-is and retire later as explicit diffs.
// captive-portal is never tunneled (LAN-only).

const ZONE = "worldwidewebb.co";

describe("desiredIngressRules", () => {
  test("declares the five live ingress hosts with their origins", () => {
    const byHost = Object.fromEntries(
      desiredIngressRules(ZONE).map((r) => [r.hostname, r.service]),
    );
    expect(Object.keys(byHost).sort()).toEqual([
      "dashboard.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "hooks.worldwidewebb.co",
      "portainer.worldwidewebb.co",
      "storybook.worldwidewebb.co",
    ]);
    expect(byHost["dashboard.worldwidewebb.co"]).toBe("http://web:80");
    expect(byHost["portainer.worldwidewebb.co"]).toBe("http://portainer:9000");
    expect(byHost["hooks.worldwidewebb.co"]).toBe("http://bosun-agent:4202");
  });

  test("captive-portal is NEVER tunneled (LAN-only)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("captive-portal.worldwidewebb.co");
  });
});

describe("desiredCnames", () => {
  test("declares all six live proxied CNAMEs incl. the stray hooks-test", () => {
    const hosts = desiredCnames(ZONE)
      .map((c) => c.hostname)
      .sort();
    expect(hosts).toEqual([
      "dashboard.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "hooks-test.worldwidewebb.co",
      "hooks.worldwidewebb.co",
      "portainer.worldwidewebb.co",
      "storybook.worldwidewebb.co",
    ]);
  });

  test("every CNAME is proxied and targets the tunnel", () => {
    const tunnelId = "abc123";
    for (const c of desiredCnames(ZONE)) {
      expect(c.proxied).toBe(true);
      expect(c.target(tunnelId)).toBe(`${tunnelId}.cfargotunnel.com`);
    }
  });

  test("each CNAME carries its EXACT live comment (zero-diff import; varies per record)", () => {
    const byHost = Object.fromEntries(desiredCnames(ZONE).map((c) => [c.hostname, c.comment]));
    // frozen legacy ownership-tagged route comment (live CF value, kept verbatim)
    expect(byHost["dashboard.worldwidewebb.co"]).toBe("bosun:control-center tunnel route");
    expect(byHost["storybook.worldwidewebb.co"]).toBe("bosun:control-center tunnel route");
    // legacy evee comments (kept verbatim so import is zero-diff)
    expect(byHost["drizzle.worldwidewebb.co"]).toBe(
      "Drizzle Gateway via evee-webhooks tunnel (www-0ub8)",
    );
    expect(byHost["hooks-test.worldwidewebb.co"]).toBe(
      "EVEE-218 webhook test (apex naming, covered by Universal SSL)",
    );
    // no comment live -> undefined (must not invent one, or it's a diff)
    expect(byHost["hooks.worldwidewebb.co"]).toBeUndefined();
    expect(byHost["portainer.worldwidewebb.co"]).toBeUndefined();
  });
});

describe("tunnelCnameTarget", () => {
  test("builds the cfargotunnel host", () => {
    expect(tunnelCnameTarget("t-xyz")).toBe("t-xyz.cfargotunnel.com");
  });
});
