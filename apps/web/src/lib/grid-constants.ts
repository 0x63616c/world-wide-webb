// Single source of truth for the fixed 1366×1000 board grid.
// Imported by Board, tile-registry, board-layout, and the Storybook decorator.
//
// 1366×1000 is the iPad's REAL usable viewport as a fullscreen web app (it
// reports innerHeight 1000, not the nominal 1024 — ~24px is unaccounted for even
// in standalone mode). See cc-* "re-explore actual iPad screen size" — this is a
// best-fit placeholder until that's resolved.
export const BOARD_W = 1366;
export const BOARD_H = 1000;
export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const GRID_GAP = 18;
// Edge margin equals GRID_GAP so the gap from the board edge to the first/last
// card is identical to the gutter between any two cards — one uniform spacing
// scale across the whole board.
export const BOARD_PADDING = GRID_GAP;

// One grid cell's pixel size, derived from the board box minus padding and gaps.
// A tile spanning N cols/rows occupies N cells plus the (N-1) gaps between them.
const CELL_W = (BOARD_W - 2 * BOARD_PADDING - (GRID_COLS - 1) * GRID_GAP) / GRID_COLS;
const CELL_H = (BOARD_H - 2 * BOARD_PADDING - (GRID_ROWS - 1) * GRID_GAP) / GRID_ROWS;

// Exact pixel footprint of a tile spanning `cols`×`rows` cells on the board.
// This is the true size the CSS grid gives the tile in production, so Storybook
// can render the tile alone at production size without drawing the whole board.
export function tilePixelSize(cols: number, rows: number): { width: number; height: number } {
  return {
    width: cols * CELL_W + (cols - 1) * GRID_GAP,
    height: rows * CELL_H + (rows - 1) * GRID_GAP,
  };
}
