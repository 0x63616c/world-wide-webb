import type { ComponentType } from "react";
import { ClimateTile } from "../components/tiles/ClimateTile";
import { ClockGreeting } from "../components/tiles/ClockGreeting";
import { ControlsTile } from "../components/tiles/ControlsTile";
import { DogCamTile } from "../components/tiles/DogCamTile";
import { EventsTile } from "../components/tiles/EventsTile";
import { NetworkTile } from "../components/tiles/NetworkTile";
import { Next12Hours } from "../components/tiles/Next12Hours";
import { TeslaTile } from "../components/tiles/TeslaTile";
import { WeatherNow } from "../components/tiles/WeatherNow";
import { GRID_COLS, GRID_ROWS } from "./grid-constants";

export type TileRegistryEntry = {
  id: string;
  // biome-ignore lint/suspicious/noExplicitAny: tile containers have no shared prop contract
  component: ComponentType<any>;
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
    gridArea: "clock",
    colStart: 1,
    rowStart: 1,
    cols: 5,
    rows: 2,
  },
  {
    id: "tile_weath",
    component: WeatherNow,
    gridArea: "weath",
    colStart: 6,
    rowStart: 1,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_wifi",
    component: NetworkTile,
    gridArea: "wifi",
    colStart: 10,
    rowStart: 1,
    cols: 3,
    rows: 2,
  },
  {
    id: "tile_tesla",
    component: TeslaTile,
    gridArea: "tesla",
    colStart: 1,
    rowStart: 3,
    cols: 4,
    rows: 3,
  },
  {
    id: "tile_hourly",
    component: Next12Hours,
    gridArea: "hourly",
    colStart: 5,
    rowStart: 3,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_ctrl",
    component: ControlsTile,
    gridArea: "ctrl",
    colStart: 9,
    rowStart: 3,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_dogcam",
    component: DogCamTile,
    gridArea: "dogcam",
    colStart: 5,
    rowStart: 5,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_ac",
    component: ClimateTile,
    gridArea: "ac",
    colStart: 9,
    rowStart: 5,
    cols: 4,
    rows: 2,
  },
  {
    id: "tile_event",
    component: EventsTile,
    gridArea: "event",
    colStart: 1,
    rowStart: 6,
    cols: 4,
    rows: 1,
  },
];

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
