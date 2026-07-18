import { defineConfig } from "vitest/config";

// Root workspace: api + web unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from products/control-center/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: [
      "products/control-center/api",
      "products/control-center/web",
      "products/control-center/worker",
      "products/control-center/media-worker",
      "products/captive-portal/apps/api",
      "products/captive-portal/apps/frontend",
      "products/project-management",
      "packages/logger",
      "packages/platform",
      // The `infra` project's default test glob also covers infra/unifi/test/**
      // (UniFi adopt-only stack, www-j934.3), so no separate project entry is
      // needed; a second entry would double-run those tests.
      "infra",
    ],
    // 2 workers: measured peak RSS is ~1.5GB per worker (jsdom + React +
    // v8 coverage), so 2 workers use ~3GB total, well within CI's 16GB runner.
    // Serial (maxWorkers: 1) was previously set based on a stale ~12GB/worker
    // estimate that didn't match actual measurements.
    maxWorkers: 2,
    pool: "forks",
    // Coverage config lives here (not as CLI flags) so it can carry include/
    // exclude + thresholds; per-project config is ignored once `projects` is set,
    // so the root config is the only one that matters (www-355t.11). Without an
    // explicit `include`, v8 counts every transitively-loaded module
    // (node_modules, maplibre, …) and the line/statement % is meaningless.
    coverage: {
      provider: "v8",
      reporter: ["json-summary", "text-summary"],
      include: [
        "products/control-center/*/src/**",
        "products/*/apps/*/src/**",
        "packages/*/src/**",
      ],
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
      // gated - no `thresholds` here. A coverage drop must never fail a CI job or
      // block a deploy (per Calum); the merged browser+unit number is also
      // slightly nondeterministic run-to-run, so a ratchet would flake. The test
      // job still fails on real test failures, just never on the coverage %.
    },
  },
});
