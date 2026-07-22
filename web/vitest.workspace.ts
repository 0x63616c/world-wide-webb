/**
 * Vitest workspace for products/control-center/web , defines both unit (jsdom) and storybook
 * (Playwright browser) projects so `bunx vitest --project storybook` works
 * when run from this directory.
 *
 * Root workspace (`vitest.config.ts`) references this directory and uses
 * `vitest.config.ts` for the default unit-only run.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { defineWorkspace } from "vitest/config";

const __dirname = resolve(fileURLToPath(import.meta.url), "..");

export default defineWorkspace([
  // Unit + component tests , jsdom, no browser needed.
  // This mirrors products/control-center/web/vitest.config.ts so both configs stay in sync.
  "./vitest.config.ts",
  // Storybook browser tests , play functions run via Playwright/Chromium.
  // Run with: bunx vitest --project storybook (from products/control-center/web directory).
  {
    extends: "./vite.config.ts",
    plugins: [
      storybookTest({
        configDir: resolve(__dirname, ".storybook"),
        storybookScript: "bun run storybook --no-open",
      }),
    ],
    test: {
      name: "storybook",
      // Serialize test files: parallel files overload the single Chromium
      // instance and cause flaky suite-load failures (8 suites "failed" under
      // load but pass in isolation). Serialized, the suite is deterministic.
      // Keep this here so every caller (CI coverage, local runs) is stable.
      // @ts-expect-error fileParallelism is a valid runtime project option but is
      // absent from vitest's ProjectConfig type in this version; dropping it
      // reintroduces the Storybook flake (www-hjvu), so keep it and suppress.
      fileParallelism: false,
      browser: {
        enabled: true,
        provider: "playwright",
        headless: true,
        instances: [{ browser: "chromium" }],
      },
      setupFiles: ["./.storybook/vitest.setup.ts"],
    },
  },
]);
