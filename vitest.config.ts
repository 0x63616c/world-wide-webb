import { defineConfig } from "vitest/config";

// Root workspace: api + web + bosun unit tests. Storybook browser tests run separately via
// `bunx vitest --project storybook` from apps/web (requires Playwright/Chromium).
export default defineConfig({
  test: {
    projects: [
      "apps/api",
      "apps/web",
      "apps/worker",
      "apps/media-worker",
      "packages/bosun",
      "packages/logger",
      "infra",
    ],
    // Cap worker fan-out. vitest spawns ~1 fork per core by default (~0.5-1GB
    // each with jsdom + v8 coverage); once the suite grew (media-ingest +
    // Spotify/Sonos/AppleTV) that fan-out OOM-kills CI's runner - the coverage
    // run writes its blob then dies, surfacing as a non-deterministic "exited
    // with code 1" that passes on a 32GB dev box but fails in CI. The web
    // project alone peaks at ~12GB per worker, so 2 concurrent workers saturate
    // the machine. Pinned to 1 serial fork (www-ddo9.5; original cap was www-kp4k).
    maxWorkers: 1,
    minWorkers: 1,
    // Per-project poolOptions are ignored in workspace mode - only the root pool
    // config applies. The execArgv must live here so fork workers get the heap
    // ceiling; without it they crash at node's 4GB default (www-ddo9.5).
    pool: "forks",
    poolOptions: {
      forks: {
        // Single fork: the web suite loads jsdom+React+v8-coverage which peaks
        // at ~12GB per worker; two concurrent workers saturate the 32GB dev box
        // and OOM-kill CI. Serial is slower but deterministic (www-ddo9.5).
        maxForks: 1,
        minForks: 1,
        // Raise fork worker heap so the full jsdom+v8-coverage module graph fits.
        // NODE_OPTIONS is set by the root test script but child_process.fork()
        // workers need the flag passed explicitly via execArgv (www-ddo9.5).
        execArgv: ["--max-old-space-size=12288"],
      },
    },
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
      // gated - no `thresholds` here. A coverage drop must never fail a CI job or
      // block a deploy (per Calum); the merged browser+unit number is also
      // slightly nondeterministic run-to-run, so a ratchet would flake. The test
      // job still fails on real test failures, just never on the coverage %.
    },
  },
});
