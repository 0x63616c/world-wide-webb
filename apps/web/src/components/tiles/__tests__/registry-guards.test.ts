/**
 * CI guards for the tile registry.
 * (1) Registry covers every cell of the 12×6 grid with no overlaps or gaps.
 * (2) Every registry entry's view component has a matching *.stories.tsx file.
 * (3) tilePixelSize derives the true production footprint for each tile.
 */
import { describe, expect, it, vi } from "vitest";

// MapLibre (via TeslaTile, imported transitively by tile-registry) calls
// window.URL.createObjectURL at import time — unavailable in jsdom.
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

import { GRID_COLS, GRID_ROWS, tilePixelSize } from "../../../lib/grid-constants";
import { deriveGridAreas, TILE_REGISTRY } from "../../../lib/tile-registry";

describe("tile registry — grid coverage", () => {
  it("all tiles are defined with Stripe-style IDs", () => {
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

    expect(coverage.size).toBe(GRID_ROWS * GRID_COLS);
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
  // Enumerate every tile story file at build time (Vite glob).
  const storyFiles = Object.keys(import.meta.glob("../*.stories.tsx"));

  it("every registry view component has a matching *.stories.tsx file", () => {
    for (const { id, viewComponent } of TILE_REGISTRY) {
      const expectedFile = `${viewComponent.name}.stories.tsx`;
      const found = storyFiles.some((p) => p.endsWith(`/${expectedFile}`));
      expect(
        found,
        `${id}: missing ${expectedFile} — every registry tile needs a stories file`,
      ).toBe(true);
    }
  });
});

describe("tile registry — pixel footprint", () => {
  it("derives the clock tile (5×2) at its known production size ~530×311", () => {
    const { width, height } = tilePixelSize(5, 2);
    expect(width).toBeCloseTo(530.33, 1);
    expect(height).toBeCloseTo(310.67, 1);
  });

  it("gives each registry tile a non-zero footprint that grows with span", () => {
    for (const { id, cols, rows } of TILE_REGISTRY) {
      const { width, height } = tilePixelSize(cols, rows);
      expect(width, `${id} width`).toBeGreaterThan(0);
      expect(height, `${id} height`).toBeGreaterThan(0);
    }
    // A wider/taller span must produce a larger box than a smaller one.
    expect(tilePixelSize(4, 3).width).toBeGreaterThan(tilePixelSize(3, 3).width);
    expect(tilePixelSize(4, 3).height).toBeGreaterThan(tilePixelSize(4, 2).height);
  });
});
