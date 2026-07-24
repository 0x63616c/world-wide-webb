/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick(
  "HA_URL",
  "HA_TOKEN",
  "GO2RTC_URL",
  "CAMERA_STREAM_NAME",
  "CAMERA_LABEL",
);
