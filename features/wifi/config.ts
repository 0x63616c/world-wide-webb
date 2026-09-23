/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("WIFI_GUEST_SSID", "WIFI_GUEST_PASSWORD");
