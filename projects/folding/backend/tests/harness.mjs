import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";

export const root = fileURLToPath(new URL("../", import.meta.url));

/** A local workerd instance of the built Worker with the given bindings. */
export function localWorker(options) {
  return new Miniflare(
    convertV4MiniflareOptions({
      workers: [
        {
          modules: [
            { type: "ESModule", path: `${root}crates/worker/build/index.js` },
            {
              type: "CompiledWasm",
              path: `${root}crates/worker/build/index_bg.wasm`,
            },
          ],
          compatibilityDate: "2026-11-04",
          ...options,
        },
      ],
    }),
  );
}

/** Applies every migration in order to a local D1 database. */
export async function applyMigrations(db) {
  const names = (await readdir(`${root}migrations`))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of names) {
    const source = await readFile(`${root}migrations/${name}`, "utf8");
    for (const sql of source.split(";").filter((s) => s.trim()))
      await db.prepare(sql).run();
  }
}
