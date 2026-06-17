import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const workflow = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf8");

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

function jobBlock(name: string): string {
  const match = workflow.match(
    new RegExp(`\\n  ${name}:\\n(?<body>[\\s\\S]*?)(?=\\n  [a-zA-Z0-9_-]+:|\\n?$)`),
  );
  assert(match?.groups?.body, `Missing workflow job ${name}`);
  return match.groups.body;
}

function assertContains(text: string, needle: string, message: string): void {
  assert(text.includes(needle), message);
}

const changesBlock = jobBlock("changes");
const expressionOpen = "${";
assertContains(
  changesBlock,
  `amp: ${expressionOpen}{ steps.filter.outputs.amp }}`,
  "changes outputs must expose the amp path-filter result",
);

const ampFilter = filterBlock("amp");
for (const path of ["'products/amp/**'", "'packages/**'", "'bun.lock'"] as const) {
  assertContains(ampFilter, path, `amp filter must include ${path}`);
}

const anyAppFilter = filterBlock("any_app");
assertContains(anyAppFilter, "'products/amp/**'", "any_app must deploy for AMP product changes");

const buildAmp = jobBlock("build-amp");
for (const required of [
  "needs: [changes, test]",
  "needs.changes.outputs.amp == 'true'",
  "file: products/amp/Dockerfile",
  `ghcr.io/0x63616c/www-amp-app:${expressionOpen}{ github.sha }}`,
  `ghcr.io/0x63616c/www-amp-app:${expressionOpen}{ github.ref_name == 'main' && 'main' || github.sha }}`,
  "cache-from: type=gha,scope=amp",
  "cache-to: type=gha,mode=max,scope=amp",
] as const) {
  assertContains(buildAmp, required, `build-amp job must include ${required}`);
}

const deploy = jobBlock("deploy");
for (const required of [
  "build-amp",
  "amp-app",
  'pulumi config set --path "wwwinfra:imageDigests.$svc"',
] as const) {
  assertContains(deploy, required, `deploy job must include ${required}`);
}

console.info("AMP CI and deploy workflow wiring is present.");
