import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

type ServiceBoundary = Readonly<{
  name: string;
  packageName: string;
  productPath: string;
  legacyPath: string;
  dockerfile?: string;
}>;

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const productRoot = "products/control-center";
const expectedServices: readonly ServiceBoundary[] = [
  {
    name: "web",
    packageName: "@control-center/web",
    productPath: `${productRoot}/web`,
    legacyPath: "apps/web",
    dockerfile: "apps/web/Dockerfile",
  },
  {
    name: "api",
    packageName: "@control-center/api",
    productPath: `${productRoot}/api`,
    legacyPath: "apps/api",
    dockerfile: "apps/api/Dockerfile",
  },
  {
    name: "worker",
    packageName: "@control-center/worker",
    productPath: `${productRoot}/worker`,
    legacyPath: "apps/worker",
    dockerfile: "apps/worker/Dockerfile",
  },
  {
    name: "media-worker",
    packageName: "@control-center/media-worker",
    productPath: `${productRoot}/media-worker`,
    legacyPath: "apps/media-worker",
    dockerfile: "apps/media-worker/Dockerfile",
  },
  {
    name: "storybook",
    packageName: "@control-center/storybook",
    productPath: `${productRoot}/storybook`,
    legacyPath: "apps/web",
    dockerfile: "apps/web/Dockerfile.storybook",
  },
  {
    name: "ios",
    packageName: "@control-center/ios",
    productPath: `${productRoot}/ios`,
    legacyPath: "apps/web/ios",
  },
] as const;

function readJson(relativePath: string): JsonRecord {
  return JSON.parse(readFileSync(join(repoRoot, relativePath), "utf8")) as JsonRecord;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function findManifestEntry(services: readonly JsonRecord[], serviceName: string): JsonRecord {
  const entry = services.find((candidate) => candidate.name === serviceName);
  assert(entry, `product manifest must list ${serviceName}`);
  return entry;
}

const rootPackage = readJson("package.json");
assert(
  Array.isArray(rootPackage.workspaces) &&
    rootPackage.workspaces.includes("products/control-center/*"),
  "root package.json must include products/control-center/* as a workspace glob",
);

const manifestPath = `${productRoot}/product.json`;
assert(
  existsSync(join(repoRoot, manifestPath)),
  `${manifestPath} must define the product boundary`,
);
const manifest = readJson(manifestPath);
assert(manifest.product === "control-center", "product manifest must identify control-center");
assert(Array.isArray(manifest.services), "product manifest must list service ownership boundaries");

for (const service of expectedServices) {
  const manifestEntry = findManifestEntry(manifest.services as JsonRecord[], service.name);
  assert(
    manifestEntry.packageName === service.packageName,
    `${service.name} must use ${service.packageName}`,
  );
  assert(
    manifestEntry.productPath === service.productPath,
    `${service.name} product path must be ${service.productPath}`,
  );
  assert(
    manifestEntry.legacyPath === service.legacyPath,
    `${service.name} legacy path must stay explicit`,
  );
  if (service.dockerfile) {
    assert(
      manifestEntry.dockerfile === service.dockerfile,
      `${service.name} Dockerfile must stay explicit`,
    );
  }

  const packagePath = `${service.productPath}/package.json`;
  assert(existsSync(join(repoRoot, packagePath)), `${packagePath} must exist`);
  const productPackage = readJson(packagePath);
  assert(
    productPackage.name === service.packageName,
    `${packagePath} must be named ${service.packageName}`,
  );
  assert(productPackage.private === true, `${packagePath} must stay private`);
  assert(productPackage.type === "module", `${packagePath} must be an ESM package`);
}

assert(
  existsSync(join(repoRoot, "packages/logger/package.json")),
  "packages/logger must remain shared platform code",
);
assert(
  !existsSync(join(repoRoot, `${productRoot}/logger`)),
  "logger must not be copied into the product boundary",
);

const apiBridgeSource = readFileSync(join(repoRoot, "packages/api/src/trpc.ts"), "utf8");
assert(
  apiBridgeSource.includes("export type { AppRouter }") &&
    !apiBridgeSource.includes("export { AppRouter }"),
  "packages/api trpc bridge must remain type-only",
);

console.info(
  "Control Center product boundary is declared and compatibility wrappers are explicit.",
);
