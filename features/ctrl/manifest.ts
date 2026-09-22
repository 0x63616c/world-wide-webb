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
 *
 * Board Bento (#757): swapped world-cell position with `tile_clock` , Controls
 * now sits in the middle slot (was the Clock's) and keeps its own 5x5
 * footprint, so the middle slot becomes the bigger one; the Clock takes
 * Controls' old, smaller 5x3 slot on the right. Fixed bento arrangement, see
 * `features/events/manifest.ts` for the other half of the swap.
 */
export default defineApp({
  id: "tile_ctrl",
  tiles: [
    {
      id: "tile_ctrl",
      label: "Controls",
      component: ControlsTile,
      viewComponent: ControlsTileView,
      worldCol: 26,
      worldRow: 27,
      cols: 5,
      rows: 5,
      home: true,
    },
  ],
});
