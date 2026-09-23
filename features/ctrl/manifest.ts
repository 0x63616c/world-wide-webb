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
 * home tile remains the primary actionable tile on the fixed board.
 */
export default defineApp({
  id: "tile_ctrl",
  tiles: [
    {
      id: "tile_ctrl",
      label: "Controls",
      component: ControlsTile,
      viewComponent: ControlsTileView,
      worldCol: 29,
      worldRow: 24,
      cols: 5,
      rows: 6,
      home: true,
    },
  ],
});
