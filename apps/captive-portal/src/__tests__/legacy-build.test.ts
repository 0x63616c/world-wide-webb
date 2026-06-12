// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

test("production build includes CNA-safe legacy script fallbacks", async () => {
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

    const classicLoaderTag = html.match(/<script\b[^>]*\bid="script_cna_legacy_loader"[^>]*>/)?.[0];

    expect(html).toMatch(/<script\b(?=[^>]*\bnomodule\b)[^>]*\bsrc=/);
    expect(classicLoaderTag).toBeDefined();
    expect(classicLoaderTag).not.toMatch(/\btype=/);
    expect(html).toContain("vite-legacy-entry");
    expect(html).toContain("vite-legacy-polyfill");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 30_000);
