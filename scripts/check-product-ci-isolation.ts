// Red-first CI path-filter regression (www-jtp0.4.6).
//
// M4 requires product-aware CI: the workflow must emit a change output for
// every product lane (Control Center, Captive Portal) and prove product
// isolation, a Captive Portal-only change must not rebuild or
// deploy Control Center, while shared platform code (packages/, lockfile) must
// conservatively rebuild the products that import it.
//
// This is a static check over .github/workflows/ci.yml. It models dorny's
// OR-match semantics per filter block and asserts the product-level outputs and
// isolation guarantees hold for representative change sets.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// Extract a single paths-filter block body (the indented `- '...'` lines that
// follow `<name>:`).
function filterBlock(name: string): readonly string[] {
  const match = workflow.match(
    new RegExp(`\\n            ${name}:\\n(?<body>(?:              - .+\\n)+)`),
  );
  assert(match?.groups?.body, `Missing paths-filter block for ${name}`);
  return match.groups.body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.replace(/^- '/, "").replace(/'$/, ""));
}

function jobBlock(name: string): string {
  const match = workflow.match(
    new RegExp(`\\n  ${name}:\\n(?<body>[\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:|\\n?$)`),
  );
  assert(match?.groups?.body, `Missing workflow job ${name}`);
  return match.groups.body;
}

// Translate a dorny glob list entry into a predicate over a changed file path.
// Only the `**` suffix form used in this workflow is modelled.
function globMatches(glob: string, file: string): boolean {
  if (glob.endsWith("/**")) {
    return file.startsWith(glob.slice(0, -2));
  }
  return glob === file;
}

function blockMatchesAny(globs: readonly string[], files: readonly string[]): boolean {
  return files.some((file) => globs.some((glob) => globMatches(glob, file)));
}

const changesBlock = jobBlock("changes");
const expr = "${";

// 1. Every product lane must expose a change output.
const productOutputs = {
  "control-center (web)": "web",
  "control-center (api)": "api",
  captiveportal: "captiveportal",
} as const;
for (const [label, output] of Object.entries(productOutputs)) {
  assert(
    changesBlock.includes(`${output}: ${expr}{ steps.filter.outputs.${output} }}`),
    `changes job must expose the ${label} path-filter output (${output})`,
  );
}

// 2. Resolve the relevant filter blocks.
const filters = {
  web: filterBlock("web"),
  api: filterBlock("api"),
  worker: filterBlock("worker"),
  mediaworker: filterBlock("mediaworker"),
  captiveportal: filterBlock("captiveportal"),
  any_app: filterBlock("any_app"),
} as const;

// 3. The Captive Portal filter must key on its own product tree.
assert(
  filters.captiveportal.some((glob) => glob.startsWith("products/captive-portal")),
  "captiveportal filter must include products/captive-portal/**",
);

// 4. ISOLATION: a Captive Portal-only change must not rebuild Control Center
//    (web/api/worker/mediaworker), and must register as a captiveportal change.
const captivePortalIsolated = ["products/captive-portal/apps/frontend/src/main.ts"] as const;
assert(
  blockMatchesAny(filters.captiveportal, captivePortalIsolated),
  "captive-portal-only change must set captiveportal",
);
for (const lane of ["web", "api", "worker", "mediaworker"] as const) {
  assert(
    !blockMatchesAny(filters[lane], captivePortalIsolated),
    `captive-portal-only change must NOT trigger ${lane} rebuild (product isolation)`,
  );
}

// 5. CONSERVATIVE SHARED REBUILD: a shared platform change (packages/) must
//    rebuild the products that import it (Control Center web/api).
const sharedChange = ["packages/api/src/index.ts"] as const;
for (const lane of ["web", "api"] as const) {
  assert(
    blockMatchesAny(filters[lane], sharedChange),
    `shared packages/ change must conservatively rebuild ${lane}`,
  );
}

// 6. Infra-only changes deploy via pulumi with no image rebuild.
const captivePortalOnly = ["products/captive-portal/apps/api/src/server.ts"] as const;
assert(
  blockMatchesAny(filters.captiveportal, captivePortalOnly),
  "Captive Portal-only change must set captiveportal",
);
assert(
  blockMatchesAny(filters.any_app, captivePortalOnly),
  "Captive Portal-only change must set any_app so deploy runs after image builds",
);

// 7. Infra-only changes deploy via pulumi with no image rebuild.
const infraOnly = ["infra/src/crons.ts"] as const;
assert(!blockMatchesAny(filters.any_app, infraOnly), "infra-only change must not set any_app");
assert(blockMatchesAny(filterBlock("infra"), infraOnly), "infra-only change must set infra");

console.info(
  "Product CI path-filter isolation OK: 4 product lanes, isolation + shared-rebuild proven.",
);
