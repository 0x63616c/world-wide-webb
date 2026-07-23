import { defineApp } from "@app-kit";
import { TeslaTile, TeslaTileView } from "./web";

/**
 * The tesla app manifest (Track C, Wave 2). defineApp is the single source of
 * truth for the tile: id, board placement (copied verbatim from the pre-fold
 * tile-registry entry), and components. Not guest-exposed. HA-backed via
 * @www/core directly (P1.1 hoist) , no apps/api reach.
 */
export default defineApp({
  id: "tile_tesla",
  tile: {
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    worldCol: 22,
    worldRow: 27,
    cols: 4,
    rows: 4,
  },
});
