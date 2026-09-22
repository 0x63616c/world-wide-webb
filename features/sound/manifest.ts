import { defineApp } from "@app-kit";
import { SoundSystemTile, SoundSystemTileView } from "./web";

/**
 * The sound app manifest (Track C, Wave 6). One tile: Sound System (the Sonos
 * mixer). Quick Play was deleted with Spotify (The Simplification §4) — it was
 * a browse surface over the Spotify API and nothing else. Not `home`.
 */
export default defineApp({
  id: "tile_sound",
  tiles: [
    {
      id: "tile_sound",
      label: "Sound System",
      component: SoundSystemTile,
      viewComponent: SoundSystemTileView,
      worldCol: 29,
      worldRow: 27,
      cols: 4,
      rows: 3,
    },
  ],
});
