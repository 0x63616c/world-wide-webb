import { defineConfig, devices } from "@playwright/test";

/**
 * Captive-portal E2E harness (www-q002.16, PREP). The full flow matrix activates
 * once the screens (www-q002.6) + state machine (www-q002.7) land; until then the
 * suite is one smoke spec proving the placeholder app boots, paints pure black,
 * and self-hosts its fonts.
 *
 * RAM discipline (the 32GB no-cgroups rule): chromium ONLY, ONE worker, NOT
 * fully parallel. A captive-webview flow is inherently sequential per device and
 * a single browser keeps the footprint to one Chromium (~1.5GB) instead of one
 * per core, the same reason the web Storybook browser project is pinned serial.
 */
const PORT = Number(process.env.PORTAL_E2E_PORT ?? 4205);
const BASE_URL = process.env.PORTAL_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // One worker, files run in series, see the RAM note above.
  workers: 1,
  fullyParallel: false,
  // CI must never pass on accidentally-committed test.only.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    // Captive portals render in a mobile webview most often; default to a
    // phone-sized viewport. Desktop coverage is a per-project add when the
    // flow specs land.
    ...devices["Pixel 7"],
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  // Start the Vite dev server for the run unless a base URL is supplied
  // (e.g. pointing at a deployed preview). reuseExistingServer locally so a
  // dev server already up on :4205 is reused; CI always starts fresh.
  webServer: process.env.PORTAL_E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
