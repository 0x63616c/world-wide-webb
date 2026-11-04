import { describe, expect, test } from "vitest";
import { defineProduct, productSlugs } from "../src/index.ts";

describe("product identity", () => {
  test("defines the platform products", () => {
    expect(productSlugs).toEqual(["control-center"]);
  });

  test("derives Control Center identity from the product slug", () => {
    const app = defineProduct("control-center");

    expect(app.slug).toBe("control-center");
    expect(app.namespace).toBe("control-center");
  });
});
