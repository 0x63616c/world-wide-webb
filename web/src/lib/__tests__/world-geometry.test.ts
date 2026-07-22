// World geometry for the pannable canvas: a SQUARE-cell lattice on one large
// square world. Tiles are free-placed by world-cell coords (worldCol/worldRow);
// there is no central cluster anchor. Square cells keep tile widths identical to
// the old board while making the world balanced.
import { describe, expect, it } from "vitest";
import {
  BOARD_H,
  BOARD_W,
  tilePixelSize,
  tileWorldRect,
  WORLD_COLS,
  WORLD_H,
  WORLD_ROWS,
  WORLD_W,
} from "../grid-constants";

// The Clock at its world-cell home (matches tile-registry).
const clock = { worldCol: 26, worldRow: 27, cols: 5, rows: 3 };

describe("world geometry", () => {
  it("is a square world strictly larger than the viewport", () => {
    expect(WORLD_COLS).toBe(WORLD_ROWS);
    expect(WORLD_W).toBeCloseTo(WORLD_H, 1); // square cells + equal counts => square px
    expect(WORLD_W).toBeGreaterThan(BOARD_W);
    expect(WORLD_H).toBeGreaterThan(BOARD_H);
  });

  it("uses square cells: clock 5×3 renders 543.67 × 319, width unchanged from the old board", () => {
    const r = tileWorldRect(clock);
    const px = tilePixelSize(5, 3);
    expect(r.w).toBeCloseTo(px.width, 1);
    expect(r.h).toBeCloseTo(px.height, 1);
    expect(r.w).toBeCloseTo(543.67, 1); // same width as the old 5×2 clock
    expect(r.h).toBeCloseTo(319.0, 1);
  });

  it("resolves a tile's world rect directly from its world-cell coords (no cluster offset)", () => {
    // worldCellRect(col,row) origin = BOARD_PADDING + col*CELL_PITCH; a tile placed
    // at (0,0) sits at the world origin, and (26,27) is exactly 26/27 pitches in.
    const origin = tileWorldRect({ worldCol: 0, worldRow: 0, cols: 2, rows: 2 });
    const r = tileWorldRect(clock);
    const pitchX = (r.x - origin.x) / 26;
    const pitchY = (r.y - origin.y) / 27;
    expect(pitchX).toBeGreaterThan(0);
    expect(pitchX).toBeCloseTo(pitchY, 1); // square lattice => equal pitch both axes
  });

  it("places the Clock comfortably inside the world (room to pan on every side)", () => {
    const r = tileWorldRect(clock);
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThan(WORLD_W);
    expect(r.y + r.h).toBeLessThan(WORLD_H);
  });
});
