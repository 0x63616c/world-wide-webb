import { defineProduct, homelabTarget, privateWeb, publicWeb } from "@www/platform";
import { describe, expect, test } from "vitest";
import { accessAppsForPrivateWeb, desiredAccessApps } from "../src/access.ts";

// M3 moves private exposure toward a default-deny Cloudflare Access contract.
// Existing Storybook/Drizzle policy resource names stay stable in program.ts so
// the migration does not delete protected legacy resources.

const ZONE = "worldwidewebb.co";

describe("desiredAccessApps", () => {
  test("DEFAULT (gate off): product routes + existing tooling, but NO wildcard floor or hooks lock", () => {
    // www-b6ad: the not-yet-live gate additions (the *.<zone> default-deny floor
    // and the hooks CI lock) are off by default, so the floor can never block a
    // currently-public host (live dashboard, public app--tye) before it has an
    // explicit bypass. Already-live storybook/drizzle protections are kept.
    const domains = desiredAccessApps(ZONE)
      .map((a) => a.domain)
      .sort();
    expect(domains).toEqual([
      "app--amp.worldwidewebb.co",
      "app--cc.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "storybook.worldwidewebb.co",
    ]);
    expect(domains).not.toContain("*.worldwidewebb.co");
    expect(domains).not.toContain("hooks.worldwidewebb.co");
  });

  test("declares the wildcard block floor, app.amp email-otp, app.cc kiosk, hooks CI, and legacy tooling apps", () => {
    const domains = desiredAccessApps(ZONE, true)
      .map((a) => a.domain)
      .sort();
    expect(domains).toEqual([
      "*.worldwidewebb.co",
      "app--amp.worldwidewebb.co",
      "app--cc.worldwidewebb.co",
      "drizzle.worldwidewebb.co",
      "hooks.worldwidewebb.co",
      "storybook.worldwidewebb.co",
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

  test("supports kiosk service-token access for app.cc", () => {
    const dashboard = desiredAccessApps(ZONE, true).find(
      (app) => app.domain === "app--cc.worldwidewebb.co",
    );

    expect(dashboard?.policies).toEqual([
      {
        decision: "allow",
        include: { configKey: "kioskTokenId", kind: "service-token-config" },
        name: "kiosk-service-token",
        precedence: 1,
      },
    ]);
  });

  test("keeps hooks on CI service-token access, not human-only SSO", () => {
    const hooks = desiredAccessApps(ZONE, true).find(
      (app) => app.domain === "hooks.worldwidewebb.co",
    );

    expect(hooks?.policies).toEqual([
      {
        decision: "allow",
        include: { configKey: "ciClientId", kind: "service-token-config" },
        name: "ci-service-token",
        precedence: 1,
      },
    ]);
  });

  test("protects app.amp with email-otp (private-web; no service token, no api.amp)", () => {
    const ampApp = desiredAccessApps(ZONE, true).find(
      (app) => app.domain === "app--amp.worldwidewebb.co",
    );

    expect(ampApp?.policies).toEqual([
      {
        decision: "allow",
        include: { configKey: "allowedEmail", kind: "email-config" },
        name: "email-otp",
        precedence: 1,
      },
    ]);
    // api.amp must NOT appear: AMP v0 is stateless with no public API route.
    const domains = desiredAccessApps(ZONE, true).map((a) => a.domain);
    expect(domains).not.toContain("api--amp.worldwidewebb.co");
  });

  test("keeps Storybook and Drizzle on email OTP with no literal personal email", () => {
    for (const domain of ["storybook.worldwidewebb.co", "drizzle.worldwidewebb.co"]) {
      const app = desiredAccessApps(ZONE, true).find((entry) => entry.domain === domain);

      expect(app?.policies).toEqual([
        {
          decision: "allow",
          include: { configKey: "allowedEmail", kind: "email-config" },
          name: "email-otp",
          precedence: 1,
        },
      ]);
    }
    expect(JSON.stringify(desiredAccessApps(ZONE, true))).not.toMatch(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+/i,
    );
  });

  test("derives future privateWeb apps without gating publicWeb", () => {
    const amp = defineProduct("amp");
    const textYourEx = defineProduct("text-your-ex");

    expect(
      accessAppsForPrivateWeb([
        { exposure: privateWeb(amp, homelabTarget, { host: "app" }), policies: ["email-otp"] },
        { exposure: publicWeb(textYourEx, homelabTarget, { host: "app" }), policies: ["email-otp"] },
      ]).map((app) => app.domain),
    ).toEqual(["app--amp.worldwidewebb.co"]);
  });

  test("every app carries the live ownership tag so the import is zero-diff", () => {
    for (const app of desiredAccessApps(ZONE, true)) {
      expect(app.tag).toBe("bosun:control-center");
    }
  });
});
