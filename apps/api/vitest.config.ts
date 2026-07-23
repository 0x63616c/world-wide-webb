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
  },
});
