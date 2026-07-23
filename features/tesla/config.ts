/**
 * The tesla feature's own config slice (Track C, Wave 2). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
    TESLA_ENTITY_PREFIX: z.string().default("evee"),
    HOME_LAT: z.coerce.number().default(34.0537),
    HOME_LON: z.coerce.number().default(-118.2428),
    HOME_PLACE_NAME: z.string().default("Home"),
    HOME_RADIUS_MILES: z.coerce.number().default(1),
  })
  .parse(process.env);
