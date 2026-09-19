import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView } from "./web";

/**
 * The events app manifest. One tile: the Clock face (greeting + seconds ring).
 *
 * FACE-ONLY , the Clock declares no Tile View. The timer, stopwatch, alarm,
 * world clocks and countdown horizon it used to open are gone, and with them
 * the whole time suite. Tapping the Clock recenters the board and nothing more.
 *
 * It is therefore no longer the board's home tile either: glide-home has to
 * land somewhere actionable, so `home: true` moved to `tile_ctrl` (Controls).
 */
export default defineApp({
  id: "tile_events",
  tiles: [
    {
      id: "tile_clock",
      label: "Clock",
      component: ClockTile,
      viewComponent: ClockTileView,
      worldCol: 26,
      worldRow: 27,
      cols: 5,
      rows: 3,
    },
  ],
});
