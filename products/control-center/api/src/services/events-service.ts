import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";

export interface EventRow {
  /** DB primary key, needed so the manage UI can target edit/delete. */
  id: number;
  name: string;
  place: string;
  days: number;
  /** ISO-8601 date string from the DB timestamptz, e.g. "2026-06-14T19:00:00-07:00". */
  date: string;
}

/** Fields a client may write when creating/updating an event. */
export interface EventInput {
  name: string;
  /** Optional location/venue; stored in the `place` column. Empty string when unset. */
  place: string;
  /** Event moment as an ISO-8601 string (client sends ISO, DB stores timestamptz). */
  date: string;
}

const TZ = "America/Los_Angeles";

/**
 * Pure helper: whole days from now until `target` in America/Los_Angeles.
 * Returns 0 if target is today or in the past.
 */
export function daysUntil(target: Date, now: Date = new Date()): number {
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);

  const parse = (s: string) => {
    const [m, d, y] = s.split("/").map(Number);
    return new Date(y, m - 1, d);
  };

  const todayLocal = parse(fmt(now));
  const targetLocal = parse(fmt(target));

  const diff = targetLocal.getTime() - todayLocal.getTime();
  return Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
}

/** Map a raw DB row to the API row shape (adds computed `days`, serializes date). */
function toEventRow(r: typeof schema.events.$inferSelect, now: Date): EventRow {
  return {
    id: r.id,
    name: r.name,
    place: r.place,
    days: daysUntil(r.date, now),
    date: r.date.toISOString(),
  };
}

export async function listEvents(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date(),
): Promise<EventRow[]> {
  const rows = await db.select().from(schema.events).orderBy(asc(schema.events.date));
  return rows.map((r) => toEventRow(r, now));
}

export async function createEvent(
  db: NodePgDatabase<typeof schema>,
  input: EventInput,
  now: Date = new Date(),
): Promise<EventRow> {
  const [row] = await db
    .insert(schema.events)
    .values({ name: input.name, place: input.place, date: new Date(input.date) })
    .returning();
  return toEventRow(row, now);
}

export async function updateEvent(
  db: NodePgDatabase<typeof schema>,
  id: number,
  input: EventInput,
  now: Date = new Date(),
): Promise<EventRow> {
  const [row] = await db
    .update(schema.events)
    .set({ name: input.name, place: input.place, date: new Date(input.date) })
    .where(eq(schema.events.id, id))
    .returning();
  if (!row) throw new Error(`event ${id} not found`);
  return toEventRow(row, now);
}

export async function deleteEvent(
  db: NodePgDatabase<typeof schema>,
  id: number,
): Promise<{ id: number }> {
  const [row] = await db
    .delete(schema.events)
    .where(eq(schema.events.id, id))
    .returning({ id: schema.events.id });
  if (!row) throw new Error(`event ${id} not found`);
  return { id: row.id };
}
