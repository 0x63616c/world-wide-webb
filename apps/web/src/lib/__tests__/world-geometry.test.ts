// World geometry for the pannable canvas: a SQUARE-cell grid (12×9) on a square
// world, with the Clock placed dead center. Square cells keep tile widths
// identical to the old board while making the world and lattice balanced.
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

const clock = { colStart: 1, rowStart: 1, cols: 5, rows: 3 };

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

  it("places the Clock dead center of the world", () => {
    const r = tileWorldRect(clock);
    expect(r.x + r.w / 2).toBeCloseTo(WORLD_W / 2, 1);
    expect(r.y + r.h / 2).toBeCloseTo(WORLD_H / 2, 1);
  });
});
