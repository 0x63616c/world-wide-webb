/**
 * deriveSources , pure source-list derivation for the Groups modal (www-51hf).
 *
 * Turns the flat per-room `SoundSystemRoom[]` list (one row per physical player,
 * see sonos-sound-system-service.ts) into the small set of "sources" the Groups
 * modal actually renders: two hardware floor cards that are ALWAYS present
 * (Desk · Line-In, Living Room · TV) plus a dynamic "session" card for any other
 * group that's actually playing something (Spotify, AirPlay, etc.).
 *
 * Pure , no React, no tRPC runtime import (only a type-only import of the
 * router's output shape, which vitest/tsc elide entirely). Consumed by the
 * GroupsModalView / container (Tasks 6/7).
 */
import type { RouterOutputs } from "@/lib/trpc";
import { BEAM_UUID, DESK_LINE_IN_UUID } from "./sonos-constants";

export type SoundSystemRoom = RouterOutputs["media"]["soundSystem"]["rooms"][number];

// Duplicated from the service's ROOM_ORDER (products/control-center/api/src/services/
// sonos-sound-system-service.ts) , the web cannot import api source, so this stable
// display-order list is kept as a web constant. Keep the two in sync.
const ROOM_ORDER = ["Living Room", "Desk", "Bedroom", "Bathroom", "Kitchen"];

function roomRank(name: string): number {
  const i = ROOM_ORDER.indexOf(name);
  return i === -1 ? ROOM_ORDER.length : i;
}

export type SourceKind = "line-in" | "tv" | "spotify" | "airplay" | "other" | "idle";

export interface GroupSource {
  id: string; // "src_desk_linein" | "src_tv" | `src_session_${coordinatorUuid}`
  anchorUuid: string; // coordinator uuid speakers join (x-rincon target)
  anchorIp: string;
  roomName: string; // real zone name ("Desk", "Living Room", "Bedroom")
  label: string; // "Desk · Line-In", "Living Room · TV", "Bedroom · Spotify"
  kind: SourceKind;
  playing: boolean; // group transportState === "PLAYING"
  trackLine: string | null; // "Artist — Title" | app label | null (never fabricated)
  isSession: boolean; // dynamic card (SESSION badge)
  colorVar: string; // "--acc" | "--amber" | "--teal" | next in SESSION_HUES
}

// v1: sessions cycle this list (one live session is the realistic case; add hues
// to tokens.css when needed). --teal does not exist in tokens.css yet , add
// `--teal: #6fdbcb;` next to --amber.
export const SESSION_HUES = ["--teal"] as const;

function trackLineFor(room: SoundSystemRoom): string | null {
  if (room.trackArtist && room.trackTitle) return `${room.trackArtist} — ${room.trackTitle}`;
  if (room.trackTitle) return room.trackTitle;
  return null;
}

function labelFor(roomName: string, sourceLabel: string | null): string {
  return sourceLabel ? `${roomName} · ${sourceLabel}` : roomName;
}

/** True when the room found at `anchorUuid` is actually playing `expectedKind`. */
function anchorIsPlaying(
  rooms: SoundSystemRoom[],
  anchorUuid: string,
  expectedKind: SourceKind,
): boolean {
  const anchor = rooms.find((r) => r.uuid === anchorUuid);
  return (
    anchor != null && anchor.sourceKind === expectedKind && anchor.transportState === "PLAYING"
  );
}

/**
 * Pure derivation: hardware floor cards (Desk · Line-In, Living Room · TV) are
 * always present; session cards are added per group coordinator whose
 * sourceKind isn't "idle" and whose (uuid, kind) isn't one of the two hardware
 * cards (dedup , a coordinator playing its own hardware source doesn't also
 * spawn a session card). Ordered [desk, tv, ...sessions by ROOM_ORDER rank,
 * ties alphabetical].
 */
