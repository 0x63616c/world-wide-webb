/**
 * Tests for the TV-app ordering (www-fnh7).
 *
 * tvAppsInOrder is the single source of display order for both the tile grid
 * and the AllAppsModal: curated favorites first (fixed order), then the rest
 * with branded-logo apps before glyph-only fallbacks.
 */
import { describe, expect, it } from "vitest";
import { tvAppsInOrder } from "../tv-app-logos";

describe("tvAppsInOrder", () => {
  it("puts favorites first in the curated order, regardless of source order", () => {
    const out = tvAppsInOrder(["Hulu", "Netflix", "YouTube", "Disney+"]);
    expect(out).toEqual(["YouTube", "Netflix", "Disney+", "Hulu"]);
  });

  it("orders the non-favorite rest as branded-logo apps before glyph-only apps", () => {
    const out = tvAppsInOrder(["App Store", "Peacock", "Netflix", "AMC+", "YouTube", "Paramount+"]);
    expect(out).toEqual([
      // favorites (curated order)
      "YouTube",
      "Netflix",
      // branded non-favorites (source order preserved)
      "Peacock",
      "Paramount+",
      // glyph-only non-favorites (source order preserved)
      "App Store",
      "AMC+",
    ]);
  });

  it("matches favorites by normalized key, so spelling variants still resolve", () => {
    // "HBO Max" → Max favorite; "Apple TV" → Apple TV+ favorite.
    const out = tvAppsInOrder(["HBO Max", "Apple TV", "YouTube"]);
    expect(out).toEqual(["YouTube", "Apple TV", "HBO Max"]);
  });

  it("only includes apps present in source_list (no phantom favorites)", () => {
    // Disney+/Hulu/etc. are favorites but absent from source → must not appear.
    const out = tvAppsInOrder(["Netflix", "AMC+"]);
    expect(out).toEqual(["Netflix", "AMC+"]);
  });

  it("returns the real source_list strings so they stay launchable", () => {
    const out = tvAppsInOrder(["Prime Video"]);
    expect(out).toEqual(["Prime Video"]);
  });
});
