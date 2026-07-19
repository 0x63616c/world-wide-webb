/**
 * Tile → detail-page registry. Maps a board tile id to its full-page detail
 * entry, rendered by TileDetailHost. Successor to ../modals/registry.ts: tiles
 * migrate here one at a time (the board checks THIS registry first and falls
 * back to the old modal path), so the list grows per migration commit until it
 * covers every tile and the modal registry dies.
 */

import { clockDetailEntry } from "../modals/wiring/clock";
import { networkDetailEntry } from "../modals/wiring/network";
import { teslaDetailEntry } from "../modals/wiring/tesla";
import { weatherDetailEntry } from "../modals/wiring/weather";
import type { TileDetailEntry } from "./types";

// Grows one entry per migrated tile; final state covers all board tiles
// (completeness enforced by a registry test once the migration lands).
const ENTRIES: TileDetailEntry[] = [
  clockDetailEntry,
  weatherDetailEntry,
  networkDetailEntry,
  teslaDetailEntry,
];

const BY_TILE_ID = new Map<string, TileDetailEntry>(ENTRIES.map((e) => [e.tileId, e]));

export function getTileDetailEntry(tileId: string): TileDetailEntry | undefined {
  return BY_TILE_ID.get(tileId);
}
