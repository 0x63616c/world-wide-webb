// Re-exports BOARD_W/H from grid-constants (the single source of truth).
// SecondsRing and tile dimension constants remain here since they are
// derived measurements from the physical grid, not grid config values.

export { BOARD_H, BOARD_W } from "./grid-constants";

// Border radius shared by all tiles (matches --r token in tokens.css).
export const TILE_RX = 20;

// Clock tile design-specified padding (www-882). Exported here so SecondsRing can
// reference the exact value to escape the padding box with a negative margin.
export const CLOCK_TILE_PADDING = 28;

// Clock tile pixel dimensions: 5 cols × 2 rows on the 12×6 grid.
// These are derived from the rendered board at 1366×1024 with 26px padding and 18px gaps.
// If the grid layout changes, rederive: (BOARD_W - 2*BOARD_PADDING - (GRID_COLS-1)*GAP) / GRID_COLS * cols
export const CLOCK_TILE_W = 537;
export const CLOCK_TILE_H = 312;
