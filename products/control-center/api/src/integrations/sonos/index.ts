/**
 * Raw Sonos UPnP/SOAP helper , talks to devices on :1400 with no cloud dependency.
 *
 * Design rules (www-51hf.4):
 *  - Every method THROWS SonosError on network failure, non-200 HTTP, or SOAP fault.
 *  - No constants, no fabricated data. If the device is unreachable, the caller sees an error.
 *  - XML is parsed with simple regex/string ops , no DOM parser dependency needed for these
 *    well-structured UPnP responses. The patterns are narrow and predictable.
 */

export { SonosClient } from "./client";
export { SonosError } from "./errors";
/** @public , consumed by the media router procedures in subsequent milestones */
export type {
  PositionInfo,
  SonosFavorite,
  TransportInfo,
  ZoneGroup,
  ZoneMember,
} from "./types";
