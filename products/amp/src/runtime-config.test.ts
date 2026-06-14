// @vitest-environment node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("AMP runtime config", () => {
  it("serves a JS-free health endpoint and loud missing assets", async () => {
    const nginxConfig = await readFile(resolve(appRoot, "nginx.conf"), "utf8");

    expect(nginxConfig).toContain("location = /health");
    expect(nginxConfig).toContain("return 200 'ok';");
    expect(nginxConfig).toContain("location /assets/");
    expect(nginxConfig).toContain("try_files $uri =404;");
    expect(nginxConfig).toContain("try_files $uri $uri/ /index.html;");
  });

  it("builds a static nginx runtime without secrets, API, or database wiring", async () => {
    const dockerfile = await readFile(resolve(appRoot, "Dockerfile"), "utf8");

    expect(dockerfile).toContain("FROM oven/bun:1.2-alpine AS builder");
    expect(dockerfile).toContain("FROM nginx:1.27-alpine AS runtime");
    expect(dockerfile).toContain(
      "COPY --from=builder /app/products/amp/dist /usr/share/nginx/html",
    );
    expect(dockerfile).toContain("RUN bun run --cwd products/amp build");
    expect(dockerfile).not.toMatch(/SECRET|DATABASE|API_/);
  });
});
