import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView } from "./web";

/**
 * The events app manifest. One tile: the Clock face (greeting + seconds ring).
 *
 * Tapping the existing Clock opens its Alarms page. Controls remains home.
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
