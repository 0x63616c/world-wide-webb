/**
 * The events feature's own Drizzle table (Track C, fold). Moved verbatim from
 * apps/api/src/db/schema.ts. Same SQL table name (`events`), same columns —
 * no DDL change from the fold.
 */
import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  place: text("place").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
