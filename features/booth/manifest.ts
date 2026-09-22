import { defineApp } from "@app-kit";
import { PhotoBoothTile } from "./web";

/**
 * The Photo Booth app manifest (Track C, final tile fold). Single-tile: one
 * `defineApp` holds the Photo Booth tile. NOT home (Controls is), NOT
 * guest-exposed. Unlike wakes (which had a separate view component), the
 * registry entry used `PhotoBoothTile` for both `component` and
 * `viewComponent`, kept here.
 *
 * On the fixed board, Photo Booth sits between Controls and Sound System.
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
      worldCol: 27,
      worldRow: 27,
      cols: 2,
      rows: 2,
    },
  ],
});
