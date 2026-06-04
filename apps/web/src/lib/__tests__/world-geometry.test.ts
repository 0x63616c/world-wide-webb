// World geometry for the pannable canvas: the 12×6 board is subdivided x2 into a
// 48×48 world at half the cell pitch, so every existing tile keeps its exact
// pixel size while the world grows far past the viewport. The existing cluster is
// parked in the bottom-right quadrant.
import { describe, expect, it } from "vitest";
import {
  BOARD_H,
  BOARD_PADDING,
  BOARD_W,
  tilePixelSize,
  tileWorldRect,
  WORLD_COLS,
  WORLD_H,
  WORLD_ROWS,
  WORLD_W,
} from "../grid-constants";

describe("world geometry", () => {
  it("is a 48×48 world strictly larger than the viewport", () => {
    expect(WORLD_COLS).toBe(48);
    expect(WORLD_ROWS).toBe(48);
    expect(WORLD_W).toBeGreaterThan(BOARD_W);
    expect(WORLD_H).toBeGreaterThan(BOARD_H);
  });

  it("preserves each tile's exact pixel size (clock 5×2 stays 543.67×309.33)", () => {
    const r = tileWorldRect({ colStart: 1, rowStart: 1, cols: 5, rows: 2 });
    const px = tilePixelSize(5, 2);
    expect(r.w).toBeCloseTo(px.width, 1);
    expect(r.h).toBeCloseTo(px.height, 1);
    expect(r.w).toBeCloseTo(543.67, 1);
    expect(r.h).toBeCloseTo(309.33, 1);
  });

  it("opens the cluster in the bottom-right quadrant (clock center past the world midpoint)", () => {
    const r = tileWorldRect({ colStart: 1, rowStart: 1, cols: 5, rows: 2 });
    expect(r.x + r.w / 2).toBeGreaterThan(WORLD_W / 2);
    expect(r.y + r.h / 2).toBeGreaterThan(WORLD_H / 2);
  });

  it("aligns the cluster's bottom-right tile to the world's far padding edge", () => {
    // climate/ac is the cluster's bottom-right tile (cols 9-12, rows 5-6).
    const r = tileWorldRect({ colStart: 9, rowStart: 5, cols: 4, rows: 2 });
    expect(r.x + r.w).toBeCloseTo(WORLD_W - BOARD_PADDING, 1);
    expect(r.y + r.h).toBeCloseTo(WORLD_H - BOARD_PADDING, 1);
  });
});
