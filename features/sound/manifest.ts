import { defineApp } from "@app-kit";
import { QuickPlayTile, QuickPlayTileView, SoundSystemTile, SoundSystemTileView } from "./web";

/**
 * The sound app manifest (Track C, Wave 6). Two tiles: Sound System (Sonos
 * mixer) and Quick Play (favorites + Spotify browse). Board placement copied
 * verbatim from the pre-fold tile-registry entries. Neither tile is `home`.
 * Not guest-exposed.
 */
export default defineApp({
  id: "tile_sound",
  tiles: [
    {
      id: "tile_sound",
      label: "Sound System",
      component: SoundSystemTile,
      viewComponent: SoundSystemTileView,
      worldCol: 22,
      worldRow: 31,
      cols: 4,
      rows: 3,
    },
    {
      id: "tile_quickplay",
      label: "Quick Play",
      component: QuickPlayTile,
      viewComponent: QuickPlayTileView,
      worldCol: 26,
      worldRow: 32,
      cols: 4,
      rows: 2,
    },
  ],
});
