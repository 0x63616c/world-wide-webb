import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Authoring-surface aliases (S1, Track C). The worker entrypoint resolves
  // `@features/_generated/workers.gen` at RUNTIME (esbuild/vitest resolves
  // this, not tsc); that generated barrel imports each feature's worker.ts,
  // which imports `defineWorkerCycles` from `@app-kit` — so both aliases are
  // needed here, mirroring apps/api's vitest config.
  resolve: {
    alias: {
      "@app-kit/server": resolve(__dirname, "../../app-kit/server.ts"),
      "@app-kit": resolve(__dirname, "../../app-kit/index.ts"),
      "@features": resolve(__dirname, "../../features"),
    },
  },
  test: {
    environment: "node",
    // Seed the @www/logger root before every test file, so a cycle that logs
    // does not throw "getLogger() called before createLogger". Mirrors apps/api.
    setupFiles: ["src/__tests__/setup-logger.ts"],
  },
});
