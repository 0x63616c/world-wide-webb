import { defineApp } from "@app-kit";
import { WeightTile, WeightTileView } from "./web";

/**
 * The weight app manifest (Track C, Wave 2). One inline `defineApp` is the
 * single source of truth for this tile: id, board placement (copied verbatim
 * from the pre-fold tile-registry entry), and components. Not guest-exposed.
 * Col 34 (not 33) is load-bearing for the bento fill in the rows-22/23 band
 * above the home cluster — see placeholder-tiles.test.ts.
 *
 * The weight-ingest interval cycle (apps/api/src/services/weight-service.ts,
 * 15s HA poll) is NOT part of this app — it stays hand-wired in apps/worker,
 * importing this feature's schema/service directly. The S1 job-handler seam
 * only covers queue jobs (notify, youtube_ingest), not interval cycles.
 */
export default defineApp({
  id: "tile_weight",
  tiles: [
    {
      id: "tile_weight",
      label: "Weight",
      component: WeightTile,
      viewComponent: WeightTileView,
      worldCol: 34,
      worldRow: 22,
      cols: 3,
      rows: 2,
    },
  ],
});
