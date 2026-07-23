/**
 * The booth feature's own config slice (Track C, final tile fold). A folded
 * feature owns its configuration surface: it reads the already-hydrated
 * `process.env` (apps/api's env.ts runs the docker-secret hydration + writes
 * DATABASE_URL back onto process.env before any feature is imported) and
 * validates just the keys this feature needs. It never reaches into apps/api's
 * `env`.
 *
 * Defaults mirror apps/api/src/env.ts's own defaults (MEDIA_STORAGE_DIR
 * defaults to /mnt/media there) so importing the feature never throws before
 * real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    MEDIA_STORAGE_DIR: z.string().default("/mnt/media"),
  })
  .parse(process.env);
