// Drizzle schema. Backend agents add tables here.
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  place: text("place").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Device sync: backend owns device state; frontend reads merged (effective) state.
// Ported from evee device-state-sync pattern. Desired window is 5s for CC.

export interface DeviceLightState {
  on: boolean;
  brightness?: number;
}

export type DeviceStateValue = DeviceLightState;

export const deviceState = pgTable(
  "device_state",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    entityId: text("entity_id").notNull(),
    domain: text("domain").notNull(),
    label: text("label").notNull(),
    reportedState: jsonb("reported_state").$type<DeviceStateValue | null>(),
    reportedAtUtc: timestamp("reported_at_utc", { withTimezone: true }),
    reportedChangedAtUtc: timestamp("reported_changed_at_utc", { withTimezone: true }),
    desiredState: jsonb("desired_state").$type<DeviceStateValue | null>(),
    desiredAtUtc: timestamp("desired_at_utc", { withTimezone: true }),
    desiredUntilUtc: timestamp("desired_until_utc", { withTimezone: true }),
    available: boolean("available").notNull().default(false),
    createdAtUtc: timestamp("created_at_utc", { withTimezone: true }).notNull().defaultNow(),
    updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("device_state_entity_id_idx").on(t.entityId),
    index("device_state_kind_idx").on(t.kind),
  ],
);

export const deviceCommands = pgTable(
  "device_commands",
  {
    id: serial("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => deviceState.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    args: jsonb("args").notNull(),
    status: text("status").notNull(),
    issuedAtUtc: timestamp("issued_at_utc", { withTimezone: true }).notNull().defaultNow(),
    sentAtUtc: timestamp("sent_at_utc", { withTimezone: true }),
    confirmedAtUtc: timestamp("confirmed_at_utc", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [
    index("device_commands_device_id_issued_idx").on(t.deviceId, t.issuedAtUtc),
    index("device_commands_status_idx").on(t.status),
  ],
);

export const integrationSyncStatus = pgTable("integration_sync_status", {
  integrationId: text("integration_id").primaryKey(),
  lastPolledAtUtc: timestamp("last_polled_at_utc", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});
