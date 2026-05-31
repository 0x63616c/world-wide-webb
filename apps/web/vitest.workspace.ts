/**
 * Vitest workspace for apps/web — defines both unit (jsdom) and storybook
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
  // Unit + component tests — jsdom, no browser needed.
  // This mirrors apps/web/vitest.config.ts so both configs stay in sync.
  "./vitest.config.ts",
  // Storybook browser tests — play functions run via Playwright/Chromium.
  // Run with: bunx vitest --project storybook (from apps/web directory).
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