export function deriveSources(rooms: SoundSystemRoom[]): GroupSource[] {
  const desk = rooms.find((r) => r.uuid === DESK_LINE_IN_UUID);
  const tv = rooms.find((r) => r.uuid === BEAM_UUID);

  const deskPlaying = anchorIsPlaying(rooms, DESK_LINE_IN_UUID, "line-in");
  const tvPlaying = anchorIsPlaying(rooms, BEAM_UUID, "tv");

  const deskSource: GroupSource = {
    id: "src_desk_linein",
    anchorUuid: DESK_LINE_IN_UUID,
    anchorIp: desk?.deviceIp ?? "",
    roomName: desk?.name ?? "Desk",
    label: labelFor(desk?.name ?? "Desk", "Line-In"),
    kind: "line-in",
    playing: deskPlaying,
    trackLine: deskPlaying && desk ? trackLineFor(desk) : null,
    isSession: false,
    colorVar: "--acc",
  };

  const tvSource: GroupSource = {
    id: "src_tv",
    anchorUuid: BEAM_UUID,
    anchorIp: tv?.deviceIp ?? "",
    roomName: tv?.name ?? "Living Room",
    label: labelFor(tv?.name ?? "Living Room", "TV"),
    kind: "tv",
    playing: tvPlaying,
    trackLine: tvPlaying && tv ? trackLineFor(tv) : null,
    isSession: false,
    colorVar: "--amber",
  };

  // Session candidates: one per distinct live coordinatorUuid, sourced from that
  // coordinator's own room record (the coordinator carries the group's values).
  const coordinatorUuids = new Set(rooms.map((r) => r.coordinatorUuid));
  const sessionCandidates: SoundSystemRoom[] = [];
  for (const coordUuid of coordinatorUuids) {
    const coord = rooms.find((r) => r.uuid === coordUuid);
    if (!coord) continue;
    if (coord.sourceKind === "idle") continue;
    const isDeskHardware = coord.uuid === DESK_LINE_IN_UUID && coord.sourceKind === "line-in";
    const isTvHardware = coord.uuid === BEAM_UUID && coord.sourceKind === "tv";
    if (isDeskHardware || isTvHardware) continue;
    // Post-leave residue: a speaker that just left a group can retain a stale
    // source URI (e.g. line-in pointed at its own uuid) while its transport
    // sits STOPPED. That's not a live session , skip it. A paused session
    // (PAUSED_PLAYBACK) still counts as live and stays.
    if (coord.transportState === "STOPPED") continue;
    sessionCandidates.push(coord);
  }

  sessionCandidates.sort((a, b) => {
    const rankDiff = roomRank(a.name) - roomRank(b.name);
    if (rankDiff !== 0) return rankDiff;
    return a.name.localeCompare(b.name);
  });

  const sessionSources: GroupSource[] = sessionCandidates.map((coord, i) => ({
    id: `src_session_${coord.uuid}`,
    anchorUuid: coord.uuid,
    anchorIp: coord.deviceIp,
    roomName: coord.name,
    label: labelFor(coord.name, coord.sourceLabel),
    kind: coord.sourceKind,
    playing: coord.transportState === "PLAYING",
    trackLine: trackLineFor(coord),
    isSession: true,
    colorVar: SESSION_HUES[i % SESSION_HUES.length],
  }));

  return [deskSource, tvSource, ...sessionSources];
}

/**
 * Maps each room uuid to the GroupSource.id it should follow, or null when the
 * room's group is idle. A room matches a source when the source's anchorUuid
 * equals the room's coordinatorUuid AND that source is live (playing) , except
 * the two hardware cards also match while stopped (membership is patch-bay
 * wiring/topology, not playback , a speaker joined to the stopped Desk group
 * is still "with" Desk).
 *
 * A single anchorUuid can have more than one matching source , e.g. the Desk
 * group playing Spotify has both the (stopped) "src_desk_linein" hardware card
 * and the live "src_session_<uuid>" card sharing anchorUuid. All anchor-matching
 * sources are scanned so the live session wins over the stopped hardware card.
 */
export function membershipByUuid(rooms: SoundSystemRoom[]): Record<string, string | null> {
  const sources = deriveSources(rooms);
  const result: Record<string, string | null> = {};

  for (const room of rooms) {
    let matched: string | null = null;
    let matchedHardware: string | null = null;
    for (const source of sources) {
      if (source.anchorUuid !== room.coordinatorUuid) continue;
      if (source.playing) {
        matched = source.id;
        break;
      }
      const isHardware = source.id === "src_desk_linein" || source.id === "src_tv";
      if (isHardware && matchedHardware === null) {
        matchedHardware = source.id;
      }
    }
    result[room.uuid] = matched ?? matchedHardware;
  }

  return result;
}
