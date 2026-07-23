import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Per-integration liveness + failure-streak recorder (www-355t.9). One row per
 * integration id; `consecutiveFailures` is a real streak (reset on ok, +1 on
 * fail). github-actions keeps its own `github_poll_status` and does NOT use this.
 */
export const integrationSyncStatus = pgTable("integration_sync_status", {
  integrationId: text("integration_id").primaryKey(),
  lastPolledAtUtc: timestamp("last_polled_at_utc", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
