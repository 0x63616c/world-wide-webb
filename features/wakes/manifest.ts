import { defineApp } from "@app-kit";
import { WakesTile, WakesTileView } from "./web";

/**
 * The Activity app manifest (Track C, Wave 5 fold). Single-tile: one
 * `defineApp` holds the Activity tile. Not home (Controls is) and not
 * guest-exposed (the Activity page is PIN-gated / sensitive).
 *
 * Board Bento (#757): moved into the new bottom row under Sound System,
 * alongside Photo Booth , the two 2x2 tiles fill Sound's 4-wide footprint
 * exactly. See `features/sound/manifest.ts`.
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
      worldCol: 22,
      worldRow: 30,
      cols: 2,
      rows: 2,
    },
  ],
});
