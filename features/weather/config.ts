/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("DATABASE_URL", "HOME_LAT", "HOME_LON");

/**
 * The cosmetic city label the Weather Now tile shows beside the temperature.
 *
 * This was `HOME_PLACE_NAME`, delivered from the secret rail. The
 * `homeLocation.placeName` secret went with The Simplification §8, so the label
 * is a plain constant now — deliberately PUBLIC and city-level, never an
 * address, exactly like `HOME_LABEL` in apps/web/src/config/home.ts. The real
 * coordinates stay on the secret rail as HOME_LAT/HOME_LON.
 */
export const HOME_PLACE_LABEL = "Los Angeles";
