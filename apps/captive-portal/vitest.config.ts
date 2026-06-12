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
    // Unit tests live under src/. Scope vitest there so it never tries to run
    // the Playwright specs in e2e/ (CC-q002.16), which are driven by Playwright,
    // not vitest, and otherwise fail collection here.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
      },
    },
  },
});
