import { existsSync } from "node:fs";
import { join } from "node:path";
import { type ProductSlug, productSlugs } from "@www/platform";

type RootPackageJson = Readonly<{
  workspaces?: readonly string[];
}>;

type ProductPackageJson = Readonly<{
  name?: string;
  private?: boolean;
  version?: string;
}>;

type ProductManifest = Readonly<{
  schemaVersion?: number;
  slug?: string;
  productFolder?: string;
  runtimeStatus?: string;
}>;

const root = process.cwd();
const requiredWorkspaceGlobs = [
  "packages/*",
  "infra",
  "infra/unifi",
  "infra/cloudflare",
  "products/*",
  "products/*/apps/*",
  "products/*/packages/*",
] as const;

async function readJson<T>(relativePath: string): Promise<T> {
  const file = Bun.file(join(root, relativePath));
  if (!(await file.exists())) {
    throw new Error(`Missing ${relativePath}`);
  }
  return (await file.json()) as T;
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function productPackageName(slug: ProductSlug): `@product/${ProductSlug}` {
  return `@product/${slug}`;
}

const rootPackage = await readJson<RootPackageJson>("package.json");
const workspaceGlobs = new Set(rootPackage.workspaces ?? []);

for (const glob of requiredWorkspaceGlobs) {
  assert(workspaceGlobs.has(glob), `Root package.json missing workspace glob ${glob}`);
}

// captive-portal's on-disk product folder was deleted (SDD track 0, Task 5:
// repo + CI teardown) and its CNPG cluster + namespace torn down (Task 6);
// its @www/platform identity entry (productSlugs, captivePortalProductManifest)
// deliberately stays alive a while longer regardless , nothing in infra/
// calls it anymore, but pruning the @www/platform surface itself is a later,
// separate platform-cleanup task (7+8). Until then this workspace-shape guard
// only checks products with a real folder on disk.
const PRODUCTS_WITHOUT_FOLDER = new Set<ProductSlug>(["captive-portal"]);

for (const slug of productSlugs) {
  if (PRODUCTS_WITHOUT_FOLDER.has(slug)) continue;
  const folder = `products/${slug}`;
  assert(existsSync(join(root, folder)), `Missing product folder ${folder}`);

  const packageJson = await readJson<ProductPackageJson>(`${folder}/package.json`);
  assert(packageJson.name === productPackageName(slug), `${folder}/package.json has wrong name`);
  assert(packageJson.private === true, `${folder}/package.json must be private`);
  assert(packageJson.version === "0.0.0", `${folder}/package.json must be versioned 0.0.0`);

  const manifest = await readJson<ProductManifest>(`${folder}/product.json`);
  assert(manifest.schemaVersion === 1, `${folder}/product.json schemaVersion must be 1`);
  assert(manifest.slug === slug, `${folder}/product.json slug must match folder`);
  assert(
    manifest.productFolder === folder,
    `${folder}/product.json productFolder must match folder`,
  );
  assert(
    manifest.runtimeStatus === "top-level-until-m4-move" ||
      manifest.runtimeStatus === "compatibility-wrapper" ||
      manifest.runtimeStatus === "frontend-moved" ||
      manifest.runtimeStatus === "api-boundary" ||
      manifest.runtimeStatus === "runtime-moved" ||
      manifest.runtimeStatus === "shell",
    `${folder}/product.json runtimeStatus must describe the temporary M4 state`,
  );
}

console.log(`Product workspace shape OK: ${productSlugs.length} products`);
