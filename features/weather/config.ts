/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("DATABASE_URL", "HOME_LAT", "HOME_LON", "HOME_PLACE_NAME");
