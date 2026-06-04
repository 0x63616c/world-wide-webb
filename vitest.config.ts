import { defineConfig } from "vitest/config";

// Root workspace: api + web + bosun unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from apps/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: ["apps/api", "apps/web", "packages/bosun"],
  },
});
