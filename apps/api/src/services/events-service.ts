import { asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";

export interface EventRow {
  name: string;
  place: string;
  days: number;
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

/** Placeholder events shown when DB is empty or unreachable. */
export const PLACEHOLDER_EVENTS: EventRow[] = [
  { name: "Gorgon City", place: "Sound Nightclub", days: 3 },
  { name: "Chris Lake", place: "Shrine Expo Hall", days: 10 },
  { name: "Florida 2026", place: "Miami", days: 31 },
  { name: "John Summit", place: "Hollywood Palladium", days: 54 },
];

export async function listEvents(
  db: NodePgDatabase<typeof schema>,
  now: Date = new Date(),
): Promise<EventRow[]> {
  try {
    const rows = await db.select().from(schema.events).orderBy(asc(schema.events.date));

    if (rows.length === 0) {
      return PLACEHOLDER_EVENTS;
    }

    return rows.map((r) => ({
      name: r.name,
      place: r.place,
      days: daysUntil(r.date, now),
    }));
  } catch {
    // DB unreachable — degrade gracefully to placeholder data.
    return PLACEHOLDER_EVENTS;
  }
}
