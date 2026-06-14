import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");
const productPackage = JSON.parse(
  readFileSync(join(repoRoot, "products/control-center/package.json"), "utf8"),
) as { scripts?: Record<string, string> };

const controlCenterFilters = [
  "web",
  "api",
  "worker",
  "mediaworker",
  "storybook",
  "drizzle",
  "mapprovision",
] as const;

const requiredProductScripts = [
  "dev:web",
  "dev:api",
  "dev:worker",
  "dev:media-worker",
  "dev:storybook",
  "dev:db",
  "ios:sync",
  "ios:open",
  "ios:sim",
] as const;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function filterBlock(name: string): string {
  const match = workflow.match(
    new RegExp(`\\n            ${name}:\\n(?<body>(?:              - .+\\n)+)`),
  );
  assert(match?.groups?.body, `Missing paths-filter block for ${name}`);
  return match.groups.body;
}

for (const filter of controlCenterFilters) {
  const block = filterBlock(filter);
  assert(
    block.includes("'products/control-center/**'"),
    `${filter} filter must include products/control-center/**`,
  );
  assert(
    !block.includes("'products/**'"),
    `${filter} filter must not include unrelated products/**`,
  );
}

const anyAppBlock = filterBlock("any_app");
assert(
  anyAppBlock.includes("'products/control-center/**'"),
  "any_app filter must deploy for Control Center product path changes",
);
assert(
  !anyAppBlock.includes("'products/**'"),
  "any_app filter must not deploy Control Center for unrelated products/** changes",
);

assert(
  workflow.includes('pulumi config set --path "ccinfra:imageDigests.$svc"'),
  "deploy must keep ccinfra:imageDigests namespace",
);

for (const script of requiredProductScripts) {
  assert(
    productPackage.scripts?.[script],
    `products/control-center/package.json missing ${script}`,
  );
}

console.info(
  "Control Center CI filters and product local commands are scoped to the product path.",
);
