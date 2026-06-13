import { describe, expect, test } from "vitest";
import { defineProduct, productSlugs } from "../src/index.ts";

describe("product identity", () => {
  test("defines the four platform products", () => {
    expect(productSlugs).toEqual(["control-center", "captive-portal", "text-your-ex", "amp"]);
  });

  test("derives Control Center identity from the product slug", () => {
    const app = defineProduct("control-center");

    expect(app.slug).toBe("control-center");
    expect(app.folder).toBe("products/control-center");
    expect(app.namespace).toBe("control-center");
    expect(app.dnsCode).toBe("cc");
    expect(app.imageNamespace).toBe("control-center");
    expect(app.pulumiName("api")).toBe("control-center-api");
    expect(app.serviceName("api")).toBe("control-center-api");
    expect(app.imageRepository("api")).toBe("ghcr.io/0x63616c/control-center-api");
    expect(app.backupPathParts("postgres")).toEqual([
      "backups",
      "world-wide-webb",
      "control-center",
      "postgres",
    ]);
    expect(app.labels("api")).toEqual({
      "app.kubernetes.io/component": "api",
      "app.kubernetes.io/name": "control-center",
      "app.kubernetes.io/part-of": "world-wide-webb",
      "worldwidewebb.co/product": "control-center",
    });
  });

  test.each([
    ["captive-portal", "cp"],
    ["text-your-ex", "tye"],
    ["amp", "amp"],
  ] as const)("derives networking-only DNS code for %s", (slug, dnsCode) => {
    const app = defineProduct(slug);

    expect(app.dnsCode).toBe(dnsCode);
    expect(app.namespace).toBe(slug);
    expect(app.folder).toBe(`products/${slug}`);
  });
});
