import { z } from "zod";

export const cameraIdSchema = z
  .string()
  .regex(/^camera\.[a-z0-9_]+$/)
  .max(255);
export const cameraSchema = z.object({
  id: cameraIdSchema,
  name: z.string(),
  state: z.string(),
});
