/**
 * The deploys feature's own config slice (Track C, Wave 2). Reads the already-
 * hydrated process.env (apps/api's env.ts runs docker-secret hydration before
 * any feature is imported) and validates just the keys this feature needs.
 * Never reaches into apps/api's `env`. Safe defaults so importing the branded
 * facets during codegen never throws before real values are wired.
 */
import { z } from "zod";

export const config = z
  .object({
    GITHUB_ACTIONS_TOKEN: z.string().default(""),
    GITHUB_REPO: z.string().default("0x63616c/world-wide-webb"),
    DATABASE_URL: z.string().url().default("postgresql://cc:cc@localhost:5432/controlcenter"),
  })
  .parse(process.env);
