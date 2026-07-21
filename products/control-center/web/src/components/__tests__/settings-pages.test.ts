import { describe, expect, it } from "vitest";
import { PAGES } from "../settings-page/pages";

describe("settings sidebar tints", () => {
  // Notifications and Security shipped the same red (#c95c5c) and read as one
  // group in the sidebar. The chip colour is the only thing distinguishing
  // adjacent rows at a glance, so duplicates are a bug, not a style preference.
  it("gives every page its own chip colour", () => {
    const tints = PAGES.map((p) => p.tint);
    expect(new Set(tints).size).toBe(tints.length);
  });
});
