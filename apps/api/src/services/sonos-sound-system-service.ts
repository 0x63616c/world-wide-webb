/**
 * Sonos sound-system service (CC-51hf.9, reshaped in CC-7u9z).
 *
 * Returns one room per PHYSICAL player — Living Room, Desk, Bedroom, Bathroom,
 * Kitchen — each with its OWN volume/mute/IP, plus the coordinator UUID of the
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
 *  - Never cache topology — grouping is volatile (TV power reshapes it, A11).
 *  - Volume/mute are per-device (each player owns them even while grouped);
 *    transport state belongs to the group and is read from the coordinator.
 */

import type { ZoneGroup } from "../integrations/sonos";
import { SonosClient } from "../integrations/sonos";

// Static LAN IP of the topology anchor device (Living Room, verified in INTEGRATION-NOTES.md).
// Any reachable player works for GetZoneGroupState; we use a fixed anchor so the service has
// no discovery dependency.
const TOPOLOGY_ANCHOR_IP = "192.168.0.193";

// UUID of the bonded Desk RF satellite. It is a hidden half of the Desk bonded pair and must
// never appear as its own room — it is dropped wherever it shows up (member or coordinator).
const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";

// Stable display order for the rooms, so faders never reshuffle between polls. Rooms not in this
// list (e.g. a new speaker) sort after the known ones, alphabetically.
const ROOM_ORDER = ["Living Room", "Desk", "Bedroom", "Bathroom", "Kitchen"];

function roomRank(name: string): number {
  const i = ROOM_ORDER.indexOf(name);
  return i === -1 ? ROOM_ORDER.length : i;
}

/** @public — shape for the soundSystem tRPC query response; consumed by the media router and the Sound System tile */
export interface SoundSystemRoom {
  /** Human-readable room name (this player's ZoneName). */
  name: string;
  /** This player's own UUID — the stable identity key for the room. */
  uuid: string;
  /** This player's LAN IP — the target for per-room volume/mute writes. */
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
  /** Source label (reserved for future source classification; always null today). */
  sourceLabel: string | null;
}

export interface SoundSystemResult {
  rooms: SoundSystemRoom[];
}

/**
 * Fetches the current Sonos sound system state.
 * Reads topology fresh every call — never caches grouping.
 * THROWS on any SonosClient error (network, SOAP, HTTP >= 4xx).
 */
export async function getSoundSystem(): Promise<SoundSystemResult> {
  const anchorClient = new SonosClient(TOPOLOGY_ANCHOR_IP);

  // GetZoneGroupState is read fresh every call — grouping is volatile (TV power reshapes it).
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
    const transportP = new SonosClient(coordinatorMember.ip).getTransportInfo();

    return group.members
      .filter((m) => m.uuid !== DESK_RF_BONDED_UUID)
      .map(async (member): Promise<SoundSystemRoom> => {
        const deviceClient = new SonosClient(member.ip);
        const [volume, muted, transportInfo] = await Promise.all([
          deviceClient.getVolume(),
          deviceClient.getMute(),
          transportP,
        ]);
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
          sourceLabel: null,
        };
      });
  });

  const rooms = await Promise.all(tasks);
  rooms.sort((a, b) => roomRank(a.name) - roomRank(b.name) || a.name.localeCompare(b.name));
  return { rooms };
}
