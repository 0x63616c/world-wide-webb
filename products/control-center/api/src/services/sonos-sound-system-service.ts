/**
 * Sonos sound-system service (www-51hf.9, reshaped in www-7u9z).
 *
 * Returns one room per PHYSICAL player , Living Room, Desk, Bedroom, Bathroom,
 * Kitchen , each with its OWN volume/mute/IP, plus the coordinator UUID of the
 * group it currently belongs to (so the UI can gang grouped rooms together).
 * Topology is read FRESH on every call. The bonded Desk RF satellite
 * (RINCON_804AF288FDBA01400) is collapsed into the Desk room so only 5 rooms
 * show, not 6.
 *
 * Why per-player, not per-group: a Sonos group is named after its coordinator,
 * so a "play everywhere" group would collapse the whole house into a single
 * fader labelled after one room. Per-player rooms always show all 5; grouping is
 * expressed by a shared `coordinatorUuid` and ganged in the mixer UI.
 *
 * Design rules:
 *  - THROW on any SonosClient failure (never return fabricated data, A3).
 *  - Never cache topology , grouping is volatile (TV power reshapes it, A11).
 *  - Volume/mute are per-device (each player owns them even while grouped);
 *    transport state belongs to the group and is read from the coordinator.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { deviceState } from "../db/schema";
import type { ZoneGroup } from "../integrations/sonos";
import { SonosClient } from "../integrations/sonos";
import { DeviceKind, isSpeakerState } from "./device-state-mapping";

// Static LAN IP of the topology anchor device (Living Room, verified in INTEGRATION-NOTES.md).
// Any reachable player works for GetZoneGroupState; we use a fixed anchor so the service has
// no discovery dependency. Shared with the sonos-volume-enforcer (www-5mek).
export const TOPOLOGY_ANCHOR_IP = "192.168.0.193";

// UUID of the bonded Desk RF satellite. It is a hidden half of the Desk bonded pair and must
// never appear as its own room , it is dropped wherever it shows up (member or coordinator).
// Shared with the sonos-volume-enforcer so the satellite never gets a speaker row.
export const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";

// Stable display order for the rooms, so faders never reshuffle between polls. Rooms not in this
// list (e.g. a new speaker) sort after the known ones, alphabetically.
const ROOM_ORDER = ["Living Room", "Desk", "Bedroom", "Bathroom", "Kitchen"];

function roomRank(name: string): number {
  const i = ROOM_ORDER.indexOf(name);
  return i === -1 ? ROOM_ORDER.length : i;
}

// Hardware source anchors (verified live 2026-07-11). Desk line-in jack and the
// Living Room Beam's TV/ARC input — the two always-rendered Groups sources.
export const DESK_LINE_IN_UUID = "RINCON_804AF28AAB2001400";
export const BEAM_UUID = "RINCON_74CA6093255801400";

export type SourceKind = "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle";

/** Classifies a coordinator CurrentURI into a source kind. Pure. */
export function classifySourceUri(uri: string): SourceKind {
  if (uri === "" || uri.startsWith("x-rincon:")) return "idle";
  if (uri.startsWith("x-rincon-stream:")) return "line-in";
  if (uri.startsWith("x-sonos-htastream:")) return "tv";
  if (uri.startsWith("x-sonos-spotify:")) return "spotify";
  if (uri.startsWith("x-sonos-vli:")) {
    if (uri.includes(",spotify:")) return "spotify";
    if (uri.includes(",airplay:")) return "airplay";
    return "other";
  }
  return "other";
}

const SOURCE_LABELS: Record<SourceKind, string | null> = {
  "line-in": "Line-In",
  tv: "TV",
  spotify: "Spotify",
  airplay: "AirPlay",
  other: null,
  idle: null,
};

/** @public , shape for the soundSystem tRPC query response; consumed by the media router and the Sound System tile */
export interface SoundSystemRoom {
  /** Human-readable room name (this player's ZoneName). */
  name: string;
  /** This player's own UUID , the stable identity key for the room. */
  uuid: string;
  /** This player's LAN IP , the target for per-room volume/mute writes. */
  deviceIp: string;
  /** Coordinator UUID of the group this room currently belongs to; rooms sharing it are grouped. */
  coordinatorUuid: string;
  /** All player UUIDs in this room's group (includes the bonded RF satellite). */
  memberUuids: string[];
  /** Whether this room is its own group's coordinator. */
  isCoordinator: boolean;
  /** This player's own volume, 0-100. */
  volume: number;
  /** Whether this player is muted. */
  muted: boolean;
  /** Group transport state from the coordinator: "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED". */
  transportState: string;
  /** Human source label from the group coordinator's stream, null when idle/unknown. */
  sourceLabel: string | null;
  /** Classified source kind of this room's group (coordinator's CurrentURI). */
  sourceKind: SourceKind;
  /** Now-playing metadata from the group coordinator; null when the source has none. */
  trackTitle: string | null;
  trackArtist: string | null;
  albumArtUri: string | null;
}

