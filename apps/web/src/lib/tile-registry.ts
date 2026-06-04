import type { ComponentType } from "react";
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
import { GRID_COLS, GRID_ROWS } from "./grid-constants";

export const GridArea = {
  Clock: "clock",
  Weather: "weath",
  Wifi: "wifi",
  Tesla: "tesla",
  Hourly: "hourly",
  Controls: "ctrl",
  DogCam: "dogcam",
  Climate: "ac",
  Events: "event",
} as const;
export type GridArea = (typeof GridArea)[keyof typeof GridArea];

export type TileRegistryEntry = {
  id: string;
  // Human title shown when the tile is tapped open in its showcase modal.
  label: string;
  // biome-ignore lint/suspicious/noExplicitAny: tile containers have no shared prop contract
  component: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: view components have varying prop signatures
  viewComponent: ComponentType<any>;
  gridArea: GridArea;
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
  // When true the tile owns its own tap surface (it opens its own detail modal),
  // so the board does NOT open the generic showcase modal for it. Controls opens
  // its expanded modal; other tiles flip this on as their detail modals land.
  ownsTap?: boolean;
};

// One entry per tile on the 12×9 square-cell board. colStart/rowStart are
// 1-indexed. Positions must tile the full 12×9 grid with no gaps or overlaps.
export const TILE_REGISTRY: TileRegistryEntry[] = [
  {
    id: "tile_clock",
    label: "Clock",
    component: ClockGreeting,
    viewComponent: ClockGreetingView,
    gridArea: GridArea.Clock,
    colStart: 1,
    rowStart: 1,
    cols: 5,
    rows: 3,
  },
  {
    id: "tile_weath",
    label: "Weather",
    component: WeatherNow,
    viewComponent: WeatherNowView,
    gridArea: GridArea.Weather,
    colStart: 6,
    rowStart: 1,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_wifi",
    label: "Network",
    component: NetworkTile,
    viewComponent: NetworkTileView,
    gridArea: GridArea.Wifi,
    colStart: 10,
    rowStart: 1,
    cols: 3,
    rows: 3,
  },
  {
    id: "tile_tesla",
    label: "Tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    gridArea: GridArea.Tesla,
    colStart: 1,
    rowStart: 4,
    cols: 4,
    rows: 4,
  },
  {
    id: "tile_hourly",
    label: "Next 12 Hours",
    component: Next12Hours,
    viewComponent: Next12HoursView,
    gridArea: GridArea.Hourly,
    colStart: 5,
    rowStart: 4,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ctrl",
    label: "Controls",
    component: ControlsTile,
    viewComponent: ControlsTileView,
    gridArea: GridArea.Controls,
    colStart: 9,
    rowStart: 4,
    cols: 4,
    rows: 3,
    ownsTap: true,
  },
  {
    id: "tile_dogcam",
    label: "Dog Cam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    gridArea: GridArea.DogCam,
    colStart: 5,
    rowStart: 7,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_ac",
    label: "Climate",
    component: ClimateTile,
    viewComponent: ClimateTileView,
    gridArea: GridArea.Climate,
    colStart: 9,
    rowStart: 7,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_event",
    label: "Events",
    component: EventsTile,
    viewComponent: EventsTileView,
    gridArea: GridArea.Events,
    colStart: 1,
    rowStart: 8,
    cols: 4,
    rows: 2,
  },
];

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

// Builds the CSS grid-template-areas string from registry positions.
// Fills a GRID_ROWS×GRID_COLS matrix, then serialises to quoted row strings.
export function deriveGridAreas(registry: TileRegistryEntry[]): string {
  const grid: string[][] = Array.from({ length: GRID_ROWS }, () => Array(GRID_COLS).fill("."));

  for (const { gridArea, colStart, rowStart, cols, rows } of registry) {
    for (let r = rowStart - 1; r < rowStart - 1 + rows; r++) {
      for (let c = colStart - 1; c < colStart - 1 + cols; c++) {
        grid[r][c] = gridArea;
      }
    }
  }

  return grid.map((row) => `"${row.join(" ")}"`).join(" ");
}
