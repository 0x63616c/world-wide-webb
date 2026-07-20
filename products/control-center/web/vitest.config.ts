import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Board integration suites exceed the 5s default under v8 coverage
    // instrumentation on CI runners (they pass in well under 5s uninstrumented).
    testTimeout: 20_000,
  },
});
