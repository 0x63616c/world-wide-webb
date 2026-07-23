/**
 * The felogs feature's own Postgres handle (Track C, Wave 7). The feature
 * builds its db from its own {@link config} slice and the shared `createPool`
 * substrate in `@www/core`, rather than importing apps/api's db singleton. The
 * pool is lazy (no connection until first query), so importing this module — and
 * therefore the branded facets that use it (api.ts) — is side-effect free
 * enough for the codegen to load.
 *
 * `interaction-session-service` (apps/api) keeps using apps/api's own shared
 * pool with the imported `frontendLog` table object — two pools against the
 * same physical `frontend_log` table from the same process tree, matching the
 * weight precedent (ingest pool vs api pool).
 */
import { createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";

// Not exported: nothing outside this module needs to reach the raw pool today.
const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
