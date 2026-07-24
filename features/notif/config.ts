/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick(
  "DATABASE_URL",
  "APNS_KEY_ID",
  "APNS_TEAM_ID",
  "APNS_KEY_CONTENT",
  "APNS_BUNDLE_ID",
  "APNS_HOST",
);
