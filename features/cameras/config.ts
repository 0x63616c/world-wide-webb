import { ENV } from "@www/platform/env";

export const config = ENV.pick("HA_URL", "HA_TOKEN");
