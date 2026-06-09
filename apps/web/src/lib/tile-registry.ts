import type { ComponentType } from "react";
import { QuickPlayTile } from "../components/media/QuickPlayTile";
import { QuickPlayTileView } from "../components/media/QuickPlayTileView";
import { SoundSystemTile } from "../components/media/SoundSystemTile";
import { SoundSystemTileView } from "../components/media/SoundSystemTileView";
import { TvAppsTile } from "../components/media/TvAppsTile";
import { TvAppsTileView } from "../components/media/TvAppsTileView";
import { TvNowPlayingTile } from "../components/media/TvNowPlayingTile";
import { TvNowPlayingTileView } from "../components/media/TvNowPlayingTileView";
import { ClimateTile } from "../components/tiles/ClimateTile";
import { ClimateTileView } from "../components/tiles/ClimateTileView";
import { ClockGreeting } from "../components/tiles/ClockGreeting";
import { ClockGreetingView } from "../components/tiles/ClockGreetingView";
import { ControlsTile } from "../components/tiles/ControlsTile";
import { ControlsTileView } from "../components/tiles/ControlsTileView";
import { DogCamTile } from "../components/tiles/DogCamTile";
import { DogCamTileView } from "../components/tiles/DogCamTileView";
import { EventsTile } from "../components/tiles/EventsTile";
import { EventsTileView } from "../components/tiles/EventsTileView";
import { NetworkTile } from "../components/tiles/NetworkTile";
import { NetworkTileView } from "../components/tiles/NetworkTileView";
import { Next12Hours } from "../components/tiles/Next12Hours";
import { Next12HoursView } from "../components/tiles/Next12HoursView";
import { TeslaTile } from "../components/tiles/TeslaTile";
import { TeslaTileView } from "../components/tiles/TeslaTileView";
import { WeatherNow } from "../components/tiles/WeatherNow";
import { WeatherNowView } from "../components/tiles/WeatherNowView";

export type TileRegistryEntry = {
  id: string;
  // The tile's name, used by the minimap hover label, the centered-tile pan
  // label, and the "Open …" aria-label. MUST match the title the tile renders in
  // its TileHeader on the board (e.g. "Weather Now", "Climate · A/C", "Upcoming"),
  // so the minimap label always maps to what the user sees on the tile.
  label: string;
  // biome-ignore lint/suspicious/noExplicitAny: tile containers have no shared prop contract
  component: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: view components have varying prop signatures
  viewComponent: ComponentType<any>;
  // Free position in the ONE world, in 0-indexed world-cell coords. A tile may sit
  // ANYWHERE at any size — there is no cluster, no grid to fill, no gap/overlap
  // rule against other real tiles. The decorative bento (placeholder-tiles.ts)
  // carves itself around whatever rectangles sit here. Move/resize a tile by
  // editing these four numbers; nothing else needs to change.
  worldCol: number;
  worldRow: number;
  cols: number;
  rows: number;
  // The tile the board opens centered on and resettles to when idle. Exactly one
  // entry sets this (the Clock); the board falls back to the first entry.
  home?: boolean;
  // When true the tile owns its own tap surface (it opens its own detail modal),
  // so the board does NOT open the generic showcase modal for it. Controls opens
  // its expanded modal; other tiles flip this on as their detail modals land.
  ownsTap?: boolean;
};

// One entry per real tile, free-placed in the world by world-cell coords. The
// nine tiles below keep their original arrangement, centered in the 64×64 world,
// but they are independent now — nothing requires them to pack or stay adjacent.
// A new tile can sit anywhere in [0, WORLD_COLS) × [0, WORLD_ROWS); the bento fill
// reflows around it automatically.
export const TILE_REGISTRY: TileRegistryEntry[] = [
  {
    id: "tile_clock",
    label: "Clock",
    component: ClockGreeting,
    viewComponent: ClockGreetingView,
    worldCol: 26,
    worldRow: 27,
    cols: 5,
    rows: 3,
    home: true,
  },
  {
    id: "tile_weath",
    label: "Weather Now",
    component: WeatherNow,
    viewComponent: WeatherNowView,
    worldCol: 31,
    worldRow: 27,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_wifi",
    label: "Network",
    component: NetworkTile,
    viewComponent: NetworkTileView,
    worldCol: 35,
    worldRow: 27,
    cols: 3,
    rows: 3,
  },
  {
    id: "tile_tesla",
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    worldCol: 26,
    worldRow: 30,
    cols: 4,
    rows: 4,
  },
  {
    id: "tile_hourly",
    label: "Next 12 Hours",
    component: Next12Hours,
    viewComponent: Next12HoursView,
    worldCol: 30,
    worldRow: 30,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ctrl",
    label: "Controls",
    component: ControlsTile,
    viewComponent: ControlsTileView,
    worldCol: 34,
    worldRow: 30,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_dogcam",
    label: "Dog Cam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    worldCol: 30,
    worldRow: 33,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ac",
    label: "Climate · A/C",
    component: ClimateTile,
    viewComponent: ClimateTileView,
    worldCol: 34,
    worldRow: 33,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_event",
    label: "Upcoming",
    component: EventsTile,
    viewComponent: EventsTileView,
    worldCol: 26,
    worldRow: 34,
    cols: 4,
    rows: 2,
  },
  // Media tiles (www-51hf) — placed below the existing 3-row cluster.
  {
    id: "tile_tv",
    label: "TV",
    component: TvNowPlayingTile,
    viewComponent: TvNowPlayingTileView,
    worldCol: 26,
    worldRow: 36,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_sound",
    label: "Sound System",
    component: SoundSystemTile,
    viewComponent: SoundSystemTileView,
    worldCol: 30,
    worldRow: 36,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_tvapps",
    label: "TV Apps",
    component: TvAppsTile,
    viewComponent: TvAppsTileView,
    worldCol: 26,
    worldRow: 39,
    cols: 4,
    rows: 2,
    ownsTap: true,
  },
  {
    id: "tile_quickplay",
    label: "Quick Play",
    component: QuickPlayTile,
    viewComponent: QuickPlayTileView,
    worldCol: 30,
    worldRow: 39,
    cols: 4,
    rows: 2,
    ownsTap: true,
  },
];

// The tile the board opens on and idles back to (the Clock), or the first entry
// if none is flagged. Centralized so Board doesn't hard-code an id.
export const HOME_TILE: TileRegistryEntry = TILE_REGISTRY.find((t) => t.home) ?? TILE_REGISTRY[0];

// Flat lookup: component or viewComponent → registry entry.
// Used by the Storybook BoardDecorator to auto-size any tile story.
// biome-ignore lint/suspicious/noExplicitAny: keyed by component reference
const componentMap = new Map<ComponentType<any>, TileRegistryEntry>();
for (const entry of TILE_REGISTRY) {
  componentMap.set(entry.component, entry);
  componentMap.set(entry.viewComponent, entry);
}

export function registryEntryForComponent(
  // biome-ignore lint/suspicious/noExplicitAny: accepts any component reference
  component: ComponentType<any> | undefined,
): TileRegistryEntry | undefined {
  if (!component) return undefined;
  return componentMap.get(component);
}
