import { defineConfig } from "vitest/config";

// Root workspace: api + web + bosun unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from apps/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: ["apps/api", "apps/web", "apps/worker", "packages/bosun"],
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
      // Coverage is REPORTED (the % feeds the README badge) but deliberately NOT
      // gated — no `thresholds` here. A coverage drop must never fail a CI job or
      // block a deploy (per Calum); the merged browser+unit number is also
      // slightly nondeterministic run-to-run, so a ratchet would flake. The test
      // job still fails on real test failures, just never on the coverage %.
    },
  },
});
