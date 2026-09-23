import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView } from "./web";

/**
 * The events app manifest. One tile: the Clock face (greeting + seconds ring).
 *
 * FACE-ONLY , the Clock declares no Tile View. The timer, stopwatch, alarm,
 * world clocks and countdown horizon it used to open are gone, and with them
 * the whole time suite. It is face-only; Controls remains the home tile.
 */
export default defineApp({
  id: "tile_events",
  tiles: [
    {
      id: "tile_clock",
      label: "Clock",
      component: ClockTile,
      viewComponent: ClockTileView,
      worldCol: 22,
      worldRow: 24,
      cols: 5,
      rows: 3,
    },
  ],
});
