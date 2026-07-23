import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Authoring-surface aliases (S1, Track C). The seam-proof test imports
  // `@features/_generated/jobs.gen` at RUNTIME (esbuild/vitest resolves this,
  // not tsc); that generated barrel imports features/notif/jobs.ts, which
  // imports `defineJobs` from `@app-kit` , so both aliases are needed here,
  // mirroring apps/api's vitest config.
  resolve: {
    alias: {
      "@app-kit/server": resolve(__dirname, "../../app-kit/server.ts"),
      "@app-kit": resolve(__dirname, "../../app-kit/index.ts"),
      "@features": resolve(__dirname, "../../features"),
    },
  },
  test: {
    environment: "node",
    // Seed the @www/logger root before every test file (S1: the jobs-seam test
    // invokes the real notify handler, which logs). Mirrors apps/api.
    setupFiles: ["src/__tests__/setup-logger.ts"],
  },
});
