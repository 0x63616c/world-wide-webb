import type { AppManifest } from "@app-kit";
import guestWifiManifest from "@features/guest-wifi/manifest";
import networkManifest from "@features/network/manifest";
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
import { DeployTile } from "../components/tiles/DeployTile";
import { DeployTileView } from "../components/tiles/DeployTileView";
import { DogCamTile } from "../components/tiles/DogCamTile";
import { DogCamTileView } from "../components/tiles/DogCamTileView";
import { EventsTile } from "../components/tiles/EventsTile";
import { EventsTileView } from "../components/tiles/EventsTileView";
import { FrontendLogsTile } from "../components/tiles/FrontendLogsTile";
import { FrontendLogsTileView } from "../components/tiles/FrontendLogsTileView";
import { Next12Hours } from "../components/tiles/Next12Hours";
import { Next12HoursView } from "../components/tiles/Next12HoursView";
import { NotificationCenterTile } from "../components/tiles/NotificationCenterTile";
import { NotificationCenterTileView } from "../components/tiles/NotificationCenterTileView";
import { PhotoBoothTile } from "../components/tiles/photo-booth/PhotoBoothTile";
import { TeslaTile } from "../components/tiles/TeslaTile";
import { TeslaTileView } from "../components/tiles/TeslaTileView";
import { WakesTile } from "../components/tiles/WakesTile";
import { WakesTileView } from "../components/tiles/WakesTileView";
import { WeatherNow } from "../components/tiles/WeatherNow";
import { WeatherNowView } from "../components/tiles/WeatherNowView";
import { WeightTile } from "../components/tiles/WeightTile";
import { WeightTileView } from "../components/tiles/WeightTileView";
export type TileRegistryEntry = {
  id: string;
  // The tile's name, used by the minimap hover label, the centered-tile pan
  // label, and the "Open …" aria-label. MUST match the title the tile renders in
  // its TileHeader on the board (e.g. "Weather Now", "Climate · A/C", "Upcoming"),
  // so the minimap label always maps to what the user sees on the tile.
  label: string;
  component: ComponentType;
  viewComponent: ComponentType<never>;
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
};

// One entry per real tile, free-placed in the world by world-cell coords. The
// coordinates below are the DEFAULT positions (V4B "Hourly Left" layout), which are
// overridden by board_tile_placement rows in the database. Each tile's worldCol/worldRow
// can be moved by editing these numbers or by creating a board_tile_placement override;
// the bento fill reflows around them automatically.
// The hand-placed, non-feature tiles. Folded features (Track C, C7) own their
// own placement in their manifest and are unioned into TILE_REGISTRY below —
// the Guest Wi-Fi tile used to live here as `tile_guestwifi` but now comes from
// features/guest-wifi/manifest.ts.
const REGISTRY_ENTRIES: TileRegistryEntry[] = [
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
  // Weight tile (spec 2026-07-21): 3x2 in the rows-22/23 band above the home
  // cluster, right of Guest Wi-Fi. Col 34 (not 33) — the bento fill needs the
  // 30-33 gap to tile the band gap-free (placeholder-tiles test enforces it).
  {
    id: "tile_weight",
    label: "Weight",
    component: WeightTile,
    viewComponent: WeightTileView,
    worldCol: 34,
    worldRow: 22,
    cols: 3,
    rows: 2,
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
    id: "tile_tesla",
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    worldCol: 22,
    worldRow: 27,
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
  },
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
    id: "tile_tvapps",
    label: "TV Apps",
    component: TvAppsTile,
    viewComponent: TvAppsTileView,
    worldCol: 30,
    worldRow: 32,
    cols: 4,
    rows: 2,
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
  {
    id: "tile_wakes",
    label: "Activity",
    component: WakesTile,
    viewComponent: WakesTileView,
    worldCol: 34,
    worldRow: 30,
    cols: 2,
    rows: 2,
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
  },
  // Photo booth. A titled 2x2 tile sitting flush along the cluster's top edge:
  // beside the Guest Wi-Fi QR (cols 28-29) and directly above Climate (col 30),
  // so it reads as part of the home row without displacing any existing tile. Its
  // face carries a standard TileHeader ("Photo Booth"), so it is held to the
  // label↔title guard (tile-title-sync.test.tsx) like every other titled tile.
  {
    id: "tile_booth",
    label: "Photo Booth",
    component: PhotoBoothTile,
    viewComponent: PhotoBoothTile,
    worldCol: 30,
    worldRow: 22,
    cols: 2,
    rows: 2,
  },
];

// Folded features (Track C, C7). Each app manifest owns its tile placement; the
// board renders the UNION of the hand-placed registry entries and every feature
// tile. The codegen (scripts/apps-gen) reads the SAME manifests and dedupes a
// registry entry whose id a feature already owns, so each tile has exactly one
// source of truth. Adding a feature = adding its manifest here + the folder.
const FEATURE_MANIFESTS: AppManifest[] = [guestWifiManifest, networkManifest];

function manifestToEntry(m: AppManifest): TileRegistryEntry {
  const viewComponent = m.tile.viewComponent;
  if (!viewComponent) {
    throw new Error(`feature manifest ${m.id} has no tile.viewComponent`);
  }
  return {
    id: m.id,
    label: m.tile.label,
    component: m.tile.component,
    viewComponent,
    worldCol: m.tile.worldCol,
    worldRow: m.tile.worldRow,
    cols: m.tile.cols,
    rows: m.tile.rows,
    ...(m.home ? { home: true as const } : {}),
  };
}

export const TILE_REGISTRY: TileRegistryEntry[] = [
  ...REGISTRY_ENTRIES,
  ...FEATURE_MANIFESTS.map(manifestToEntry),
];

// The tile the board opens on and idles back to (the Clock), or the first entry
// if none is flagged. Centralized so Board doesn't hard-code an id.
export const HOME_TILE: TileRegistryEntry = TILE_REGISTRY.find((t) => t.home) ?? TILE_REGISTRY[0];

// Flat lookup: component or viewComponent → registry entry.
// Used by the Storybook BoardDecorator to auto-size any tile story.
const componentMap = new Map<ComponentType | ComponentType<never>, TileRegistryEntry>();
for (const entry of TILE_REGISTRY) {
  componentMap.set(entry.component, entry);
  componentMap.set(entry.viewComponent, entry);
}

export function registryEntryForComponent(
  component: ComponentType | ComponentType<never> | undefined,
): TileRegistryEntry | undefined {
  if (!component) return undefined;
  return componentMap.get(component);
}
