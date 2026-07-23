import { defineApp } from "@app-kit";
import { NotificationCenterTile, NotificationCenterTileView } from "./web";

/**
 * The notif app manifest (Track C, S1 , the worker-job-seam proof consumer).
 * defineApp is the single source of truth for the tile: id, board placement
 * (copied verbatim from the pre-fold tile-registry entry), and components.
 * `guestExposed` is omitted (defaults false) , the Notification Center is an
 * internal panel feature, not reachable by unauthenticated LAN guests; it must
 * stay OUT of features/guest-exposed.ts or the codegen validator throws. The
 * codegen collects this manifest and dedupes the id against the registry so
 * the feature is the tile's only source in the generated model.
 */
export default defineApp({
  id: "tile_notif",
  tile: {
    label: "Notifications",
    component: NotificationCenterTile,
    viewComponent: NotificationCenterTileView,
    worldCol: 38,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
});
