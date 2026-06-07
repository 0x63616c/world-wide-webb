// Zod schemas derived from Drizzle table definitions via drizzle-zod.
// Using createSelectSchema as the source of truth means field types stay in
// sync with the DB schema automatically — no hand-written shadow to drift.
//
// Router output schemas that need computed or renamed fields extend/override
// the base here; routers import from this file rather than re-declaring shapes.

import { createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import {
  deviceCommands,
  events,
  integrationSyncStatus,
  weatherDailyReading,
  weatherReading,
} from "./schema";

// ─── events ──────────────────────────────────────────────────────────────────

// events.list output: name + place from the table; date is serialised to an
// ISO string by the service layer (DB column is timestamptz); days is computed
// (calendar days until the event in America/Los_Angeles).
export const EventSelectSchema = createSelectSchema(events, {
  // Override: the service converts the DB Date to an ISO string before
  // returning so the router output carries a string, not a native Date.
  date: z.string(),
})
  .pick({ name: true, place: true, date: true })
  .extend({ days: z.number().int().nonnegative() });

// ─── device_commands ─────────────────────────────────────────────────────────

// Full select schema — used by any future device-commands router endpoint
// instead of a hand-written counterpart.
export const DeviceCommandSelectSchema = createSelectSchema(deviceCommands, {
  // jsonb args column carries unknown JSON — type as generic record so routers
  // that expose it can narrow further via .extend() if needed.
  args: z.record(z.string(), z.unknown()),
});

// ─── integration_sync_status ─────────────────────────────────────────────────

export const IntegrationSyncStatusSelectSchema = createSelectSchema(integrationSyncStatus);

// ─── weather_reading (hourly) ─────────────────────────────────────────────────

// Hourly rows as they sit in the DB. The weather router computes display fields
// (icon, label) on top of these; that derived output is not a direct DB shadow
// and is intentionally kept as a standalone z.object in the router.
export const WeatherReadingSelectSchema = createSelectSchema(weatherReading);

// ─── weather_daily_reading ────────────────────────────────────────────────────

export const WeatherDailyReadingSelectSchema = createSelectSchema(weatherDailyReading);
