/**
 * The ctrl feature's own Postgres handle (Track C, Wave 7). The feature builds
 * its db from its own {@link config} slice and the shared `createPool` +
 * `createPgDeviceStateStore` substrate in `@www/core`, rather than importing
 * apps/api's db singleton.
 */
import { createPgDeviceStateStore, createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";

const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
/** The prod device-state store for this feature (pg adapter over the feature db). */
export const deviceStateStore = createPgDeviceStateStore(db);
