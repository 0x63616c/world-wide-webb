import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");
const productApp = join(repoRoot, "products", "captive-portal", "apps", "frontend");
const legacyApp = join(repoRoot, "apps", "captive-portal");

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("captive portal product boundary", () => {
  test("frontend package ownership lives under products/captive-portal", () => {
    expect(existsSync(join(productApp, "package.json"))).toBe(true);
    expect(existsSync(join(legacyApp, "package.json"))).toBe(false);

    const pkg = readJson(join(productApp, "package.json"));
    expect(pkg).toMatchObject({ name: "@cc/captive-portal" });
  });

  test("root workspace metadata includes product app workspaces", () => {
    const pkg = readJson(join(repoRoot, "package.json"));
    expect(pkg).toMatchObject({ workspaces: expect.arrayContaining(["products/*/apps/*"]) });
  });

  test("CI captive portal filters follow the product-owned path", () => {
    const ci = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8");
    expect(ci).toContain("products/captive-portal/**");
    expect(ci).not.toContain("- 'apps/captive-portal/**'");
  });
});
