import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Seed the @www/logger root before every test file so getLogger() never
    // throws in tests exercising core clients that log (mirrors apps/api).
    setupFiles: ["vitest.setup.ts"],
  },
});
