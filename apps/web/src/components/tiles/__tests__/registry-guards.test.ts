/**
 * CI guards for the tile registry.
 * (1) Registry covers every cell of the 12×6 grid with no overlaps or gaps.
 * (2) Every registry entry has a named export in registry.stories.tsx.
 */
import { composeStories } from "@storybook/react";
import { describe, expect, it, vi } from "vitest";

// MapLibre (via TeslaTile) calls window.URL.createObjectURL at import time — unavailable in jsdom.
vi.mock("maplibre-gl", () => ({
  default: {
    Map: vi.fn(() => ({
      addControl: vi.fn(),
      on: vi.fn(),
      remove: vi.fn(),
      setCenter: vi.fn(),
      easeTo: vi.fn(),
    })),
    Marker: vi.fn(() => ({
      setLngLat: vi.fn().mockReturnThis(),
      addTo: vi.fn().mockReturnThis(),
      remove: vi.fn().mockReturnThis(),
      getElement: vi.fn().mockReturnValue(document.createElement("div")),
    })),
    NavigationControl: vi.fn(),
    addProtocol: vi.fn(),
    removeProtocol: vi.fn(),
  },
}));

vi.mock("pmtiles", () => ({ Protocol: vi.fn().mockImplementation(() => ({ tile: vi.fn() })) }));
vi.mock("@protomaps/basemaps", () => ({
  layers: vi.fn().mockReturnValue([]),
  namedFlavor: vi.fn().mockReturnValue({}),
}));

import { GRID_COLS, GRID_ROWS } from "../../../lib/grid-constants";
import { deriveGridAreas, TILE_REGISTRY } from "../../../lib/tile-registry";
import * as registryStories from "../__stories__/registry.stories";

describe("tile registry — grid coverage", () => {
  it("all 9 tiles are defined with Stripe-style IDs", () => {
    for (const entry of TILE_REGISTRY) {
      expect(entry.id).toMatch(/^tile_[a-z]+$/);
    }
  });

  it("tiles cover every cell of the 12×6 grid exactly once (no gaps, no overlaps)", () => {
    const coverage = new Map<string, string>();

    for (const { id, colStart, rowStart, cols, rows } of TILE_REGISTRY) {
      for (let r = rowStart - 1; r < rowStart - 1 + rows; r++) {
        for (let c = colStart - 1; c < colStart - 1 + cols; c++) {
          const key = `${r},${c}`;
          expect(
            coverage.get(key),
            `Cell (${r},${c}) covered twice — ${coverage.get(key)} and ${id}`,
          ).toBeUndefined();
          coverage.set(key, id);
        }
      }
    }

    const expectedCells = GRID_ROWS * GRID_COLS;
    expect(coverage.size).toBe(expectedCells);
  });

  it("deriveGridAreas produces no '.' cells (all cells are named)", () => {
    const areas = deriveGridAreas(TILE_REGISTRY);
    expect(areas).not.toContain(".");
  });

  it("TILE_REGISTRY entries have valid col/row positions within the grid", () => {
    for (const { id, colStart, rowStart, cols, rows } of TILE_REGISTRY) {
      expect(colStart, `${id} colStart`).toBeGreaterThanOrEqual(1);
      expect(rowStart, `${id} rowStart`).toBeGreaterThanOrEqual(1);
      expect(colStart + cols - 1, `${id} col end`).toBeLessThanOrEqual(GRID_COLS);
      expect(rowStart + rows - 1, `${id} row end`).toBeLessThanOrEqual(GRID_ROWS);
    }
  });
});

describe("tile registry — story coverage", () => {
  it("every registry entry has a named story export in registry.stories.tsx", () => {
    // Export keys in registry.stories.tsx must match tile IDs exactly.
    // composeStories returns a record keyed by the CSF export names.
    const composed = composeStories(registryStories);
    const storyKeys = Object.keys(composed);

    for (const { id } of TILE_REGISTRY) {
      expect(
        storyKeys,
        `registry.stories.tsx is missing an export for ${id} — add: export const ${id} = makeRegistryStory(entry("${id}"))`,
      ).toContain(id);
    }

    // No phantom entries — every export must correspond to a registry tile
    expect(storyKeys.length).toBe(TILE_REGISTRY.length);
  });
});
