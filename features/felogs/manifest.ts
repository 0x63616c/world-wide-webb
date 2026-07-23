import { defineApp } from "@app-kit";
import { FrontendLogsTile, FrontendLogsTileView } from "./web";

/**
 * The felogs app manifest (Track C, Wave 7). Single-tile fold: id, board
 * placement (copied verbatim from the pre-fold tile-registry entry), and
 * components. Not home, not guest-exposed.
 *
 * The `interaction-session-service` (apps/api) reads this feature's exported
 * `frontendLog` table via `@features/felogs/schema` — it stays in apps/api
 * until the wakes fold lands (it also reads `wakePhoto`).
 */
export default defineApp({
  id: "tile_felogs",
  tiles: [
    {
      id: "tile_felogs",
      label: "Frontend Logs",
      component: FrontendLogsTile,
      viewComponent: FrontendLogsTileView,
      worldCol: 26,
      worldRow: 30,
      cols: 4,
      rows: 2,
    },
  ],
});
