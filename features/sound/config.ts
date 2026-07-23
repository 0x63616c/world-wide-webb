/**
 * The sound (Sonos + Spotify + media-ingest) feature's own config slice (Track
 * C, Wave 6). Reads the already-hydrated `process.env` and validates just the
 * keys this feature needs, same defaults as apps/api/src/env.ts so import
 * never throws before real values are wired (mirror features/ac/config.ts).
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
    SPOTIFY_CLIENT_ID: z.string().default(""),
    SPOTIFY_CLIENT_SECRET: z.string().default(""),
    SPOTIFY_REFRESH_TOKEN: z.string().default(""),
  })
  .parse(process.env);
