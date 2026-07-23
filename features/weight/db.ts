/**
 * The weight feature's own Postgres handle (Track C, Wave 2). The feature
 * builds its db from its own {@link config} slice and the shared `createPool`
 * substrate in `@www/core`, rather than importing apps/api's db singleton. The
 * pool is lazy (no connection until first query), so importing this module — and
 * therefore the branded facets that use it (api.ts) — is side-effect free
 * enough for the codegen to load.
 *
 * The weight-ingest interval cycle (apps/api/src/services/weight-service.ts)
 * keeps using apps/api's own shared pool for its inserts — this pool is only
 * for the api.ts/service.ts query surface. Two pools against the same
 * weight_measurement table from the same process tree, matching the
 * guest-wifi precedent (its purge.ts also straddles both pools).
 */
import { createPool } from "@www/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { config } from "./config";
import * as schema from "./schema";

// Not exported: unlike guest-wifi's pool (closed explicitly by purge.ts on
// shutdown), nothing outside this module needs to reach the raw pool today.
const pool = createPool(config.DATABASE_URL);
export const db = drizzle(pool, { schema });
