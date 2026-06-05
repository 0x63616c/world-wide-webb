import { defineConfig } from "vitest/config";

// Root workspace: api + web + bosun unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from apps/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: ["apps/api", "apps/web", "packages/bosun"],
    // Coverage config lives here (not as CLI flags) so it can carry include/
    // exclude + thresholds; per-project config is ignored once `projects` is set,
    // so the root config is the only one that matters (www-355t.11). Without an
    // explicit `include`, v8 counts every transitively-loaded module
    // (node_modules, maplibre, …) and the line/statement % is meaningless.
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "text-summary"],
      include: ["apps/*/src/**", "packages/*/src/**"],
      exclude: [
        "**/*.test.*",
        "**/*.spec.*",
        "**/*.stories.*",
        "**/__tests__/**",
        "**/db/migrations/**",
        "**/*.d.ts",
        "**/*.gen.ts",
      ],
      // Regression floor, not a target. Lines/statements sit ~38% (lots of
      // untested SVG/map render code) while branches/functions are well covered;
      // autoUpdate ratchets each floor up as coverage improves so a drop fails CI.
      thresholds: {
        autoUpdate: true,
        lines: 38.23,
        statements: 38.23,
        functions: 82.57,
        branches: 89.52,
      },
    },
  },
});
