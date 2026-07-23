/**
 * The weather feature's own config slice (Track C, Wave 7). A folded feature
 * owns its configuration surface: it reads the already-hydrated
 * `process.env` (apps/api's env.ts runs the docker-secret hydration + writes
 * DATABASE_URL back onto process.env before any feature is imported) and
 * validates just the keys this feature needs. It never reaches into apps/api's
 * `env`.
 *
 * DATABASE_URL / HOME_LAT / HOME_LON / HOME_PLACE_NAME all carry safe defaults
 * (mirroring apps/api/src/env.ts's own defaults) so importing the feature — in
 * the api runtime, in the tests, and in the `apps:gen`/`apps:check` codegen
 * that imports the branded facets — never throws before real values are
 * wired. A missing/misconfigured value fails on first query or ingest cycle,
 * not on import.
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    HOME_LAT: z.coerce.number().default(34.0537),
    HOME_LON: z.coerce.number().default(-118.2428),
    HOME_PLACE_NAME: z.string().default("Home"),
  })
  .parse(process.env);
