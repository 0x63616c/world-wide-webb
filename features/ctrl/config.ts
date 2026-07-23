/**
 * The ctrl feature's own config slice (Track C, Wave 7). A folded feature owns
 * its configuration surface: it reads the already-hydrated `process.env`
 * (apps/api's env.ts runs the docker-secret hydration + writes DATABASE_URL back
 * onto process.env before any feature is imported) and validates just the keys
 * this feature needs. It never reaches into apps/api's `env`.
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    HA_URL: z.string().url().default("http://homeassistant.local:8123"),
    HA_TOKEN: z.string().default(""),
  })
  .parse(process.env);
