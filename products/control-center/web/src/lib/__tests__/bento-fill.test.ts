// The bento-fill generator: a seeded skyline wall-builder that tiles a W×H cell
// region AROUND N arbitrary reserved holes (the freely-placed real tiles), with
// best-of-N selection for clean seams. Ported + generalized from the validated
// experiments/fixed-board.mjs prototype (single hole → N holes). These guard the
// core invariants the whole decorative fill relies on: gap-free, sliver-free,
// in-bounds, never over a hole, deterministic, and varied.
import { describe, expect, it } from "vitest";
import { fillAround, type Rect } from "../bento-fill";

// Brute-force validator: returns the list of invariant violations for a fill.
function violations(W: number, H: number, holes: Rect[], tiles: Rect[]): string[] {
  const errs: string[] = [];
  const occupied = Array.from({ length: H }, () => Array<string>(W).fill(""));

  const mark = (r: Rect, who: string) => {
    for (let y = r.row; y < r.row + r.rows; y++) {
      for (let x = r.col; x < r.col + r.cols; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) {
          errs.push(`${who} out of bounds at ${x},${y}`);
          continue;
        }
        if (occupied[y][x]) errs.push(`overlap at ${x},${y}: ${occupied[y][x]} & ${who}`);
        occupied[y][x] = who;
      }
    }
  };

  holes.forEach((h, i) => {
    mark(h, `hole_${i}`);
  });
  tiles.forEach((t, i) => {
    if (t.cols < 2 || t.rows < 2) errs.push(`tile_${i} is a sliver ${t.cols}x${t.rows}`);
    mark(t, `tile_${i}`);
  });

  // every non-hole cell must be covered by exactly one tile (mark catches double;
  // here we catch gaps , any blank cell).
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!occupied[y][x]) errs.push(`gap at ${x},${y}`);
    }
  }
  return errs;
}

describe("bento-fill generator", () => {
  it("fills an empty region gap-free, sliver-free, in-bounds", () => {
    const tiles = fillAround(20, 20, [], { seed: 1 });
    expect(violations(20, 20, [], tiles)).toEqual([]);
  });

  it("fills around a single central hole (the legacy cluster case)", () => {
    const holes: Rect[] = [{ col: 13, row: 14, cols: 12, rows: 9 }];
    const tiles = fillAround(31, 31, holes, { seed: 1234 });
    expect(violations(31, 31, holes, tiles)).toEqual([]);
  });

  it("fills around N arbitrary holes scattered across the region", () => {
    const holes: Rect[] = [
      { col: 2, row: 2, cols: 5, rows: 3 },
      { col: 20, row: 4, cols: 4, rows: 4 },
      { col: 10, row: 18, cols: 6, rows: 3 },
      { col: 25, row: 24, cols: 3, rows: 4 },
    ];
    const tiles = fillAround(32, 32, holes, { seed: 7 });
    expect(violations(32, 32, holes, tiles)).toEqual([]);
  });

  it("is deterministic: same seed → identical output", () => {
    const holes: Rect[] = [{ col: 5, row: 5, cols: 4, rows: 4 }];
    const a = fillAround(24, 24, holes, { seed: 99 });
    const b = fillAround(24, 24, holes, { seed: 99 });
    expect(a).toEqual(b);
  });

  it("produces a variety of tile sizes (not a uniform grid)", () => {
    const tiles = fillAround(30, 30, [], { seed: 3 });
    const sizes = new Set(tiles.map((t) => `${t.cols}x${t.rows}`));
    expect(sizes.size).toBeGreaterThanOrEqual(5);
  });
});
