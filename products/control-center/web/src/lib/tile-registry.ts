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
import { DeployTile } from "../components/tiles/DeployTile";
import { DeployTileView } from "../components/tiles/DeployTileView";
import { DogCamTile } from "../components/tiles/DogCamTile";
import { DogCamTileView } from "../components/tiles/DogCamTileView";
import { DogModeTile, DogModeTileView } from "../components/tiles/DogModeTileView";
import { EventsTile } from "../components/tiles/EventsTile";
import { EventsTileView } from "../components/tiles/EventsTileView";
import { FrontendLogsTile } from "../components/tiles/FrontendLogsTile";
import { FrontendLogsTileView } from "../components/tiles/FrontendLogsTileView";
import { NetworkTile } from "../components/tiles/NetworkTile";
import { NetworkTileView } from "../components/tiles/NetworkTileView";
import { Next12Hours } from "../components/tiles/Next12Hours";
import { Next12HoursView } from "../components/tiles/Next12HoursView";
import { NotificationCenterTile } from "../components/tiles/NotificationCenterTile";
import { NotificationCenterTileView } from "../components/tiles/NotificationCenterTileView";
import { SchedulesTile } from "../components/tiles/SchedulesTile";
import { SchedulesTileView } from "../components/tiles/SchedulesTileView";
import { TeslaTile } from "../components/tiles/TeslaTile";
import { TeslaTileView } from "../components/tiles/TeslaTileView";
import { WakesTile } from "../components/tiles/WakesTile";
import { WakesTileView } from "../components/tiles/WakesTileView";
import { WeatherNow } from "../components/tiles/WeatherNow";
import { WeatherNowView } from "../components/tiles/WeatherNowView";

type TileComponent =
  | typeof ClockGreeting
  | typeof FrontendLogsTile
  | typeof WeatherNow
  | typeof NetworkTile
  | typeof TeslaTile
  | typeof Next12Hours
  | typeof ControlsTile
  | typeof SchedulesTile
  | typeof DogCamTile
  | typeof DogModeTile
  | typeof DeployTile
  | typeof ClimateTile
  | typeof EventsTile
  | typeof TvNowPlayingTile
  | typeof SoundSystemTile
  | typeof TvAppsTile
  | typeof QuickPlayTile
  | typeof NotificationCenterTile
  | typeof WakesTile;

type TileViewComponent =
  | typeof ClockGreetingView
  | typeof FrontendLogsTileView
  | typeof WeatherNowView
  | typeof NetworkTileView
  | typeof TeslaTileView
  | typeof Next12HoursView
  | typeof ControlsTileView
  | typeof SchedulesTileView
  | typeof DogCamTileView
  | typeof DogModeTileView
  | typeof DeployTileView
  | typeof ClimateTileView
  | typeof EventsTileView
  | typeof TvNowPlayingTileView
  | typeof SoundSystemTileView
  | typeof TvAppsTileView
  | typeof QuickPlayTileView
  | typeof NotificationCenterTileView
  | typeof WakesTileView;

export type TileRegistryEntry = {
  id: string;
  // The tile's name, used by the minimap hover label, the centered-tile pan
  // label, and the "Open …" aria-label. MUST match the title the tile renders in
  // its TileHeader on the board (e.g. "Weather Now", "Climate · A/C", "Upcoming"),
  // so the minimap label always maps to what the user sees on the tile.
  label: string;
  component: TileComponent;
  viewComponent: TileViewComponent;
  // Free position in the ONE world, in 0-indexed world-cell coords. A tile may sit
  // ANYWHERE at any size  --  there is no cluster, no grid to fill, no gap/overlap
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
// coordinates below are the DEFAULT positions (V4B "Hourly Left" layout), which are
// overridden by board_tile_placement rows in the database. Each tile's worldCol/worldRow
// can be moved by editing these numbers or by creating a board_tile_placement override;
// the bento fill reflows around them automatically.
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
    worldCol: 26,
    worldRow: 24,
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
    worldCol: 22,
    worldRow: 30,
    cols: 4,
    rows: 4,
  },
  {
    id: "tile_hourly",
    label: "Next 12 Hours",
    component: Next12Hours,
    viewComponent: Next12HoursView,
    worldCol: 22,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ctrl",
    label: "Controls",
    component: ControlsTile,
    viewComponent: ControlsTileView,
    worldCol: 31,
    worldRow: 27,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_sched",
    label: "Schedules",
    component: SchedulesTile,
    viewComponent: SchedulesTileView,
    worldCol: 34,
    worldRow: 30,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_dogcam",
    label: "Living Room Cam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    worldCol: 38,
    worldRow: 27,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ac",
    label: "Climate · A/C",
    component: ClimateTile,
    viewComponent: ClimateTileView,
    worldCol: 30,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_dogmode",
    label: "Dog Mode",
    component: DogModeTile,
    viewComponent: DogModeTileView,
    worldCol: 18,
    worldRow: 27,
    cols: 4,
    rows: 3,
  },
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
  // Media tiles (www-51hf)  --  TV, Sound System, TV Apps, Quick Play, and
  // Frontend Logs. Default positions are V4B layout, overridable via
  // board_tile_placement rows in the database.
  {
    id: "tile_tv",
    label: "TV",
    component: TvNowPlayingTile,
    viewComponent: TvNowPlayingTileView,
    worldCol: 18,
    worldRow: 24,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_sound",
    label: "Sound System",
    component: SoundSystemTile,
    viewComponent: SoundSystemTileView,
    worldCol: 22,
    worldRow: 27,
    cols: 4,
    rows: 3,
    ownsTap: true,
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
    ownsTap: true,
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
    ownsTap: true,
  },
  {
    id: "tile_wakes",
    label: "Activity",
    component: WakesTile,
    viewComponent: WakesTileView,
    worldCol: 38,
    worldRow: 30,
    cols: 2,
    rows: 2,
    ownsTap: true,
  },
  {
    id: "tile_deploys",
    label: "Deploys",
    component: DeployTile,
    viewComponent: DeployTileView,
    worldCol: 34,
    worldRow: 24,
    cols: 4,
    rows: 3,
  },
  // Notification Center. Sits in the free 4x3 block at cols 38-41 / rows 24-26,
  // directly above Living Room Cam and right of Deploys , the top-right corner
  // of the cluster, matching where the board's alert banners already appear.
  {
    id: "tile_notif",
    label: "Notifications",
    component: NotificationCenterTile,
    viewComponent: NotificationCenterTileView,
    worldCol: 38,
    worldRow: 24,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_felogs",
    label: "Frontend Logs",
    component: FrontendLogsTile,
    viewComponent: FrontendLogsTileView,
    worldCol: 26,
    worldRow: 30,
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
const componentMap = new Map<TileComponent | TileViewComponent, TileRegistryEntry>();
for (const entry of TILE_REGISTRY) {
  componentMap.set(entry.component, entry);
  componentMap.set(entry.viewComponent, entry);
}

export function registryEntryForComponent(
  component: TileComponent | TileViewComponent | undefined,
): TileRegistryEntry | undefined {
  if (!component) return undefined;
  return componentMap.get(component);
}
