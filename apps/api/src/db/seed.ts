/**
 * Seeds the events table with upcoming concert data.
 * Run with: bun run apps/api/src/db/seed.ts
 */
import { db, pool } from "./index";
import { events } from "./schema";

const seedEvents = [
  {
    name: "Gorgon City",
    place: "Sound Nightclub",
    // ~3 days from a reference date; use a realistic near-future date
    date: new Date("2026-06-15T22:00:00-07:00"),
  },
  {
    name: "Chris Lake",
    place: "Shrine Expo Hall",
    date: new Date("2026-06-22T21:00:00-07:00"),
  },
  {
    name: "Florida 2026",
    place: "Miami",
    date: new Date("2026-07-13T20:00:00-05:00"),
  },
  {
    name: "John Summit",
    place: "Hollywood Palladium",
    date: new Date("2026-08-05T21:00:00-07:00"),
  },
];

async function seed() {
  console.warn("Seeding events...");
  await db.delete(events);
  const inserted = await db.insert(events).values(seedEvents).returning();
  console.warn(`Inserted ${inserted.length} events.`);
  await pool.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
