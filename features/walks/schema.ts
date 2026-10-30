import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const walks = pgTable(
  "walk",
  {
    id: text("id").primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    source: text("source")
      .$type<"iphone" | "ipad" | "web" | "unknown">()
      .notNull()
      .default("unknown"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // Tombstones retain idempotency keys and the state revision after deletion.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("walk_one_active_idx")
      .on(sql`(1)`)
      .where(sql`${t.endedAt} IS NULL AND ${t.deletedAt} IS NULL`),
    index("walk_history_idx")
      .on(t.startedAt.desc(), t.id.desc())
      .where(sql`${t.endedAt} IS NOT NULL AND ${t.deletedAt} IS NULL`),
    index("walk_updated_idx").on(t.updatedAt.desc()),
    check("walk_date_order", sql`${t.endedAt} IS NULL OR ${t.endedAt} >= ${t.startedAt}`),
    check("walk_source", sql`${t.source} IN ('iphone', 'ipad', 'web', 'unknown')`),
  ],
);
