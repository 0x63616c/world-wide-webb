import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Seed the @www/logger root before every test file so that getLogger()
    // never throws in tests that import domain services which call getLogger().
    setupFiles: ["src/__tests__/setup-logger.ts"],
  },
});
