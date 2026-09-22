/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("DATABASE_URL", "HA_URL", "HA_TOKEN");
