import { z } from "zod";

const timeZoneSchema = z
  .string()
  .max(100)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value }).format();
      return true;
    } catch {
      return false;
    }
  }, "Use an IANA time zone, such as America/Los_Angeles");

export const lightTargetSchema = z
  .string()
  .regex(
    /^(scene\.[a-z0-9_]+|(?:light|switch)\.[a-z0-9_]+(?:,(?:light|switch)\.[a-z0-9_]+)*)$/,
    "Use a scene entity or comma-separated light/switch entities",
  )
  .max(1000);

export const alarmInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80).default("Alarm"),
    time: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("07:00"),
    timeZone: timeZoneSchema,
    // Sunday = 0. Empty = the next occurrence of this wall-clock time, once.
    repeatDays: z
      .array(z.number().int().min(0).max(6))
      .max(7)
      .transform((days) => [...new Set(days)].sort())
      .default([]),
    // Shortcuts/App Intents can supply an exact date instead of a wall-clock time.
    at: z.iso.datetime({ offset: true }).nullable().default(null),
    snoozeMinutes: z.number().int().min(1).max(60).nullable().default(null),
    lightTarget: lightTargetSchema.nullable().default(null),
  })
  .refine((input) => !input.at || input.repeatDays.length === 0, {
    message: "An alarm with an exact date cannot repeat",
  });

export type AlarmInput = z.infer<typeof alarmInputSchema>;
// genId's default suffix is a full UUID (including hyphens); short IDs are
// accepted too, matching the platform helper's optional length form.
export const alarmIdSchema = z.string().regex(/^alm_[0-9a-z-]{1,36}$/);
export const occurrenceActionSchema = z.object({
  id: z.string().regex(/^alr_[0-9a-z-]{1,36}$/),
  // A stale panel must never snooze/stop a newer ring of this occurrence.
  version: z.number().int().nonnegative(),
});
