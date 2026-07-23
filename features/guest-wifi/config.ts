/**
 * The guest-wifi feature's own config slice (Track C, C7 — D1). A folded feature
 * owns its configuration surface: it reads the already-hydrated `process.env`
 * (apps/api's env.ts runs the docker-secret hydration + writes DATABASE_URL back
 * onto process.env before any feature is imported) and validates just the keys
 * this feature needs. It never reaches into apps/api's `env`.
 *
 * Every field carries a safe default (DATABASE_URL mirrors apps/api's local dev
 * default) so importing the feature — in the api runtime, in the tests, and in
 * the `apps:gen`/`apps:check` codegen that imports the branded facets — never
 * throws before a real value is wired. A missing DATABASE_URL fails on first
 * query, not on import.
 */
import { z } from "zod";

export const config = z
  .object({
    WIFI_PASSWORD: z.string().default(""),
    UNIFI_API_KEY: z.string().default(""),
    UNIFI_CONTROLLER_URL: z.string().url().default("https://192.168.0.1"),
    UNIFI_SITE_ID: z.string().default("default"),
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
  })
  .parse(process.env);
