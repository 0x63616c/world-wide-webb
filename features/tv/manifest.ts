import { defineApp } from "@app-kit";
import { TvAppsTile, TvAppsTileView, TvNowPlayingTile, TvNowPlayingTileView } from "./web";

/**
 * The tv app manifest (Track C, Wave 6). Two tiles: TV (Apple-TV now-playing +
 * remote) and TV Apps. Board placement copied verbatim from the pre-fold
 * tile-registry entries. Neither tile is `home`. Not guest-exposed.
 */
export default defineApp({
  id: "tile_tv",
  tiles: [
    {
      id: "tile_tv",
      label: "TV",
      component: TvNowPlayingTile,
      viewComponent: TvNowPlayingTileView,
      worldCol: 18,
      worldRow: 24,
      cols: 4,
      rows: 3,
    },
    {
      id: "tile_tvapps",
      label: "TV Apps",
      component: TvAppsTile,
      viewComponent: TvAppsTileView,
      worldCol: 30,
      worldRow: 32,
      cols: 4,
      rows: 2,
    },
  ],
});
