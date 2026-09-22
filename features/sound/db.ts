/**
 * The sound feature's own Postgres handle, built from its own {@link config}
 * slice and the shared `createFeatureDb` substrate in `@www/core` (same shape
 * as features/ctrl/db.ts). Only the calibration table lives here; every
 * speaker read/write still goes through Home Assistant.
 */
import { createFeatureDb } from "@www/core";
import { config } from "./config";
import * as soundSchema from "./schema";

export const db = createFeatureDb(config.DATABASE_URL, soundSchema);
