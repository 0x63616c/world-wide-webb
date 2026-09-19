import { defineApp } from "@app-kit";
import { ControlsTile, ControlsTileView } from "./web";

/**
 * The ctrl app manifest (Track C, Wave 7). A single-tile fold: `defineApp`
 * holds the Controls tile (lamps/lights/fan). Coords copied verbatim from the
 * pre-fold tile-registry entry.
 *
 * Carries `home: true`, the sole global home across all apps (see
 * scripts/apps-gen/validate.ts's single-home invariant). It moved here from
 * `tile_clock` when the Clock became face-only (The Simplification §5): the
 * home tile is where glide-home lands, so it has to be a tile you can actually
 * open and act on.
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
      home: true,
    },
  ],
});
