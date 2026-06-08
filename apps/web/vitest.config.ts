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
    // Cap concurrent forks: vitest defaults to ~cpu_count forks; each loads
    // jsdom + React + vite transform state (~400MB-1GB). 2 forks is enough for
    // the web suite and keeps peak RSS bounded (www-ddo9.3).
    pool: "forks",
    poolOptions: {
      forks: {
        maxForks: 2,
        minForks: 1,
        // Fork workers are child processes and do NOT inherit NODE_OPTIONS from
        // the parent vitest process. CI sets 12GB at job level (www-dasj); we
        // replicate that here so dev and CI have the same per-worker heap limit.
        execArgv: ["--max-old-space-size=12288"],
      },
    },
  },
});
