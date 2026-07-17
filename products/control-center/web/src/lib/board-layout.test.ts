// Pure merge + scanline resolver: saved DB placements (Task 3/4) override the
// registry defaults, and any collision on a defaulted tile's position is
// resolved by scanning row-major for the first free slot, wrapping the inner
// world (wall ring excluded). No React, no network , see board-layout.ts.
import { describe, expect, it, vi } from "vitest";

// resolveLayout's default registry param reads TILE_REGISTRY, which
// transitively imports TeslaTile → MapLibre. MapLibre calls
// window.URL.createObjectURL at import time, which jsdom lacks , stub it the
// same way placeholder-tiles.test.ts / registry-guards.test.ts do.
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

import { resolveLayout, type TilePlacement, type TileRegistryEntry } from "./board-layout";
import { TILE_REGISTRY } from "./tile-registry";

describe("resolveLayout", () => {
  it("uses saved placement over registry default", () => {
    const saved: TilePlacement[] = [{ tileId: "tile_weath", worldCol: 10, worldRow: 10 }];
    const result = resolveLayout(saved);
    const weath = result.tiles.find((t) => t.id === "tile_weath");
    expect(weath?.worldCol).toBe(10);
    expect(weath?.worldRow).toBe(10);
    expect(result.unplaced).toEqual([]);
  });

  it("falls back to registry default when no row", () => {
    const result = resolveLayout([]);
    for (const entry of TILE_REGISTRY) {
      const tile = result.tiles.find((t) => t.id === entry.id);
      expect(tile?.worldCol).toBe(entry.worldCol);
      expect(tile?.worldRow).toBe(entry.worldRow);
    }
    expect(result.unplaced).toEqual([]);
  });

  it("ignores unknown tile ids", () => {
    const saved: TilePlacement[] = [{ tileId: "tile_ghost", worldCol: 5, worldRow: 5 }];
    const result = resolveLayout(saved);
    expect(result.tiles.some((t) => t.id === "tile_ghost")).toBe(false);
    expect(result.tiles.length).toBe(TILE_REGISTRY.length);
    expect(result.unplaced).toEqual([]);
  });

  it("scanlines a new tile whose default is occupied", () => {
    const felogsDefault = TILE_REGISTRY.find((t) => t.id === "tile_felogs")!;
    // Park tile_clock exactly on tile_felogs's default position/size, so
    // tile_felogs (defaulted, resolved after all saved rows) must scanline off.
    const saved: TilePlacement[] = [
      { tileId: "tile_clock", worldCol: felogsDefault.worldCol, worldRow: felogsDefault.worldRow },
    ];
    const result = resolveLayout(saved);
    const clock = result.tiles.find((t) => t.id === "tile_clock")!;
    const felogs = result.tiles.find((t) => t.id === "tile_felogs")!;
    expect(clock.worldCol).toBe(felogsDefault.worldCol);
    expect(clock.worldRow).toBe(felogsDefault.worldRow);
    // felogs must have moved off its default and not overlap clock (or anything else).
    expect(felogs.worldCol === felogsDefault.worldCol && felogs.worldRow === felogsDefault.worldRow).toBe(
      false,
    );
    const overlaps = (
      a: { worldCol: number; worldRow: number; cols: number; rows: number },
      b: { worldCol: number; worldRow: number; cols: number; rows: number },
    ): boolean =>
      a.worldCol < b.worldCol + b.cols &&
      a.worldCol + a.cols > b.worldCol &&
      a.worldRow < b.worldRow + b.rows &&
      a.worldRow + a.rows > b.worldRow;
    for (const other of result.tiles) {
      if (other.id === "tile_felogs") continue;
      expect(overlaps(felogs, other)).toBe(false);
    }
    expect(result.unplaced).toEqual([]);
  });

  it("reports unplaced when the world genuinely has no slot", () => {
    // Synthetic registry seam: two 1x1 tiles in a 1x1 inner world (via a tiny
    // registry override), forcing the second (defaulted) tile to find no slot.
    const tinyRegistry: TileRegistryEntry[] = [
      { id: "tile_a", label: "A", worldCol: 2, worldRow: 2, cols: 1, rows: 1 } as TileRegistryEntry,
      { id: "tile_b", label: "B", worldCol: 2, worldRow: 2, cols: 1, rows: 1 } as TileRegistryEntry,
    ];
    // Saved: tile_a placed at the ONLY valid inner cell of a 1x1-inner world
    // (achieved via the tiny fixture below in board-layout.ts's internal test hook).
    const saved: TilePlacement[] = [{ tileId: "tile_a", worldCol: 2, worldRow: 2 }];
    const result = resolveLayout(saved, tinyRegistry, { worldCols: 5, worldRows: 5, wallThickness: 2 });
    expect(result.unplaced).toEqual(["tile_b"]);
    expect(result.tiles.some((t) => t.id === "tile_b")).toBe(false);
  });
});
