import { defineApp } from "@app-kit";
import { ClockTile, ClockTileView, EventsTile, EventsTileView } from "./web";

/**
 * The events app manifest (Track C fold). Second multi-tile fold — one
 * `defineApp` holds both the Upcoming (events) tile and the Clock tile,
 * mirroring the weather fold's `tiles: TileSpec[]` shape. Board placement
 * (both tiles) copied verbatim from the pre-fold tile-registry entries.
 *
 * First fold to relocate the board HOME tile: `tile_clock` carries
 * `home: true`, the sole global home across all apps
 * (see scripts/apps-gen/validate.ts's single-home invariant). Neither tile
 * is guest-exposed.
 *
 * App id `tile_events` is distinct from both tile ids (`tile_event`,
 * `tile_clock`), matching the `events` router-key.
 */
export default defineApp({
  id: "tile_events",
  tiles: [
    {
      id: "tile_event",
      label: "Upcoming",
      component: EventsTile,
      viewComponent: EventsTileView,
      worldCol: 30,
      worldRow: 30,
      cols: 4,
      rows: 2,
    },
    {
      id: "tile_clock",
      label: "Clock",
      component: ClockTile,
      viewComponent: ClockTileView,
      worldCol: 26,
      worldRow: 27,
      cols: 5,
      rows: 3,
      home: true,
    },
  ],
});
