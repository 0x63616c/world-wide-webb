/**
 * Types for the raw Sonos UPnP/SOAP helper (CC-51hf.4).
 */

/** A single ZoneGroupMember parsed from GetZoneGroupState topology XML. */
export interface ZoneMember {
  uuid: string;
  zoneName: string;
  /** IP extracted from the Location URL, e.g. "192.168.0.193". */
  ip: string;
}

/** A parsed Sonos zone group (coordinator + its members). */
export interface ZoneGroup {
  /** UUID of the group coordinator device. */
  coordinatorUuid: string;
  /** All members including the coordinator itself. */
  members: ZoneMember[];
}

/** A single item from the FV:2 favorites ContentDirectory browse. */
export interface SonosFavorite {
  /** Display title. */
  title: string;
  /** Playback URI (passed back to SetAVTransportURI). */
  uri: string;
  /** Album art URI, or null if absent. */
  albumArtUri: string | null;
}

/** Result of GetTransportInfo for a device. */
export interface TransportInfo {
  /** "PLAYING" | "PAUSED_PLAYBACK" | "STOPPED" (or any raw UPnP value). */
  state: string;
}

/** Result of GetPositionInfo. Nulls indicate NOT_IMPLEMENTED (line-in/TV sources). */
export interface PositionInfo {
  trackTitle: string | null;
  trackArtist: string | null;
  albumArtUri: string | null;
  /** Total duration in seconds, or null. */
  durationSeconds: number | null;
  /** Current position in seconds, or null. */
  positionSeconds: number | null;
}
