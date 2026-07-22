/**
 * Sonos favorites service (www-51hf.11).
 *
 * Fetches the Sonos Favorites list (ContentDirectory FV:2) from a single
 * device IP. Any Sonos device can serve the favorites catalog , we reuse the
 * topology anchor (Living Room Beam) so there is no discovery dependency.
 *
 * Design rules:
 *  - THROW on any SonosClient failure (never return fabricated data, A3/A13).
 *  - No caching , favorites are read fresh every call (user may have edited them).
 */

import type { SonosFavorite } from "../integrations/sonos";
import { SonosClient } from "../integrations/sonos";

// Same LAN IP used by the sound-system service; any coordinator serves ContentDirectory.
const FAVORITES_ANCHOR_IP = "192.168.0.193";

/**
 * Returns the list of Sonos Favorites from Browse FV:2.
 * THROWS on any SonosClient error (network, SOAP, HTTP >= 4xx).
 */
export async function getSonosFavorites(): Promise<SonosFavorite[]> {
  const client = new SonosClient(FAVORITES_ANCHOR_IP);
  return client.browseFavorites();
}
