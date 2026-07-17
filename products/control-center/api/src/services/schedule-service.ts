import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../db/index";
import type { ScheduleTrigger } from "../db/schema";
import { lightSchedules, weatherDailyReading } from "../db/schema";

// ─── Zod shape (authoritative validation for the trpc router) ─────────────────

export const scheduleTriggerSchema = z.union([
  z.object({ type: z.literal("fixed"), time: z.string().regex(/^\d{2}:\d{2}$/) }),
  z.object({
    type: z.literal("sun"),
    event: z.enum(["sunrise", "sunset"]),
    offsetMin: z.number().int().min(-720).max(720),
  }),
]);

export const scheduleActionSchema = z.object({
  on: z.boolean(),
  scene: z.enum(["white", "mood", "red", "blue"]).optional(),
  brightness: z.number().int().min(0).max(100).optional(),
  fadeMinutes: z.number().int().min(0).max(720).optional(),
});

export const scheduleInputSchema = z.object({
  name: z.string().min(1).max(60),
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).min(1),
  trigger: scheduleTriggerSchema,
  action: scheduleActionSchema,
  targetIds: z.array(z.string()).min(1),
});
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export type Schedule = typeof lightSchedules.$inferSelect;

export interface SunTimes {
  sunriseIso: string | null;
  sunsetIso: string | null;
}

// ─── trigger resolution (pure) ────────────────────────────────────────────────

/** Parse "2026-07-17T05:50" as local wall-clock (no tz). Null on malformed input. */
function isoLocalToDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0);
}

/**
 * The wall-clock fire time for the local day containing `dayStart` (that day's
 * midnight). Fixed → that day at HH:MM. Sun → the day's sunrise/sunset ISO +
 * offsetMin. Returns null when a sun trigger has no data for the day (caller skips
 * it — never invent a time).
 */
export function resolveTriggerTime(
  trigger: ScheduleTrigger,
  dayStart: Date,
  sun: SunTimes,
): Date | null {
  if (trigger.type === "fixed") {
    const [h, min] = trigger.time.split(":").map(Number);
    return new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), h, min, 0);
  }
  const iso = trigger.event === "sunrise" ? sun.sunriseIso : sun.sunsetIso;
  if (!iso) return null;
  const base = isoLocalToDate(iso);
  if (!base) return null;
  return new Date(base.getTime() + trigger.offsetMin * 60_000);
}

// ─── edge-trigger decision (pure) ─────────────────────────────────────────────

export interface ScheduleRow {
  id: string;
  enabled: boolean;
  days: number[];
  trigger: ScheduleTrigger;
  lastFiredDate: string | null;
}

/** Local "YYYY-MM-DD" for a Date (used as the once-per-day fire guard). */
export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Pure edge-trigger decision: which schedule ids should fire at `now`. A schedule
 * fires when enabled, today's weekday is selected, its resolved trigger time has
 * passed, and it hasn't already fired today (lastFiredDate guard). RNG-free →
 * fully testable, mirrors partyColorsAtTick.
 */
export function decideScheduleFires(now: Date, schedules: ScheduleRow[], sun: SunTimes): string[] {
  const today = localDateKey(now);
  const weekday = now.getDay();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const out: string[] = [];
  for (const s of schedules) {
    if (!s.enabled) continue;
    if (!s.days.includes(weekday)) continue;
    if (s.lastFiredDate === today) continue;
    const fireAt = resolveTriggerTime(s.trigger, dayStart, sun);
    if (!fireAt) continue;
    if (now.getTime() >= fireAt.getTime()) out.push(s.id);
  }
  return out;
}

// ─── sun times (shared by runner + router) ────────────────────────────────────

/** Today's sun times from the latest weather_daily_reading row (null when absent). */
export async function getTodaySun(today: string): Promise<SunTimes> {
  try {
    const rows = await db
      .select({
        sunriseIso: weatherDailyReading.sunriseIso,
        sunsetIso: weatherDailyReading.sunsetIso,
      })
      .from(weatherDailyReading)
      .where(eq(weatherDailyReading.targetDate, today))
      .orderBy(weatherDailyReading.recordedAt);
    const latest = rows[rows.length - 1];
    return { sunriseIso: latest?.sunriseIso ?? null, sunsetIso: latest?.sunsetIso ?? null };
  } catch {
    return { sunriseIso: null, sunsetIso: null };
  }
}

// ─── CRUD store ───────────────────────────────────────────────────────────────

/** New schedule id, prefix + short random (repo IDs default to prefix_<id>). */
export function newScheduleId(): string {
  return `sched_${crypto.randomUUID().slice(0, 8)}`;
}

export async function listSchedules(): Promise<Schedule[]> {
  return db.select().from(lightSchedules).orderBy(lightSchedules.name);
}

export async function createSchedule(input: ScheduleInput): Promise<Schedule> {
  const value = scheduleInputSchema.parse(input);
  const now = new Date();
  const [row] = await db
    .insert(lightSchedules)
    .values({ id: newScheduleId(), ...value, createdAtUtc: now, updatedAtUtc: now })
    .returning();
  getLogger().info({ id: row.id, name: row.name }, "schedule created");
  return row;
}

export async function updateSchedule(id: string, patch: Partial<ScheduleInput>): Promise<Schedule> {
  const value = scheduleInputSchema.partial().parse(patch);
  const [row] = await db
    .update(lightSchedules)
    .set({ ...value, updatedAtUtc: new Date() })
    .where(eq(lightSchedules.id, id))
    .returning();
  return row;
}

export async function deleteSchedule(id: string): Promise<void> {
  await db.delete(lightSchedules).where(eq(lightSchedules.id, id));
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<Schedule> {
  const [row] = await db
    .update(lightSchedules)
    .set({ enabled, updatedAtUtc: new Date() })
    .where(eq(lightSchedules.id, id))
    .returning();
  return row;
}
