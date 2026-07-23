import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Authoring-surface aliases (Track C, C7). apps/api consumes the folded
  // guest-wifi feature (the portal facet + PortalError + purge + schema) via
  // `@features/*`, and the feature's api.ts reaches the trpc runtime through
  // `@app-kit/server`; these resolvers must agree with tsconfig/vite/the root
  // vitest config (check-alias-parity.sh). `@app-kit/server` precedes `@app-kit`
  // (prefix match).
  resolve: {
    alias: {
      "@app-kit/server": resolve(__dirname, "../../app-kit/server.ts"),
      "@app-kit": resolve(__dirname, "../../app-kit/index.ts"),
      "@features": resolve(__dirname, "../../features"),
    },
  },
  test: {
    environment: "node",
    // Seed the @www/logger root before every test file so that getLogger()
    // never throws in tests that import domain services which call getLogger().
    setupFiles: ["src/__tests__/setup-logger.ts"],
    // Collect this project's own tests PLUS the node-shaped facet tests of every
    // folded feature (Track C). A feature is self-contained (AGENTS.md), so its
    // tests live beside it in features/<id>/; every backend-facet `*.test.ts`
    // directly under a feature's root (service/api/jobs/ingest/etc — weather is
    // the first fold with more than service+api) runs in node here, while the
    // `web*.test.tsx` / `web/**/*.test.tsx` frontend facet runs under apps/web
    // (jsdom). Keep this in sync with apps/web/vitest.config.ts.
    include: ["**/*.{test,spec}.?(c|m)[jt]s?(x)", "../../features/*/*.test.ts"],
  },
});
