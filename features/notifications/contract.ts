import { z } from "zod";

export const notificationInputSchema = z.object({
  source_module: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  title: z.string().trim().min(1).max(200),
  body: z.string().max(4000),
  deep_link: z
    .string()
    .max(512)
    .regex(/^module\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/),
  priority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  dedupe_key: z.string().min(1).max(200).nullable().optional().default(null),
});
export const cursorSchema = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,18})$/)
  .refine((value) => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= 9223372036854775807n);
export const notificationListSchema = z.object({
  since: cursorSchema.optional(),
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
export const notificationIdSchema = z.object({ id: z.string().regex(/^ntf_[a-z0-9]+$/) });
/** @public Server-side input accepted by createNotification(). */
export type NotificationInput = z.input<typeof notificationInputSchema>;
