import { z } from "zod";
export const appIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9_-]*$/);
export const releaseInputSchema = z
  .object({ app: appIdSchema, build: z.number().int().positive().max(2147483647) })
  .strict();
