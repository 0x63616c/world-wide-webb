import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// www-jtp0.3.7 / Task 7 hostname cutover: the iOS kiosk shell must default to
// the product host app.worldwidewebb.co (Control Center's private app route),
// with the local dev-server env override still honoured. The flattened
// app--cc.worldwidewebb.co route is retired only after a verified TestFlight
// build confirms the physical panel on the new host.
describe("capacitor kiosk server config", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function loadConfig() {
    const mod = await import("./capacitor.config");
    return mod.default;
  }

  test("production default URL is the app product host", async () => {
    vi.stubEnv("CAPACITOR_DEV_SERVER_URL", "");
    const config = await loadConfig();
    expect(config.server?.url).toBe("https://app.worldwidewebb.co");
  });

  test("CAPACITOR_DEV_SERVER_URL still overrides for local dev", async () => {
    vi.stubEnv("CAPACITOR_DEV_SERVER_URL", "http://localhost:4200");
    const config = await loadConfig();
    expect(config.server?.url).toBe("http://localhost:4200");
  });

  test("allowNavigation permits the product domain without over-broadening", async () => {
    const config = await loadConfig();
    expect(config.server?.allowNavigation).toContain("*.worldwidewebb.co");
    // No bare wildcard that would let the kiosk navigate off the product domain.
    expect(config.server?.allowNavigation).not.toContain("*");
  });
});
