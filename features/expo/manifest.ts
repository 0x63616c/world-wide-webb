import { defineApp } from "@app-kit";
import { ExpoTile } from "./web";

export default defineApp({
  id: "tile_expo",
  tiles: [
    {
      id: "tile_expo",
      label: "expo",
      component: ExpoTile,
      worldCol: 26,
      worldRow: 22,
      cols: 2,
      rows: 2,
    },
  ],
});
