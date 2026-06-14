// Static guard that load-bearing docs match the landed M4 product layout
// (www-jtp0.4.8). Docs drift silently, this fails CI if the operational docs
// stop naming every product folder or drop the product-aware CI/deploy rule
// that agents rely on to know a single product's change won't rebuild the rest.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { productSlugs } from "@repo/platform";

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf8");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// 1. CODEBASE_OVERVIEW must name every product folder, the compact map agents
//    read first has to list all four product lanes.
const overview = read("CODEBASE_OVERVIEW.md");
for (const slug of productSlugs) {
  assert(
    overview.includes(`products/${slug}`),
    `CODEBASE_OVERVIEW.md must reference products/${slug}`,
  );
}

// 2. AGENTS.md must carry the product-aware CI/deploy rule so future agents know
//    product isolation is enforced (a TYE-only change must not rebuild CC).
const agents = read("AGENTS.md");
assert(
  /product-aware/i.test(agents),
  "AGENTS.md must describe product-aware CI/deploy (per-product path filters)",
);

// 3. No load-bearing doc may keep the pre-M4 "legacy apps/* until M7" wrapper
//    guidance, the control-center runtime already moved under products/ in M4.4
//    and that stale note misdirects implementation agents.
for (const rel of ["AGENTS.md", "CODEBASE_OVERVIEW.md", "README.md"]) {
  assert(
    !/legacy `?apps\/\*`?/i.test(read(rel)),
    `${rel} still references legacy apps/* paths, update to the landed products/ layout`,
  );
}

console.info(
  "Product doc-path guard OK: overview names all products, agents doc is product-aware.",
);
