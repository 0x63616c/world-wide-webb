// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("production build includes a nomodule script fallback for captive webviews", async () => {
  const testDir = dirname(fileURLToPath(import.meta.url));
  const appRoot = resolve(testDir, "../..");
  const outDir = await mkdtemp(join(tmpdir(), "cc-portal-legacy-"));

  try {
    await build({
      root: appRoot,
      configFile: resolve(appRoot, "vite.config.ts"),
      build: {
        outDir,
        emptyOutDir: true,
      },
    });

    const html = await readFile(join(outDir, "index.html"), "utf8");

    expect(html).toMatch(/<script\b(?=[^>]*\bnomodule\b)[^>]*\bsrc=/);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 30_000);
