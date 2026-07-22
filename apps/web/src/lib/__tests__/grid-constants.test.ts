import { describe, expect, it } from "vitest";
import { BOARD_H, BOARD_W, GRID_COLS, GRID_ROWS } from "../grid-constants";

// Pins the docs-facing board dimensions so they can't silently drift from what
// AGENTS.md / README.md / docs/dashboard-spec.md describe (www-355t.8).
//
// Two distinct numbers, both real:
//  - Physical iPad Pro panel: 1366×1024 (screenshots, Playwright smoke).
//  - Board CONTENT grid:      1366×1000 = BOARD_W×BOARD_H (CELL sizing + Storybook).
// The live board is position:fixed/inset:0 (full window), so the extra 24px of
// the 1024-tall panel is uncropped world, not a clip. If you intentionally change
// the grid size, update the three docs above in the same change and adjust here.
describe("board grid dimensions (docs invariant)", () => {
  it("content grid is 1366×1000", () => {
    expect(BOARD_W).toBe(1366);
    expect(BOARD_H).toBe(1000);
  });

  it("is a 12×9 square-cell grid", () => {
    expect(GRID_COLS).toBe(12);
    expect(GRID_ROWS).toBe(9);
  });
});
