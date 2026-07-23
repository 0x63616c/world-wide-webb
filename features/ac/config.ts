/**
 * The ac (climate) feature's own config slice (Track C, F-devstate ac slice). A
 * folded feature owns its configuration surface: it reads the already-hydrated
 * `process.env` (apps/api's env.ts runs the docker-secret hydration + writes
 * DATABASE_URL back onto process.env before any feature is imported) and
 * validates just the keys this feature needs. It never reaches into apps/api's
 * `env`.
 *
 * Every key carries the SAME default as apps/api/src/env.ts so importing the
 * feature — in the api runtime, in tests, and in the apps:gen/apps:check
 * codegen that imports the branded facets — never throws before real values
 * are wired. A missing/misconfigured value fails on first query, not import.
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
    CLIMATE_ENTITY_ID: z.string().default("climate.home"),
    TESLA_ENTITY_PREFIX: z.string().default("evee"),
  })
  .parse(process.env);
