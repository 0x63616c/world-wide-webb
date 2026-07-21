import { defineConfig } from "vitest/config";

// Root workspace: api + web unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from products/control-center/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: [
      "products/control-center/api",
      "products/control-center/web",
      "products/control-center/worker",
      "packages/logger",
      "packages/platform",
      "packages/worker-runtime",
      // The `infra` project's default test glob also covers infra/unifi/test/**
      // (UniFi adopt-only stack, www-j934.3), so no separate project entry is
      // needed; a second entry would double-run those tests.
      "infra",
    ],
    // 4 workers: public-repo runners are 4 vCPU / 16GB. Peak RSS was measured at
    // ~1.5GB per worker back when v8 coverage was still instrumented; without it
    // 4 workers sit well under half the available RAM, so cores are the binding
    // constraint, not memory. Measured parallel efficiency at 2 workers was 89%
    // (386.9s of phase work in 218.5s wall), so this scales close to linearly.
    // If the suite starts flaking on timing-sensitive Board tests, or a worker
    // OOMs, drop back to 2 — this is a tuning knob, not a correctness boundary.
    maxWorkers: 4,
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
      // Coverage is REPORTED but deliberately NOT gated - no `thresholds` here.
      // A coverage drop must never fail a CI job or block a deploy (per Calum);
      // the merged browser+unit number is also slightly nondeterministic
      // run-to-run, so a ratchet would flake. The test-unit/test-storybook jobs
      // still fail on real test failures, just never on the coverage %.
    },
  },
});
