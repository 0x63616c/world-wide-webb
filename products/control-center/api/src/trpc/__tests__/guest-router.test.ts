import { describe, expect, it } from "vitest";
import { guestRouter } from "../guest-router";
import { portalRouter } from "../routers/portal";

describe("guestRouter", () => {
  it("exposes exactly the portal.* procedures and nothing else (guest surface = portal only)", () => {
    const guestKeys = new Set(Object.keys(guestRouter._def.procedures));
    const expectedKeys = new Set(
      Object.keys(portalRouter._def.procedures).map((key) => `portal.${key}`),
    );

    expect(guestKeys).toEqual(expectedKeys);
  });
});
