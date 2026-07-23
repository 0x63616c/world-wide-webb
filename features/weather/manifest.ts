import { defineApp } from "@app-kit";
import { HourlyTile, HourlyTileView, WeatherTile, WeatherTileView } from "./web";

/**
 * The weather app manifest (Track C, Wave 7). The FIRST multi-tile fold: one
 * `defineApp` holds both the Weather Now tile and the Next 12 Hours tile,
 * proving F0's `tiles: TileSpec[]` shape end-to-end. Board placement (both
 * tiles) copied verbatim from the pre-fold tile-registry entries. Neither
 * tile is `home` (the Clock is). Not guest-exposed.
 *
 * App id `tile_weather` is distinct from both tile ids (`tile_weath`,
 * `tile_hourly`) — the first App where app id != tile id, which is exactly
 * the case the collect.ts registry-leftover dedup fix exists for (see
 * scripts/apps-gen/collect.ts).
 */
export default defineApp({
  id: "tile_weather",
  tiles: [
    {
      id: "tile_weath",
      label: "Weather Now",
      component: WeatherTile,
      viewComponent: WeatherTileView,
      worldCol: 26,
      worldRow: 24,
      cols: 4,
      rows: 3,
    },
    {
      id: "tile_hourly",
      label: "Next 12 Hours",
      component: HourlyTile,
      viewComponent: HourlyTileView,
      worldCol: 22,
      worldRow: 24,
      cols: 4,
      rows: 3,
    },
  ],
});
