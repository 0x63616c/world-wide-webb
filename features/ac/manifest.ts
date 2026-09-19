import { defineApp } from "@app-kit";
import { ClimateTile, ClimateTileView } from "./web";

/**
 * The climate (A/C) app manifest. A single tile, Climate · A/C, and it is
 * FACE-ONLY , no Tile View. The zone grid, house thermal map and comfort
 * presets are gone; the tile shows the house summary and nothing opens.
 * Not `home` (Controls is). Not guest-exposed. The App owns its
 * climate-enforcer cadence through worker.ts; codegen registers it with the
 * worker runtime. It owns no table because it reads the shared @www/core
 * device_state row.
 */
export default defineApp({
  id: "tile_ac",
  tiles: [
    {
      id: "tile_ac",
      label: "Climate · A/C",
      component: ClimateTile,
      viewComponent: ClimateTileView,
      worldCol: 30,
      worldRow: 24,
      cols: 4,
      rows: 3,
    },
  ],
});
