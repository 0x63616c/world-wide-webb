// Clock tile layout constants. Values are derived from the grid math so a
// single grid change propagates everywhere — no hand-measured pixel literals.

import { tilePixelSize } from "@/lib/grid-constants";

// Clock tile design-specified padding (www-882). SecondsRing references this
// exact value to escape the padding box with a negative margin.
export const CLOCK_TILE_PADDING = 28;

// Clock tile pixel footprint: 5 cols × 2 rows on the 12×6 grid → 537×312.
const clockSize = tilePixelSize(5, 2);
export const CLOCK_TILE_W = clockSize.width;
export const CLOCK_TILE_H = clockSize.height;
