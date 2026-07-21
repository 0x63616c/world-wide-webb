import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Board integration suites exceed the 5s default under CI's higher worker
    // parallelism (maxWorkers: 4 contends for CPU across runs; they pass in
    // well under 5s on an idle machine).
    testTimeout: 20_000,
    // e2e-portal/*.spec.ts are Playwright specs (run via `bun run e2e:portal`
    // / e2e-portal/playwright.config.ts, not vitest). Vitest's default include
    // glob matches *.spec.ts too, so without an exclude it collects them and
    // crashes on their top-level `test.describe`/`test.beforeEach` (the
    // Playwright `test` fixture, not vitest's). Spread configDefaults.exclude
    // rather than a bare override, or setting `exclude` drops vitest's own
    // node_modules/dist/cypress/etc defaults (SDD track 0, Task 4).
    exclude: [...configDefaults.exclude, "e2e-portal/**"],
  },
});
