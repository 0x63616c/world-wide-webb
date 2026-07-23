/**
 * The guest-wifi feature's own Postgres handle (Track C, C7 — D1). The feature
 * builds its db from its own {@link config} slice and the shared `createPool`
 * substrate in `@www/core`, rather than importing apps/api's db singleton. The
 * pool is lazy (no connection until first query), so importing this module — and
 * therefore the branded facets that use it (api.ts, jobs.ts) — is side-effect
 * free enough for the codegen to load.
 */
import { createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";

export const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
