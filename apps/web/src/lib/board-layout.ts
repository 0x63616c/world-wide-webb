// Re-exports BOARD_W/H from grid-constants (the single source of truth).
// SecondsRing reads the clock tile's dimensions here; they are now derived from
// the grid math rather than hand-measured, so a grid change updates them too.

import { tilePixelSize } from "./grid-constants";

export { BOARD_H, BOARD_W } from "./grid-constants";

// Border radius shared by all tiles (matches --r token in tokens.css).
export const TILE_RX = 20;

// Clock tile design-specified padding (www-882). Exported here so SecondsRing can
// reference the exact value to escape the padding box with a negative margin.
export const CLOCK_TILE_PADDING = 28;

// Clock tile pixel footprint: 5 cols × 2 rows on the 12×6 grid → 537×312.
const clockSize = tilePixelSize(5, 2);
export const CLOCK_TILE_W = clockSize.width;
export const CLOCK_TILE_H = clockSize.height;
