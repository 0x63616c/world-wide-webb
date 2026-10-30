import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgSequence,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const notificationRevision = pgSequence("notification_revision");
export const notifications = pgTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    source_module: text("source_module").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    deep_link: text("deep_link").notNull(),
    priority: text("priority").notNull(),
    dedupe_key: text("dedupe_key"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    read_at: timestamp("read_at", { withTimezone: true }),
    dismissed_at: timestamp("dismissed_at", { withTimezone: true }),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`nextval('notification_revision')`),
  },
  (t) => [
    uniqueIndex("notifications_active_dedupe")
      .on(t.source_module, t.dedupe_key)
      .where(sql`${t.dismissed_at} IS NULL`),
    index("notifications_revision_idx").on(t.revision),
    index("notifications_retention_idx").on(t.dismissed_at),
    check("notifications_priority", sql`${t.priority} IN ('low', 'normal', 'high', 'critical')`),
  ],
);
