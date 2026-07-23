import { defineApp } from "@app-kit";
import { ControlsTile, ControlsTileView } from "./web";

/**
 * The ctrl app manifest (Track C, Wave 7). A single-tile fold: `defineApp`
 * holds the Controls tile (lamps/lights/fan). Coords copied verbatim from the
 * pre-fold tile-registry entry. Not `home` (the Clock is). Not guest-exposed.
 */
export default defineApp({
  id: "tile_ctrl",
  tiles: [
    {
      id: "tile_ctrl",
      label: "Controls",
      component: ControlsTile,
      viewComponent: ControlsTileView,
      worldCol: 31,
      worldRow: 27,
      cols: 4,
      rows: 3,
    },
  ],
});
