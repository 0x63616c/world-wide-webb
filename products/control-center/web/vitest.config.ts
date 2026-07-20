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
    // Board integration suites exceed the 5s default under CI's higher worker
    // parallelism (maxWorkers: 4 contends for CPU across runs; they pass in
    // well under 5s on an idle machine).
    testTimeout: 20_000,
  },
});