export interface SoundSystemResult {
  rooms: SoundSystemRoom[];
}

/**
 * Fetches the current Sonos sound system state.
 * Reads topology fresh every call , never caches grouping.
 * THROWS on any SonosClient error (network, SOAP, HTTP >= 4xx).
 */
export async function getSoundSystem(): Promise<SoundSystemResult> {
  const anchorClient = new SonosClient(TOPOLOGY_ANCHOR_IP);

  // GetZoneGroupState is read fresh every call , grouping is volatile (TV power reshapes it).
  const groups: ZoneGroup[] = await anchorClient.getZoneGroupState();

  // Drop any phantom group coordinated by the bonded RF satellite so it never appears as a room.
  const visibleGroups = groups.filter((g) => g.coordinatorUuid !== DESK_RF_BONDED_UUID);

  // One task per physical player. Transport is a group property, so read it once per group (from
  // the coordinator) and share that promise across the group's members.
  const tasks = visibleGroups.flatMap((group) => {
    const coordinatorMember = group.members.find((m) => m.uuid === group.coordinatorUuid);
    if (!coordinatorMember) {
      throw new Error(
        `getSoundSystem: no coordinator member found in group ${group.coordinatorUuid}`,
      );
    }
    const memberUuids = group.members.map((m) => m.uuid);
    const coordinatorClient = new SonosClient(coordinatorMember.ip);
    const transportP = coordinatorClient.getTransportInfo();
    const mediaP = coordinatorClient.getMediaInfo();
    const positionP = coordinatorClient.getPositionInfo();

    return group.members
      .filter((m) => m.uuid !== DESK_RF_BONDED_UUID)
      .map(async (member): Promise<SoundSystemRoom> => {
        const deviceClient = new SonosClient(member.ip);
        const [volume, muted, transportInfo, mediaInfo, positionInfo] = await Promise.all([
          deviceClient.getVolume(),
          deviceClient.getMute(),
          transportP,
          mediaP,
          positionP,
        ]);
        const sourceKind = classifySourceUri(mediaInfo.currentUri);
        return {
          name: member.zoneName,
          uuid: member.uuid,
          deviceIp: member.ip,
          coordinatorUuid: group.coordinatorUuid,
          memberUuids,
          isCoordinator: member.uuid === group.coordinatorUuid,
          volume,
          muted,
          transportState: transportInfo.state,
          sourceLabel: SOURCE_LABELS[sourceKind],
          sourceKind,
          trackTitle: positionInfo.trackTitle,
          trackArtist: positionInfo.trackArtist,
          albumArtUri: positionInfo.albumArtUri,
        };
      });
  });

  const rooms = await Promise.all(tasks);
  rooms.sort((a, b) => roomRank(a.name) - roomRank(b.name) || a.name.localeCompare(b.name));

  // Desired-authoritative volume (www-5mek): device_state.desiredState is the
  // source of truth, so the fader never snaps back to a pre-enforcer live read
  // on the 10s poll , same model as lights (mergeDeviceState).
  const desiredVolumeByIp = await readDesiredVolumes();
  for (const room of rooms) {
    const desired = desiredVolumeByIp.get(room.deviceIp);
    if (desired != null) room.volume = desired;
  }

  return { rooms };
}

/**
 * Desired volume per device IP from the speaker rows. A DB outage degrades to
 * the live UPnP reads (real data, just eventually-consistent) rather than
 * failing the whole media tile.
 */
async function readDesiredVolumes(): Promise<Map<string, number>> {
  const byIp = new Map<string, number>();
  try {
    const rows = await db
      .select()
      .from(deviceState)
      .where(eq(deviceState.kind, DeviceKind.Speaker));
    for (const row of rows) {
      if (isSpeakerState(row.desiredState)) byIp.set(row.entityId, row.desiredState.volume);
    }
  } catch {
    // DB unreachable , fall back to the live reads already in `rooms`.
  }
  return byIp;
}
