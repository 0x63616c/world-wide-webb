/**
 * Tile → detail-page registry. Maps a board tile id to its full-page detail
 * entry, rendered by TileDetailHost. This is the ONLY tap-resolution path (the
 * old modal registry is gone): EVERY board tile must have an entry here, or its
 * tap silently no-ops , registry-entries.test.ts enforces completeness.
 */

import { climateDetailEntry } from "@features/ac/web/wiring/climate";
import { controlsDetailEntry } from "@features/ctrl/web/wiring/controls";
import { clockDetailEntry } from "@features/events/web/wiring/clock";
import { eventsDetailEntry } from "@features/events/web/wiring/events";
import { frontendLogsDetailEntry } from "@features/felogs/detail-wiring";
import { activityDetailEntry } from "@features/wakes/web/wiring/activity";
import { next12HoursDetailEntry } from "@features/weather/web/wiring/next12hours";
import { weatherDetailEntry } from "@features/weather/web/wiring/weather";
import { networkDetailEntry } from "../views/wiring/network";
import { teslaDetailEntry } from "../views/wiring/tesla";
import type { TileDetailEntry } from "./types";
import { deploysDetailEntry } from "./wiring/deploys";
import { dogCamDetailEntry } from "./wiring/dogcam";
import { guestWifiDetailEntry } from "./wiring/guest-wifi";
import { notificationsDetailEntry } from "./wiring/notifications";
import { photoBoothDetailEntry } from "./wiring/photo-booth";
import { quickPlayDetailEntry } from "./wiring/quickplay";
import { soundDetailEntry } from "./wiring/sound";
import { tvDetailEntry } from "./wiring/tv";
import { tvAppsDetailEntry } from "./wiring/tv-apps";
import { weightDetailEntry } from "./wiring/weight";

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
  soundDetailEntry,
  notificationsDetailEntry,
  tvAppsDetailEntry,
  tvDetailEntry,
  quickPlayDetailEntry,
  controlsDetailEntry,
  activityDetailEntry,
  dogCamDetailEntry,
  frontendLogsDetailEntry,
  guestWifiDetailEntry,
  photoBoothDetailEntry,
  weightDetailEntry,
];

const BY_TILE_ID = new Map<string, TileDetailEntry>(ENTRIES.map((e) => [e.tileId, e]));

export function getTileDetailEntry(tileId: string): TileDetailEntry | undefined {
  return BY_TILE_ID.get(tileId);
}
