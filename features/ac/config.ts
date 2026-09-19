/** Typed slice of the central env registry (`@www/platform/env`). */
import { ENV } from "@www/platform/env";

export const config = ENV.pick("DATABASE_URL", "HA_URL", "HA_TOKEN", "CLIMATE_ENTITY_ID");

/**
 * The car's Home Assistant entity prefix. The Tesla tile is gone, but the car
 * keeps reporting `climate.<prefix>_*` to HA, so the house climate list must
 * still exclude it or the A/C tile starts offering to heat the car. This was
 * `TESLA_ENTITY_PREFIX` in the env registry; it has been a constant since the
 * only other reader (features/tesla) was deleted. Matches the old default.
 */
export const TESLA_ENTITY_PREFIX = "evee";
