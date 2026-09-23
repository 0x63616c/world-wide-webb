import { defineApp } from "@app-kit";
import { HourlyTile, HourlyTileView, WeatherTile, WeatherTileView } from "./web";

/**
 * The weather app manifest. Two tiles, Weather Now and Next 12 Hours, and both
 * are FACE-ONLY , neither declares a Tile View. The sun arc, 7-day outlook,
 * comfort breakdown and the hourly detail screens are gone; what the panel
 * shows is what the face shows. Neither tile is `home` (Controls is).
 *
 * App id `tile_weather` is distinct from both tile ids (`tile_weath`,
 * `tile_hourly`).
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
      worldRow: 30,
      cols: 4,
      rows: 3,
    },
    {
      id: "tile_hourly",
      label: "Next 12 Hours",
      component: HourlyTile,
      viewComponent: HourlyTileView,
      worldCol: 30,
      worldRow: 30,
      cols: 4,
      rows: 3,
    },
  ],
});
