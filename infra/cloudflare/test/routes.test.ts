import {
  defineProduct,
  homelabTarget,
  internalService,
  privateWeb,
  publicWeb,
} from "@repo/platform";
import { describe, expect, test } from "vitest";
import {
  cloudflareRoutesForExposures,
  desiredCnames,
  desiredIngressRules,
  tunnelCnameTarget,
} from "../src/routes.ts";

// ADOPT-ONLY (www-j934.2): the ingress rules + CNAMEs must mirror the LIVE state
// (verified 2026-06-11) exactly for a zero-diff import. Ingress = 5 hosts;
// CNAMEs = those 5 PLUS the stray hooks-test leftover (asymmetric on purpose).
// portainer + hooks are adopted as-is and retire later as explicit diffs.
// captive-portal is never tunneled (LAN-only).

const ZONE = "worldwidewebb.co";

describe("desiredIngressRules", () => {
  test("declares product-derived app.amp, app.cc plus the legacy ingress hosts with their origins", () => {
    const byHost = Object.fromEntries(
      desiredIngressRules(ZONE).map((r) => [r.hostname, r.service]),
    );
    expect(Object.keys(byHost).sort()).toEqual([
      "app.amp.worldwidewebb.co",
      "app.cc.worldwidewebb.co",
      "dashboard.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "hooks.worldwidewebb.co",
      "portainer.worldwidewebb.co",
      "storybook.worldwidewebb.co",
    ]);
    expect(byHost["dashboard.worldwidewebb.co"]).toBe("http://web:80");
    expect(byHost["app.cc.worldwidewebb.co"]).toBe("http://web:80");
    expect(byHost["app.amp.worldwidewebb.co"]).toBe("http://amp-app:80");
    expect(byHost["portainer.worldwidewebb.co"]).toBe("http://portainer:9000");
    expect(byHost["hooks.worldwidewebb.co"]).toBe("http://bosun-agent:4202");
  });

  test("api.amp is NEVER tunneled (AMP v0 is stateless; no public API route)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("api.amp.worldwidewebb.co");
  });

  test("captive-portal is NEVER tunneled (LAN-only)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("captive-portal.worldwidewebb.co");
    expect(hosts).not.toContain("app.cp.worldwidewebb.co");
  });

  // .7.4 contract: /trpc is same-origin behind app.cc, so the api service is
  // internal-only. No api.cc.* external hostname may ever leak into the shipped
  // ingress (the primitive-level guard lives in exposure.test.ts; this asserts it
  // end-to-end over the REAL control-center routes, not a synthetic product).
  test("never emits an external api.cc route (same-origin /trpc)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("api.cc.worldwidewebb.co");
    expect(hosts.some((h) => h.startsWith("api.cc."))).toBe(false);
  });

  test("renders future public/private product route shapes without undeclared APIs", () => {
    const amp = defineProduct("amp");
    const textYourEx = defineProduct("text-your-ex");
    const routes = cloudflareRoutesForExposures([
      { exposure: privateWeb(amp, homelabTarget, { host: "app" }), origin: "http://amp-web:80" },
      {
        exposure: publicWeb(textYourEx, homelabTarget, { host: "app" }),
        origin: "http://tye-web:80",
      },
      {
        exposure: publicWeb(textYourEx, homelabTarget, { host: "api" }),
        origin: "http://tye-api:4201",
      },
      { exposure: internalService({ port: 4201 }), origin: "http://internal:4201" },
    ]);

    expect(routes.ingressRules.map((route) => route.hostname).sort()).toEqual([
      "api.tye.worldwidewebb.co",
      "app.amp.worldwidewebb.co",
      "app.tye.worldwidewebb.co",
    ]);
    expect(routes.cnames.map((route) => route.hostname).sort()).toEqual([
      "api.tye.worldwidewebb.co",
      "app.amp.worldwidewebb.co",
      "app.tye.worldwidewebb.co",
    ]);
    expect(routes.ingressRules.map((route) => route.hostname)).not.toContain(
      "api.amp.worldwidewebb.co",
    );
  });
});

describe("desiredCnames", () => {
  test("declares product-derived app.amp, app.cc plus legacy proxied CNAMEs incl. stray hooks-test", () => {
    const hosts = desiredCnames(ZONE)
      .map((c) => c.hostname)
      .sort();
    expect(hosts).toEqual([
      "app.amp.worldwidewebb.co",
      "app.cc.worldwidewebb.co",
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
    // product-derived platform route comment (not a frozen legacy value)
    expect(byHost["app.amp.worldwidewebb.co"]).toBe("platform:amp private app route");
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
