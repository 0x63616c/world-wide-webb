import { defineConfig } from "vitest/config";

// Unit tests for bosun spec-config module.
export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      // Allow test files to import "@bosun/spec" as if installed.
      "@bosun/spec": new URL("./src/spec.ts", import.meta.url).pathname,
    },
  },
});
