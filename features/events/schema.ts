import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { AlarmInput } from "./contract";

export const alarms = pgTable(
  "alarm",
  {
    id: text("id").primaryKey(),
    definition: jsonb("definition").$type<AlarmInput>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    nextFireAt: timestamp("next_fire_at", { withTimezone: true }),
    requestKey: text("request_key"),
    requestHash: text("request_hash"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("alarm_due_idx").on(table.enabled, table.nextFireAt),
    uniqueIndex("alarm_request_key_idx").on(table.requestKey),
  ],
);

/** One durable occurrence per scheduled instant, independent of delivery attempts.
 * Snapshots keep snooze, lights and label stable if a definition is edited. */
export const alarmRings = pgTable(
  "alarm_ring",
  {
    id: text("id").primaryKey(),
    alarmId: text("alarm_id")
      .notNull()
      .references(() => alarms.id, { onDelete: "cascade" }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    label: text("label").notNull(),
    status: text("status").$type<"ringing" | "snoozed" | "stopped" | "missed">().notNull(),
    version: integer("version").notNull().default(0),
    ringAt: timestamp("ring_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    snoozeMinutes: integer("snooze_minutes").notNull(),
    lightTarget: text("light_target").notNull(),
    lightsDeliveredAt: timestamp("lights_delivered_at", { withTimezone: true }),
    lightsRetryAt: timestamp("lights_retry_at", { withTimezone: true }).notNull(),
    lightsAttempts: integer("lights_attempts").notNull().default(0),
  },
  (table) => [
    uniqueIndex("alarm_ring_occurrence_idx").on(table.alarmId, table.scheduledAt),
    index("alarm_ring_pending_idx").on(table.status, table.ringAt),
  ],
);
