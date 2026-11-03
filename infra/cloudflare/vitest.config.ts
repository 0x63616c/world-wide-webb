import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { name: "@www/infra-cloudflare", include: ["test/**/*.test.ts"] },
});
