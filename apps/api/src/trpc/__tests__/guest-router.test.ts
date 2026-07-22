import { describe, expect, it } from "vitest";
import { guestRouter } from "../guest-router";

// Literal pin, deliberately NOT derived from portalRouter: deriving the
// expected set from the router under test lets the guest surface grow
// silently (any new portal.* procedure would auto-pass). Adding a procedure
// here must be a conscious edit to this list.
const EXPECTED_GUEST_KEYS = ["portal.checkPassword", "portal.authorize", "portal.status"];

describe("guestRouter", () => {
  it("exposes exactly the portal.* procedures and nothing else (guest surface = portal only)", () => {
    const guestKeys = new Set(Object.keys(guestRouter._def.procedures));

    expect(guestKeys).toEqual(new Set(EXPECTED_GUEST_KEYS));
  });
});
