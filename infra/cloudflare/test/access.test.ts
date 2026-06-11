import { describe, expect, test } from "vitest";
import { desiredAccessApps } from "../src/access.ts";

// ADOPT-ONLY (www-j934.2): desiredAccessApps() must reproduce the DEPLOYED CF
// Access surface EXACTLY (verified live 2026-06-11) so the first `pulumi preview`
// after import is 0 create / 0 delete / 0 replace. Only storybook + drizzle exist
// today (email-OTP allow apps); the wildcard Block floor + dashboard
// service-token app are deliberately deferred (www-cuuw plan §6, tracked in
// www-jhly) and MUST NOT be declared here.

const ZONE = "worldwidewebb.co";

describe("desiredAccessApps", () => {
  test("declares exactly the two DEPLOYED apps (storybook + drizzle), nothing more", () => {
    const domains = desiredAccessApps(ZONE)
      .map((a) => a.domain)
      .sort();
    expect(domains).toEqual(["drizzle.worldwidewebb.co", "storybook.worldwidewebb.co"]);
  });

  test("does NOT declare the not-yet-built floor or dashboard app (www-jhly territory)", () => {
    const domains = desiredAccessApps(ZONE).map((a) => a.domain);
    expect(domains).not.toContain("*.worldwidewebb.co");
    expect(domains).not.toContain("dashboard.worldwidewebb.co");
    expect(domains).not.toContain("hooks.worldwidewebb.co");
  });

  test("both apps are self_hosted allow with the email sourced from secret config (no literal)", () => {
    for (const app of desiredAccessApps(ZONE)) {
      expect(app.type).toBe("self_hosted");
      expect(app.decision).toBe("allow");
      // Principal references the config key, never an inline email address.
      expect(app.emailFromConfig).toBe("allowedEmail");
    }
  });

  test("every app carries the live ownership tag so the import is zero-diff", () => {
    for (const app of desiredAccessApps(ZONE)) {
      expect(app.tag).toBe("bosun:control-center");
    }
  });
});
