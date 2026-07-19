/**
 * Tile → detail-page registry. Maps a board tile id to its full-page detail
 * entry, rendered by TileDetailHost. Successor to ../modals/registry.ts: tiles
 * migrate here one at a time (the board checks THIS registry first and falls
 * back to the old modal path), so the list grows per migration commit until it
 * covers every tile and the modal registry dies.
 */

import { climateDetailEntry } from "../modals/wiring/climate";
import { clockDetailEntry } from "../modals/wiring/clock";
import { eventsDetailEntry } from "../modals/wiring/events";
import { networkDetailEntry } from "../modals/wiring/network";
import { next12HoursDetailEntry } from "../modals/wiring/next12hours";
import { teslaDetailEntry } from "../modals/wiring/tesla";
import { weatherDetailEntry } from "../modals/wiring/weather";
import type { TileDetailEntry } from "./types";
import { activityDetailEntry } from "./wiring/activity";
import { controlsDetailEntry } from "./wiring/controls";
import { deploysDetailEntry } from "./wiring/deploys";
import { dogCamDetailEntry } from "./wiring/dogcam";
import { dogModeDetailEntry } from "./wiring/dogmode";
import { frontendLogsDetailEntry } from "./wiring/frontend-logs";
import { notificationsDetailEntry } from "./wiring/notifications";
import { quickPlayDetailEntry } from "./wiring/quickplay";
import { schedulesDetailEntry } from "./wiring/schedules";
import { soundDetailEntry } from "./wiring/sound";
import { tvDetailEntry } from "./wiring/tv";
import { tvAppsDetailEntry } from "./wiring/tv-apps";

// Grows one entry per migrated tile; final state covers all board tiles
// (completeness enforced by a registry test once the migration lands).
const ENTRIES: TileDetailEntry[] = [
  clockDetailEntry,
  weatherDetailEntry,
  networkDetailEntry,
  next12HoursDetailEntry,
  climateDetailEntry,
  eventsDetailEntry,
  teslaDetailEntry,
  deploysDetailEntry,
  schedulesDetailEntry,
  soundDetailEntry,
  notificationsDetailEntry,
  tvAppsDetailEntry,
  tvDetailEntry,
  quickPlayDetailEntry,
  controlsDetailEntry,
  activityDetailEntry,
  dogCamDetailEntry,
  dogModeDetailEntry,
  frontendLogsDetailEntry,
];

const BY_TILE_ID = new Map<string, TileDetailEntry>(ENTRIES.map((e) => [e.tileId, e]));

export function getTileDetailEntry(tileId: string): TileDetailEntry | undefined {
  return BY_TILE_ID.get(tileId);
}
