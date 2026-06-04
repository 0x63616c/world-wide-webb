// Single source of truth for the fixed 1354×1012 board grid.
// Imported by Board, tile-registry, board-layout, and the Storybook decorator.

export const BOARD_W = 1354;
export const BOARD_H = 1012;
export const GRID_COLS = 12;
export const GRID_ROWS = 6;
export const GRID_GAP = 18;
export const BOARD_PADDING = 26;

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
