/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick(
  "HA_URL",
  "HA_TOKEN",
  "TESLA_ENTITY_PREFIX",
  "HOME_LAT",
  "HOME_LON",
  "HOME_PLACE_NAME",
  "HOME_RADIUS_MILES",
);
