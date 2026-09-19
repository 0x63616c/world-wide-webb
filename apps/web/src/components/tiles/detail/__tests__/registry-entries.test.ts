/**
 * Registry-shape tests for the Tile View facets. The behavior these assert used
 * to live in hand-wired tile plumbing (WakesTile's own PinGateModal); it is
 * declarative registry data now, so the tests pin the declarations.
 *
 * A Tile has ZERO OR ONE Tile Views since The Simplification: the four
 * face-only tiles (Clock, Weather Now, Next 12 Hours, Climate · A/C) resolve to
 * none, and tapping one recenters the board and stops.
 */

import { accessFor, getTileDetailEntry, TILE_REGISTRY } from "@features/_generated/web.gen";
import { describe, expect, it } from "vitest";

const FACE_ONLY = ["tile_clock", "tile_weath", "tile_hourly", "tile_ac"] as const;
const WITH_DETAIL = ["tile_ctrl", "tile_booth", "tile_wakes", "tile_sound"] as const;

describe("tile detail registry", () => {
  it("Activity is a PIN-gated (sensitive) page titled 'Activity'", () => {
    const entry = getTileDetailEntry("tile_wakes");
    expect(entry?.kind).toBe("page");
    if (!entry) throw new Error("expected a page entry");
    expect(entry.title).toBe("Activity");
    expect(accessFor("tile_wakes").requiresSessionUnlock).toBe(true);
    expect(entry.defaultSlug).toBe("activity");
  });

  it("Photo Booth requires a fresh PIN on every opening (private)", () => {
    expect(accessFor("tile_booth")).toEqual({
      requiresSessionUnlock: false,
      requiresFreshUnlock: true,
    });
  });

  it("Controls opens without a PIN unlock", () => {
    expect(accessFor("tile_ctrl")).toEqual({
      requiresSessionUnlock: false,
      requiresFreshUnlock: false,
    });
  });

  it("face-only tiles resolve to no Tile View", () => {
    for (const tileId of FACE_ONLY) {
      expect(getTileDetailEntry(tileId), `${tileId} must be face-only`).toBeUndefined();
      // Access is still answerable for every tile , it comes from the App
      // manifest, not the (absent) detail facet.
      expect(accessFor(tileId)).toBeDefined();
    }
  });

  it("every other board tile resolves to exactly one Tile View", () => {
    for (const tileId of WITH_DETAIL) {
      expect(getTileDetailEntry(tileId), `no detail entry for ${tileId}`).toBeDefined();
    }
  });

  it("covers every registered tile between the two lists", () => {
    expect(TILE_REGISTRY.map((t) => t.id).sort()).toEqual(
      [...FACE_ONLY, ...WITH_DETAIL].sort(),
    );
  });
});
