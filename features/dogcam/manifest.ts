import { defineApp } from "@app-kit";
import { DogCamTile, DogCamTileView } from "./web";

/**
 * The dogcam app manifest (Track C, Wave 2). defineApp is the single source of
 * truth for the tile: id, board placement (copied verbatim from the pre-fold
 * tile-registry entry), and components. Not guest-exposed. The camera-stream
 * raw HTTP route (/media/camera-stream, apps/api/src/server.ts) stays
 * hand-wired until the S3 http-route seam lands — this fold covers only the
 * tile + tRPC api + service, per the master execution plan's Wave 2 note.
 */
export default defineApp({
  id: "tile_dogcam",
  tiles: [
    {
      id: "tile_dogcam",
      label: "Living Room Cam",
      component: DogCamTile,
      viewComponent: DogCamTileView,
      worldCol: 38,
      worldRow: 27,
      cols: 4,
      rows: 3,
    },
  ],
});
