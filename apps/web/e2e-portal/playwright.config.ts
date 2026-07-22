import { defineConfig, devices } from "@playwright/test";

/**
 * Guest portal E2E harness (SDD track 0, task 2.6, password-only reality).
 * Mirrors products/captive-portal/apps/frontend/playwright.config.ts's
 * conventions (that suite's intent is REPLACED by this one — the old app
 * asserted a name/email flow that no longer exists).
 *
 * RAM discipline (the 32GB no-cgroups rule): chromium ONLY, ONE worker, NOT
 * fully parallel. A captive-webview flow is inherently sequential per device
 * and a single browser keeps the footprint to one Chromium (~1.5GB) instead
 * of one per core, the same reason the web Storybook browser project is
 * pinned serial.
 *
 * CI wiring is explicitly OUT of scope for this task (rides parent Task 5's
 * ci.yml edit) — this config runs locally via `bun run e2e:portal` only.
 */
const PORT = Number(process.env.PORTAL_E2E_PORT ?? 4206);
const BASE_URL = process.env.PORTAL_E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./",
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
    // The guest portal is most often opened by a captive-webview on a phone;
    // default to a phone-sized viewport, matching the old portal's harness.
    ...devices["Pixel 7"],
  },
  projects: [{ name: "chromium", use: { ...devices["Pixel 7"] } }],
  // Start the portal's Vite dev server for the run unless a base URL is
  // supplied (e.g. pointing at a deployed preview). reuseExistingServer
  // locally so a dev server already up on :4206 is reused; CI always starts
  // fresh (moot until Task 5 wires this suite into CI).
  webServer: process.env.PORTAL_E2E_BASE_URL
    ? undefined
    : {
        command: "bun run dev:portal",
        cwd: "..",
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
