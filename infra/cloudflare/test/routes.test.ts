import { defineProduct, homelabTarget, internalService, privateWeb } from "@www/platform";
import { describe, expect, test } from "vitest";
import {
  cloudflareRoutesForExposures,
  desiredCnames,
  desiredIngressRules,
  tunnelCnameTarget,
} from "../src/routes.ts";

// ADOPT-ONLY (www-j934.2): the ingress rules + CNAMEs must mirror the LIVE state
// exactly. Ingress = 2 legacy hosts (storybook/drizzle) + 4 product hosts;
// CNAMEs = the legacy hosts PLUS the stray hooks-test leftover (asymmetric on
// purpose). dashboard.worldwidewebb.co removed in CC-2ff. The dead portainer +
// hooks routes were pruned in www-oa74. captive-portal is never tunneled (LAN-only).

const ZONE = "worldwidewebb.co";

describe("desiredIngressRules", () => {
  test("declares product-derived app.cc plus the legacy ingress hosts with their origins", () => {
    const byHost = Object.fromEntries(
      desiredIngressRules(ZONE).map((r) => [r.hostname, r.service]),
    );
    expect(Object.keys(byHost).sort()).toEqual([
      "app--cc.worldwidewebb.co",
      "app.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "storybook.worldwidewebb.co",
    ]);
    expect(byHost["dashboard.worldwidewebb.co"]).toBeUndefined();
    expect(byHost["app--cc.worldwidewebb.co"]).toBe(
      "http://web.control-center.svc.cluster.local:80",
    );
    // Task 7 cutover: app.worldwidewebb.co added alongside app--cc, same origin.
    expect(byHost["app.worldwidewebb.co"]).toBe("http://web.control-center.svc.cluster.local:80");
    expect(byHost["portainer.worldwidewebb.co"]).toBeUndefined();
    expect(byHost["hooks.worldwidewebb.co"]).toBeUndefined();
  });

  test("captive-portal is NEVER tunneled (LAN-only)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("captive-portal.worldwidewebb.co");
    expect(hosts).not.toContain("app--cp.worldwidewebb.co");
  });

  // .7.4 contract: /trpc is same-origin behind app.cc, so the api service is
  // internal-only. No api.cc.* external hostname may ever leak into the shipped
  // ingress (the primitive-level guard lives in exposure.test.ts; this asserts it
  // end-to-end over the REAL control-center routes, not a synthetic product).
  test("never emits an external api.cc route (same-origin /trpc)", () => {
    const hosts = desiredIngressRules(ZONE).map((r) => r.hostname);
    expect(hosts).not.toContain("api--cc.worldwidewebb.co");
    expect(hosts.some((h) => h.startsWith("api.cc."))).toBe(false);
  });

  test("renders private product route shapes without undeclared APIs", () => {
    const captivePortal = defineProduct("captive-portal");
    const controlCenter = defineProduct("control-center");
    const routes = cloudflareRoutesForExposures([
      {
        exposure: privateWeb(captivePortal, homelabTarget, { host: "app" }),
        origin: "http://cp-web:80",
      },
      {
        exposure: privateWeb(controlCenter, homelabTarget, { host: "web" }),
        origin: "http://cc-web:80",
      },
      { exposure: internalService({ port: 4201 }), origin: "http://internal:4201" },
    ]);

    expect(routes.ingressRules.map((route) => route.hostname).sort()).toEqual([
      "app--cp.worldwidewebb.co",
      "web--cc.worldwidewebb.co",
    ]);
    expect(routes.cnames.map((route) => route.hostname).sort()).toEqual([
      "app--cp.worldwidewebb.co",
      "web--cc.worldwidewebb.co",
    ]);
    expect(routes.ingressRules.map((route) => route.hostname)).not.toContain(
      "api--cp.worldwidewebb.co",
    );
  });
});

describe("desiredCnames", () => {
  test("declares product-derived app.cc plus legacy proxied CNAMEs incl. stray hooks-test", () => {
    const hosts = desiredCnames(ZONE)
      .map((c) => c.hostname)
      .sort();
    expect(hosts).toEqual([
      "app--cc.worldwidewebb.co",
      "app.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "hooks-test.worldwidewebb.co",
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
    expect(byHost["storybook.worldwidewebb.co"]).toBe("bosun:control-center tunnel route");
    // dashboard.worldwidewebb.co retired in CC-2ff
    expect(byHost).not.toHaveProperty("dashboard.worldwidewebb.co");
    // legacy evee comments (kept verbatim so import is zero-diff)
    expect(byHost["drizzle.worldwidewebb.co"]).toBe(
      "Drizzle Gateway via evee-webhooks tunnel (www-0ub8)",
    );
    expect(byHost["hooks-test.worldwidewebb.co"]).toBe(
      "EVEE-218 webhook test (apex naming, covered by Universal SSL)",
    );
    // product-derived platform route comment (not a frozen legacy value)
    expect(byHost["app--cc.worldwidewebb.co"]).toBe("platform:control-center private app route");
    // Task 7 cutover: app.worldwidewebb.co added alongside app--cc.
    expect(byHost["app.worldwidewebb.co"]).toBe(
      "platform:control-center private app route (app.worldwidewebb.co cutover)",
    );
    // pruned dead routes are absent (www-oa74)
    expect(byHost).not.toHaveProperty("hooks.worldwidewebb.co");
    expect(byHost).not.toHaveProperty("portainer.worldwidewebb.co");
  });
});

describe("tunnelCnameTarget", () => {
  test("builds the cfargotunnel host", () => {
    expect(tunnelCnameTarget("t-xyz")).toBe("t-xyz.cfargotunnel.com");
  });
});
