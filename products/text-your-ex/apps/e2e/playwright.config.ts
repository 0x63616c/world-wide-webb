import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = 18788;

// E2E tests require a real Postgres instance. Set DATABASE_URL to point at one.
// Local dev: run `tilt up` (starts Docker Postgres) then `bun run e2e`.
// CI: a postgres service container sets DATABASE_URL automatically.
// If DATABASE_URL is unset, the webServer command will fail and tests are skipped.
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres:devpass@localhost:5432/text_your_ex";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // shared Postgres DB per run, run serially to avoid races
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://${HOST}:${PORT}`,
    viewport: { width: 1200, height: 980 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The API runs migrations + seeds the demo data on startup (APP_ENV=development).
    // TYE_RESET=1 truncates all tables before seeding (clean slate per run).
    command: `TYE_RESET=1 DATABASE_URL=${DATABASE_URL} APP_ENV=development PORT=${PORT} bun run ${root}/apps/api/src/index.ts`,
    port: PORT,
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
