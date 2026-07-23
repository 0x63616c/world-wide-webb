/**
 * apps/api-side barrel for the UniFi client. The client itself lives in
 * `@www/core` (env-free, mandatory-args); this file just re-exports every name
 * remaining apps/api consumers import from `../integrations/unifi` (tests).
 * network-service.ts and portal.ts have both folded into features/* (Track C),
 * each building its own client from its own config slice — no apps/api caller
 * builds a shared singleton anymore.
 */

/** @public , re-exported barrel surface; no internal caller imports the
 * standalone types yet (used via UnifiClient). */
export type {
  UnifiClient,
  UnifiGuestAuthorization,
  UnifiGuestClient,
  UnifiHealth,
  UnifiStatsClient,
  UnifiTrafficBucket,
} from "@www/core";
export { createUnifiClient } from "@www/core";
