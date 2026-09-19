import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView } from "./web";

/**
 * The events app manifest (Track C fold). One tile: the Clock. The Upcoming
 * (`tile_event`) tile and the whole `events` table went with The Simplification
 * §5, so this app is the clock face and nothing else.
 *
 * `home: true` moved off `tile_clock` to `tile_ctrl` at the same time — the
 * Clock no longer has a detail view to land on.
 *
 * App id `tile_events` is deliberately distinct from the tile id `tile_clock`,
 * matching the `events` router-key that used to exist.
 */
export default defineApp({
  id: "tile_events",
  tiles: [
    {
      id: "tile_clock",
      label: "Clock",
      component: ClockTile,
      viewComponent: ClockTileView,
      worldCol: 26,
      worldRow: 27,
      cols: 5,
      rows: 3,
    },
  ],
});
