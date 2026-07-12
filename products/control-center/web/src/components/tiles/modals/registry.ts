/**
 * Tile → detail-modal registry. Maps a board tile id to its live modal entry
 * (default variant + the hook that builds its live variants). Tiles absent from
 * this map have no tap-to-open modal (e.g. Bedroom Cam; Controls keeps its own
 * "More" expanded modal).
 *
 * One wiring module per tile keeps each tile's adapters isolated and lets them
 * be built/edited independently.
 */

import type { TileModalEntry } from "./types";
import { climateModalEntry } from "./wiring/climate";
import { clockModalEntry } from "./wiring/clock";
import { eventsModalEntry } from "./wiring/events";
import { networkModalEntry } from "./wiring/network";
import { next12HoursModalEntry } from "./wiring/next12hours";
import { teslaModalEntry } from "./wiring/tesla";
import { weatherModalEntry } from "./wiring/weather";

const ENTRIES: TileModalEntry[] = [
  clockModalEntry,
  weatherModalEntry,
  networkModalEntry,
  teslaModalEntry,
  next12HoursModalEntry,
  climateModalEntry,
  eventsModalEntry,
];

const BY_TILE_ID = new Map<string, TileModalEntry>(ENTRIES.map((e) => [e.tileId, e]));

export function getTileModalEntry(tileId: string): TileModalEntry | undefined {
  return BY_TILE_ID.get(tileId);
}
