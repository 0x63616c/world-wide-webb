import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
export const latestReleases = pgTable(
  "latest_release",
  {
    app: text("app").primaryKey(),
    build: integer("build").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("latest_release_positive_build", sql`${table.build} > 0`)],
);
