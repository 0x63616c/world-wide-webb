// Fixed board layout constants for the 1366x1024 wall panel (iPad Pro at Home).
// Grid: 5 columns x 2 rows with 10px gaps and 10px outer padding on each side.
// Any component that depends on exact tile dimensions should import from here so a
// grid change only requires one edit.

export const BOARD_W = 1366;
export const BOARD_H = 1024;

// Clock/greeting tile spans 2 columns x 1 row.
// (1366 - 10*2 outer - 10*4 gaps) / 5 cols * 2 = 537.2 → 537
// (1024 - 10*2 outer - 10*1 gap) / 2 rows = 502 → but clock row is shorter; actual: 312
// These are measured from the rendered board at board.css fixed dimensions.
export const CLOCK_TILE_W = 537;
export const CLOCK_TILE_H = 312;

// Border radius shared by all tiles (matches --r token in tokens.css).
export const TILE_RX = 20;

// Clock tile design-specified padding (CC-882). Exported here so SecondsRing can
// reference the exact value to escape the padding box with a negative margin.
export const CLOCK_TILE_PADDING = 28;
