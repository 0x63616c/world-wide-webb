/**
 * apps/api-side barrel + singleton for the UniFi client. The client itself
 * lives in `@www/core` (env-free, mandatory-args); this file is the thin
 * env-aware wrapper that constructs the shared singleton and re-exports every
 * name existing consumers import from `../integrations/unifi` (network-service,
 * portal.ts, portal-service.ts, tests). `portal.ts` still imports `unifi`
 * directly from here until it moves in Slice 5 , do not remove that export.
 */
import { env } from "../env";

/** @public , re-exported barrel surface for the Network tile's stats client;
 * no internal caller imports the standalone types yet (used via UnifiClient). */
export type {
  UnifiClient,
  UnifiGuestAuthorization,
  UnifiGuestClient,
  UnifiHealth,
  UnifiStatsClient,
  UnifiTrafficBucket,
} from "@www/core";
/** @public , caught by the captive-portal service (www-q002.9); re-exported
 * for consumers of this barrel, no internal caller yet. */
export { createUnifiClient, UnifiError, UnifiStatus } from "@www/core";

import { createUnifiClient } from "@www/core";

export const unifi = createUnifiClient({
  apiKey: env.UNIFI_API_KEY,
  baseUrl: env.UNIFI_CONTROLLER_URL,
  siteId: env.UNIFI_SITE_ID,
});
