import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const HOST = "127.0.0.1";
const PORT = 18788;

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // shared in-memory DB on one server → run serially
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
    // Fresh in-memory DB each run (new process = fresh seed). dist is built by
    // the `test` script before Playwright starts, so static serving is mounted.
    command: `TYE_DB=:memory: PORT=${PORT} bun run ${root}server/src/index.ts`,
    port: PORT,
    timeout: 30_000,
    reuseExistingServer: false,
    stdout: "pipe",
    stderr: "pipe",
  },
});
