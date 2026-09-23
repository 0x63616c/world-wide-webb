import { defineApp } from "@app-kit";
import { WakesTile, WakesTileView } from "./web";

/**
 * The Activity app manifest (Track C, Wave 5 fold). Single-tile: one
 * `defineApp` holds the Activity tile. Not home (Controls is) and not
 * guest-exposed (the Activity page is PIN-gated / sensitive).
 *
 * On the fixed board, Activity sits below Photo Booth.
 */
export default defineApp({
  id: "tile_wakes",
  sensitive: true,
  tiles: [
    {
      id: "tile_wakes",
      label: "Activity",
      component: WakesTile,
      viewComponent: WakesTileView,
      worldCol: 27,
      worldRow: 26,
      cols: 2,
      rows: 2,
    },
  ],
});
