import { describe, expect, test } from "vitest";
import { ampProductManifest } from "../src/index.ts";

describe("AMP platform representation", () => {
  test("declares AMP identity and private app surface", () => {
    const manifest = ampProductManifest();

    expect(manifest.product.slug).toBe("amp");
    expect(manifest.product.namespace).toBe("amp");
    expect(manifest.app.exposure).toMatchObject({
      kind: "private-web",
      hostname: "app--amp.worldwidewebb.co",
      cloudflareAccess: true,
    });
  });

  test("declares the stateless app workload without API, secrets, or database", () => {
    const manifest = ampProductManifest();

    expect(Object.keys(manifest.services)).toEqual(["app"]);
    expect(manifest.services.app).toMatchObject({
      service: "app",
      workloadName: "amp-app",
      image: "ghcr.io/0x63616c/www-amp-app:main",
    });
    expect(manifest.services.app.exposure).toEqual(manifest.app.exposure);
    expect(manifest.services).not.toHaveProperty("api");
    expect(manifest.secretUsages).toEqual({});
    expect(manifest.database).toBeNull();
    expect(manifest.backup).toBeNull();
  });
});
