/**
 * The felogs feature's own config slice (Track C, Wave 7). A folded feature
 * owns its configuration surface: it reads the already-hydrated
 * `process.env` (apps/api's env.ts runs the docker-secret hydration + writes
 * DATABASE_URL back onto process.env before any feature is imported) and
 * validates just the keys this feature needs. It never reaches into apps/api's
 * `env`.
 *
 * DATABASE_URL carries a safe default (mirrors apps/api's local dev default)
 * so importing the feature — in the api runtime, in the tests, and in the
 * `apps:gen`/`apps:check` codegen that imports the branded facets — never
 * throws before a real value is wired. A missing DATABASE_URL fails on first
 * query, not on import.
 */
import { z } from "zod";

export const config = z
  .object({
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
  })
  .parse(process.env);
