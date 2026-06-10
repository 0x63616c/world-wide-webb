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
    // Cap concurrent forks: vitest defaults to ~cpu_count forks; each loads
    // jsdom + React + vite transform state (~400MB-1GB). 2 forks keeps peak
    // RSS bounded (mirrors apps/web; CC-ddo9.3 / 32GB-machine rule).
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
        // Fork workers are child processes and do NOT inherit NODE_OPTIONS from
        // the parent vitest process; replicate CI's per-worker heap limit here.
        execArgv: ["--max-old-space-size=12288"],
      },
    },
  },
});
