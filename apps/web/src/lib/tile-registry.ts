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

export type TileRegistryEntry = {
  id: string;
  // biome-ignore lint/suspicious/noExplicitAny: tile containers have no shared prop contract
  component: ComponentType<any>;
  // biome-ignore lint/suspicious/noExplicitAny: view components have varying prop signatures
  viewComponent: ComponentType<any>;
  gridArea: string;
  colStart: number;
  rowStart: number;
  cols: number;
  rows: number;
};

// One entry per tile on the 12×6 board. colStart/rowStart are 1-indexed.
// Positions must tile the full 12×6 grid with no gaps or overlaps.
export const TILE_REGISTRY: TileRegistryEntry[] = [
  {
    id: "tile_clock",
    component: ClockGreeting,
    viewComponent: ClockGreetingView,
    gridArea: "clock",
    colStart: 1,
    rowStart: 1,
    cols: 5,
    rows: 2,
  },
  {
    id: "tile_weath",
    component: WeatherNow,
    viewComponent: WeatherNowView,
    gridArea: "weath",
    colStart: 6,
    rowStart: 1,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_wifi",
    component: NetworkTile,
    viewComponent: NetworkTileView,
    gridArea: "wifi",
    colStart: 10,
    rowStart: 1,
    cols: 3,
    rows: 2,
  },
  {
    id: "tile_tesla",
    component: TeslaTile,
    viewComponent: TeslaTileView,
    gridArea: "tesla",
    colStart: 1,
    rowStart: 3,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_hourly",
    component: Next12Hours,
    viewComponent: Next12HoursView,
    gridArea: "hourly",
    colStart: 5,
    rowStart: 3,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_ctrl",
    component: ControlsTile,
    viewComponent: ControlsTileView,
    gridArea: "ctrl",
    colStart: 9,
    rowStart: 3,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_dogcam",
    component: DogCamTile,
    viewComponent: DogCamTileView,
    gridArea: "dogcam",
    colStart: 5,
    rowStart: 5,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_ac",
    component: ClimateTile,
    viewComponent: ClimateTileView,
    gridArea: "ac",
    colStart: 9,
    rowStart: 5,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_event",
    component: EventsTile,
    viewComponent: EventsTileView,
    gridArea: "event",
    colStart: 1,
    rowStart: 6,
    cols: 4,
    rows: 1,
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
