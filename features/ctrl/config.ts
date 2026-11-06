/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick(
  "DATABASE_URL",
  "HA_URL",
  "HA_TOKEN",
  "BEDROOM_SWITCH_INPUT_ENABLED",
  "BEDROOM_SWITCH_INPUT_VERIFIED",
  "BEDROOM_SWITCH_INPUT_ENTITY_ID",
);
