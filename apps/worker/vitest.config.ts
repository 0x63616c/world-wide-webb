import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Authoring-surface alias (S1, Track C). The seam-proof test imports
  // `@features/_generated/jobs.gen` at RUNTIME (esbuild/vitest resolves this,
  // not tsc), mirroring apps/api's vitest config.
  resolve: {
    alias: {
      "@features": resolve(__dirname, "../../features"),
    },
  },
  test: {
    environment: "node",
  },
});
