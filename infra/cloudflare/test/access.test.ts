import { homelabTarget, internalService, privateWeb, publicWeb } from "@www/platform";
import { describe, expect, test } from "vitest";
import { accessAppsForPrivateWeb, desiredAccessApps } from "../src/access.ts";

// M3 moves private exposure toward a default-deny Cloudflare Access contract.

const ZONE = "worldwidewebb.co";

describe("desiredAccessApps", () => {
  test("DEFAULT (gate off): the product app routes, but NO wildcard floor", () => {
    // www-b6ad: the not-yet-live *.<zone> default-deny floor is off by default,
    // so it can never block a host before its Access app is in place.
    const domains = desiredAccessApps(ZONE)
      .map((a) => a.domain)
      .sort();
    expect(domains).toEqual([
      "app.worldwidewebb.co",
      // The LAN appliance (#292): putting DSM on the tunnel gives it an
      // internet-facing hostname, so its Access app is not optional.
      "dsm.worldwidewebb.co",
      "grafana.worldwidewebb.co",
      "ha.worldwidewebb.co",
      // manage has no login of its own — this app IS its authentication.
      "manage.worldwidewebb.co",
    ]);
    expect(domains).not.toContain("*.worldwidewebb.co");
    expect(domains).not.toContain("hooks.worldwidewebb.co");
    expect(domains).not.toContain("drizzle.worldwidewebb.co");
    // Task 7 Step C: the flattened app--cc cutover app is retired.
    expect(domains).not.toContain("app--cc.worldwidewebb.co");
  });

  test("declares the wildcard block floor alongside the app kiosk", () => {
    const domains = desiredAccessApps(ZONE, true)
      .map((a) => a.domain)
      .sort();
    expect(domains).toEqual([
      "*.worldwidewebb.co",
      "app.worldwidewebb.co",
      "dsm.worldwidewebb.co",
      "grafana.worldwidewebb.co",
      "ha.worldwidewebb.co",
      "manage.worldwidewebb.co",
    ]);
    expect(domains).not.toContain("app--cc.worldwidewebb.co");
    expect(domains).not.toContain("drizzle.worldwidewebb.co");
    // Retired hosts keep their absence pinned.
    expect(domains).not.toContain("hooks.worldwidewebb.co");
    expect(domains).not.toContain("unifi.worldwidewebb.co");
    expect(domains).not.toContain("plex.worldwidewebb.co");
    expect(domains).not.toContain("db-ui.worldwidewebb.co");
  });

  // The whole point of a separate exposure kind: public-web must never acquire
  // an Access app, and adding it must never strip one from a private host.
  test("public-web never yields an Access app, and app. keeps its gate", () => {
    const apps = accessAppsForPrivateWeb([
      { exposure: publicWeb(homelabTarget, { host: "hooks" }), policies: ["email-otp"] },
      { exposure: privateWeb(homelabTarget, { host: "app" }), policies: ["email-otp"] },
    ]);

    expect(apps.map((a) => a.domain)).toEqual(["app.worldwidewebb.co"]);
  });

  test("grafana is human-login only — NEVER reachable with the kiosk token", () => {
    // #209: the panel never calls Grafana, and Grafana can edit datasources and
    // dashboards, so the on-device kiosk token must not open this door either.
    const grafana = desiredAccessApps(ZONE, true).find(
      (entry) => entry.domain === "grafana.worldwidewebb.co",
    );

    expect(grafana?.policies).toEqual([
      {
        decision: "allow",
        include: { configKey: "allowedEmail", kind: "email-config" },
        name: "email-otp",
        precedence: 1,
      },
    ]);
  });

  test("ha is human-login only — NEVER reachable with the kiosk token", () => {
    // #75/#237: full HA admin surface, no kiosk business reaching it over this
    // route, same reasoning as Grafana above.
    const ha = desiredAccessApps(ZONE, true).find(
      (entry) => entry.domain === "ha.worldwidewebb.co",
    );

    expect(ha?.policies).toEqual([
      {
        decision: "allow",
        include: { configKey: "allowedEmail", kind: "email-config" },
        name: "email-otp",
        precedence: 1,
      },
    ]);
  });

  test("supports kiosk service-token access for app (+ email-OTP fallback for browser, CC-d15)", () => {
    const app = desiredAccessApps(ZONE, true).find(
      (entry) => entry.domain === "app.worldwidewebb.co",
    );

    expect(app?.policies).toEqual([
      {
        // Service Auth: an "allow" policy is identity-based and redirects a
        // valid service token to login (auth_status:NONE); non_identity grants it.
        decision: "non_identity",
        include: { configKey: "kioskTokenId", kind: "service-token-config" },
        name: "kiosk-service-token",
        precedence: 1,
      },
      {
        decision: "allow",
        include: { configKey: "allowedEmail", kind: "email-config" },
        name: "email-otp",
        precedence: 2,
      },
    ]);
  });

  test("models the default-deny wildcard floor as an explicit deny policy", () => {
    const floor = desiredAccessApps(ZONE, true).find((app) => app.domain === "*.worldwidewebb.co");

    expect(floor?.policies).toEqual([
      {
        decision: "deny",
        include: { kind: "everyone" },
        name: "default-deny",
        precedence: 99,
      },
    ]);
  });

  test("emits no literal personal email anywhere in the access apps", () => {
    expect(JSON.stringify(desiredAccessApps(ZONE, true))).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+/i,
    );
  });

  test("derives privateWeb apps without gating non-private exposures", () => {
    expect(
      accessAppsForPrivateWeb([
        {
          exposure: privateWeb(homelabTarget, { host: "app" }),
          policies: ["email-otp"],
        },
        {
          // An internal Service is never a Cloudflare Access app.
          exposure: internalService({ port: 4201 }),
          policies: ["email-otp"],
        },
      ]).map((app) => app.domain),
    ).toEqual(["app.worldwidewebb.co"]);
  });

  test("every app carries the live ownership tag so the import is zero-diff", () => {
    for (const app of desiredAccessApps(ZONE, true)) {
      expect(app.tag).toBe("bosun:control-center");
    }
  });
});
