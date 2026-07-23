import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Persistent lamp mode, a SINGLETON row (id = LAMP_MODE_SINGLETON_ID). Holds the
// active animated lamp mode that can't be inferred from a color snapshot, so it
// must be durable: the worker reconciles it (start/stop the party engine) and
// re-arms after a restart. `mode` is 'none' | 'party' (LampMode); `speed` is
// 'slow' | 'medium' | 'fast' (LampModeSpeed) and only meaningful for animated
// modes. Modeled on integration_sync_status's keyed-singleton shape (www-7d5b.3.2).
export const LAMP_MODE_SINGLETON_ID = "singleton";

export const lampMode = pgTable("lamp_mode", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().default("none"),
  speed: text("speed"),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
