import { defineApp } from "@app-kit";
import { NetworkTile, NetworkTileView } from "./web";

/**
 * The network app manifest (Track C, W0 — the second fold after guest-wifi).
 * defineApp is the single source of truth for the tile: id, board placement
 * (copied verbatim from the pre-fold tile-registry entry), and components. Not
 * guest-exposed. The codegen collects this and dedupes the id against the
 * registry so the feature is the tile's only source in the generated model.
 */
export default defineApp({
  id: "tile_wifi",
  tiles: [
    {
      id: "tile_wifi",
      label: "Network",
      component: NetworkTile,
      viewComponent: NetworkTileView,
      worldCol: 35,
      worldRow: 27,
      cols: 3,
      rows: 3,
    },
  ],
});
