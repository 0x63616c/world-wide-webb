import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@cc/captive-portal-api",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
