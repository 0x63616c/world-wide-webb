import { defineApp } from "@app-kit";
import { DeployTile, DeployTileView } from "./web";

/**
 * The deploys app manifest (Track C, Wave 2). defineApp is the single source
 * of truth for the tile: id, board placement (copied verbatim from the
 * pre-fold tile-registry entry), and components. Not guest-exposed. The
 * github-poll worker cycle (10s interval) stays hand-wired in apps/worker,
 * importing this feature's service directly — Seam S1 (worker-job seam) only
 * covers queue jobs, not interval cycles (roadmap decision), so there is no
 * jobs.ts here.
 */
export default defineApp({
  id: "tile_deploys",
  tile: {
    label: "Deploys",
    component: DeployTile,
    viewComponent: DeployTileView,
    worldCol: 34,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
});
