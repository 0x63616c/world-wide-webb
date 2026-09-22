import { defineApp } from "@app-kit";
import { PhotoBoothTile } from "./web";

/**
 * The Photo Booth app manifest (Track C, final tile fold). Single-tile: one
 * `defineApp` holds the Photo Booth tile. NOT home (Controls is), NOT
 * guest-exposed. Unlike wakes (which had a separate view component), the
 * registry entry used `PhotoBoothTile` for both `component` and
 * `viewComponent`, kept here.
 *
 * Board Bento (#757): moved into the new bottom row under Sound System,
 * alongside Activity , the two 2x2 tiles fill Sound's 4-wide footprint
 * exactly. See `features/sound/manifest.ts`.
 */
export default defineApp({
  id: "tile_booth",
  private: true,
  tiles: [
    {
      id: "tile_booth",
      label: "Photo Booth",
      component: PhotoBoothTile,
      viewComponent: PhotoBoothTile,
      worldCol: 24,
      worldRow: 30,
      cols: 2,
      rows: 2,
    },
  ],
});
