/**
 * Sonos sound-system service (www-51hf.9).
 *
 * Returns 5 logical rooms — Living Room, Desk, Bedroom, Bathroom, Kitchen —
 * with per-device volume/mute/transport state and FRESH group topology read
 * on every call. The bonded Desk RF satellite (RINCON_804AF288FDBA01400) is
 * collapsed into its coordinator so only 5 rooms are shown, not 6.
 *
 * Design rules:
 *  - THROW on any SonosClient failure (never return fabricated data, A3).
 *  - Never cache topology — grouping is volatile (TV power reshapes it, A11).
 *  - Transport state belongs to the group coordinator; volume/mute are per-device.
 */

import type { ZoneGroup } from "../integrations/sonos";
import { SonosClient } from "../integrations/sonos";

// Static LAN IP of the topology anchor device (Living Room Beam, verified in INTEGRATION-NOTES.md).
// Any coordinator IP works for GetZoneGroupState; we use a fixed anchor so the service has no
// discovery dependency.
const TOPOLOGY_ANCHOR_IP = "192.168.0.193";

// UUID of the bonded Desk RF satellite. This member is always inside the Desk ZoneGroup and
// must never appear as its own room. We filter groups by this UUID as a safety net in case
// future Sonos firmware surfaces it as a phantom coordinator.
const DESK_RF_BONDED_UUID = "RINCON_804AF288FDBA01400";

/** @public — shape for the soundSystem tRPC query response; consumed by the media router and future Sound System tile */
export interface SoundSystemRoom {
  /** Human-readable room name (from ZoneName on the coordinator member). */
  name: string;
  /** Coordinator UUID for this group. */
  coordinatorUuid: string;
  /** All member UUIDs in this group (includes coordinator + bonded RF satellite). */
  memberUuids: string[];
  /** Whether this room is its own group coordinator (always true in the current setup). */
  isCoordinator: boolean;
  /** Master volume 0-100 from the coordinator device. */
  volume: number;
  /** Whether the coordinator device is muted. */
  muted: boolean;
  /** Transport state string from the coordinator: "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED". */
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

  // Exclude any phantom group whose coordinator is the bonded RF satellite so we never show
  // more than 5 rooms regardless of topology changes.
  const visibleGroups = groups.filter((g) => g.coordinatorUuid !== DESK_RF_BONDED_UUID);

  const rooms = await Promise.all(
    visibleGroups.map(async (group): Promise<SoundSystemRoom> => {
      const coordinatorMember = group.members.find((m) => m.uuid === group.coordinatorUuid);
      if (!coordinatorMember) {
        throw new Error(
          `getSoundSystem: no coordinator member found in group ${group.coordinatorUuid}`,
        );
      }

      const deviceClient = new SonosClient(coordinatorMember.ip);

      // Fetch volume, mute, and transport state in parallel from the coordinator.
      // Transport state for a Sonos group is authoritative on the coordinator only.
      const [volume, muted, transportInfo] = await Promise.all([
        deviceClient.getVolume(),
        deviceClient.getMute(),
        deviceClient.getTransportInfo(),
      ]);

      return {
        name: coordinatorMember.zoneName,
        coordinatorUuid: group.coordinatorUuid,
        memberUuids: group.members.map((m) => m.uuid),
        isCoordinator: true,
        volume,
        muted,
        transportState: transportInfo.state,
        sourceLabel: null,
      };
    }),
  );

  return { rooms };
}
