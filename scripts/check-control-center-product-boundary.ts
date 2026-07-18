import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type JsonRecord = Record<string, unknown>;

type ServiceBoundary = Readonly<{
  name: string;
  packageName: string;
  productPath: string;
  dockerfile?: string;
  requiredFiles: readonly string[];
  oldRuntimePath?: string;
}>;

const repoRoot = import.meta.dir.replace(/\/scripts$/, "");
const productRoot = "products/control-center";
const expectedServices: readonly ServiceBoundary[] = [
  {
    name: "web",
    packageName: "@control-center/web",
    productPath: `${productRoot}/web`,
    dockerfile: `${productRoot}/web/Dockerfile`,
    requiredFiles: ["src", "ios", "vite.config.ts", "Dockerfile", "Dockerfile.storybook"],
    oldRuntimePath: "apps/web",
  },
  {
    name: "api",
    packageName: "@control-center/api",
    productPath: `${productRoot}/api`,
    dockerfile: `${productRoot}/api/Dockerfile`,
    requiredFiles: ["src", "drizzle.config.ts", "Dockerfile"],
    oldRuntimePath: "apps/api",
  },
  {
    name: "worker",
    packageName: "@control-center/worker",
    productPath: `${productRoot}/worker`,
    dockerfile: `${productRoot}/worker/Dockerfile`,
    requiredFiles: ["src", "Dockerfile"],
    oldRuntimePath: "apps/worker",
  },
  {
    name: "media-worker",
    packageName: "@control-center/media-worker",
    productPath: `${productRoot}/media-worker`,
    dockerfile: `${productRoot}/media-worker/Dockerfile`,
    requiredFiles: ["src", "Dockerfile"],
    oldRuntimePath: "apps/media-worker",
  },
  {
    name: "storybook",
    packageName: "@control-center/storybook",
    productPath: `${productRoot}/storybook`,
    dockerfile: `${productRoot}/web/Dockerfile.storybook`,
    requiredFiles: ["package.json"],
  },
  {
    name: "ios",
    packageName: "@control-center/ios",
    productPath: `${productRoot}/ios`,
    requiredFiles: ["package.json"],
  },
  {
    name: "drizzle",
    packageName: "@control-center/drizzle",
    productPath: `${productRoot}/drizzle`,
    dockerfile: `${productRoot}/drizzle/Dockerfile`,
    requiredFiles: ["Dockerfile", "load-secret.js"],
    oldRuntimePath: "apps/drizzle",
  },
  {
    name: "map-provision",
    packageName: "@control-center/map-provision",
    productPath: `${productRoot}/map-provision`,
    dockerfile: `${productRoot}/map-provision/Dockerfile`,
    requiredFiles: ["Dockerfile", "provision.sh"],
    oldRuntimePath: "apps/map-provision",
  },
] as const;

const dockerfilesWithWorkspaceManifests = [
  `${productRoot}/api/Dockerfile`,
  `${productRoot}/drizzle/Dockerfile`,
  `${productRoot}/map-provision/Dockerfile`,
  `${productRoot}/media-worker/Dockerfile`,
  `${productRoot}/web/Dockerfile`,
  `${productRoot}/web/Dockerfile.storybook`,
  `${productRoot}/worker/Dockerfile`,
  "products/captive-portal/apps/frontend/Dockerfile",
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
    !Object.hasOwn(manifestEntry, "legacyPath"),
    `${service.name} must not keep a legacyPath after the runtime move`,
  );
  if (service.dockerfile) {
    assert(
      manifestEntry.dockerfile === service.dockerfile,
      `${service.name} Dockerfile must stay explicit`,
    );
    const dockerfile = readFileSync(join(repoRoot, service.dockerfile), "utf8");
    assert(
      !dockerfile.includes("apps/captive-portal/package.json"),
      `${service.name} Dockerfile must not copy deleted apps/captive-portal/package.json`,
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

  for (const requiredFile of service.requiredFiles) {
    const requiredPath = `${service.productPath}/${requiredFile}`;
    assert(existsSync(join(repoRoot, requiredPath)), `${requiredPath} must exist`);
  }

  if (service.oldRuntimePath) {
    assert(
      !existsSync(join(repoRoot, service.oldRuntimePath)),
      `${service.oldRuntimePath} must be moved under ${productRoot}`,
    );
  }
}

for (const dockerfilePath of dockerfilesWithWorkspaceManifests) {
  const dockerfile = readFileSync(join(repoRoot, dockerfilePath), "utf8");
  assert(
    !dockerfile.includes("apps/captive-portal/package.json"),
    `${dockerfilePath} must not copy deleted apps/captive-portal/package.json`,
  );
  assert(
    !dockerfile.includes("products/captive-portal/products/control-center"),
    `${dockerfilePath} must not copy self-nested products/captive-portal/products/control-center paths`,
  );
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

console.info("Control Center runtime apps live under the product boundary.");
