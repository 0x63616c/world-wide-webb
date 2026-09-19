import { defineApp } from "@app-kit";
import { SoundSystemTile, SoundSystemTileView } from "./web";

/**
 * The sound app manifest (Track C, Wave 6). One tile: Sound System (the Sonos
 * mixer). Quick Play was deleted with Spotify (The Simplification §4) — it was
 * a browse surface over the Spotify API and nothing else. Board placement
 * copied verbatim from the pre-fold tile-registry entry. Not `home`.
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
  ],
});
