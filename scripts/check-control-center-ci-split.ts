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
  workflow.includes('pulumi config set --path "wwwinfra:imageDigests.$svc"'),
  "deploy must keep wwwinfra:imageDigests namespace",
);

for (const image of [
  "www-control-center-api",
  "www-control-center-web",
  "www-control-center-worker",
  "www-control-center-media-worker",
  "www-control-center-storybook",
  "www-control-center-drizzle",
  "www-control-center-map-provision",
] as const) {
  assert(workflow.includes(`ghcr.io/0x63616c/${image}:`), `workflow must build ${image}`);
}

for (const digestKey of [
  "control-center-api",
  "control-center-web",
  "control-center-worker",
  "control-center-media-worker",
  "control-center-storybook",
  "control-center-drizzle",
  "control-center-map-provision",
] as const) {
  assert(workflow.includes(`:${digestKey}`), `digest collection must emit ${digestKey}`);
}

for (const oldImage of ["www-cc-api", "www-cc-web", "www-cc-worker"] as const) {
  assert(!workflow.includes(oldImage), `workflow must not use old shorthand image ${oldImage}`);
}

for (const script of requiredProductScripts) {
  assert(
    productPackage.scripts?.[script],
    `products/control-center/package.json missing ${script}`,
  );
}

console.info(
  "Control Center CI filters and product local commands are scoped to the product path.",
);
