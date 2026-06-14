import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
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
