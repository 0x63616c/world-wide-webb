/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick(
  "WIFI_SSID",
  "WIFI_GUEST_SSID",
  "WIFI_PASSWORD",
  "UNIFI_API_KEY",
  "UNIFI_CONTROLLER_URL",
  "UNIFI_SITE_ID",
);
