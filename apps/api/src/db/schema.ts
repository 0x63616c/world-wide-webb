// Drizzle schema. Backend agents add tables here.
import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Device sync: backend owns device state; frontend reads merged (effective) state.
// Ported from evee device-state-sync pattern. Desired window is 5s for CC.
// The deviceState table + its state types + DeviceKind now live in @www/core
// (packages/core/src/device-state/schema.ts); re-exported here so existing
// imports from "../db/schema" keep working unchanged.
// The integrationSyncStatus table now lives in @www/core
// (packages/core/src/integration-sync/schema.ts). Re-exported here (an identifier
// re-export that preserves object identity) so the drizzle relational schema still
// registers it and existing imports from "../db/schema" keep working unchanged.
export {
  type DeviceClimateState,
  DeviceKind,
  type DeviceLightState,
  type DeviceSpeakerState,
  type DeviceStateValue,
  deviceState,
  integrationSyncStatus,
  type LightColor,
} from "@www/core";

// The lamp_mode table (LAMP_MODE_SINGLETON_ID) lives in features/ctrl/schema.ts.
// The ctrl App's worker.ts facet owns the light-enforcer and party-mode cycles.

// Global control-center settings, a SINGLETON row (id = SETTINGS_SINGLETON_ID).
// Holds the wall panel's durable preferences (PIN, accent, time zone) as a
// single JSON blob so new fields can be added without a column migration. The
// web client reads/writes the whole Settings object; the shape, defaults, and
// validation live in services/settings-service.ts. Modeled on the lamp_mode
// keyed-singleton pattern.
export const SETTINGS_SINGLETON_ID = "singleton";

// Kept as a structural type here so the jsonb column is typed; the authoritative
// Settings shape + Zod schema + defaults live in services/settings-service.ts.
export interface SettingsValue {
  pinCode: string;
  accent: "blue" | "white" | "green" | "orange";
  timeZone: string;
}

export const settings = pgTable("settings", {
  id: text("id").primaryKey(),
  value: jsonb("value").$type<SettingsValue>().notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Per-device control-center settings, one row PER PANEL keyed on the web
// client's stable device_id (lib/device-id.ts , e.g. "ipad13-1-3f9a2c1b"). Same
// jsonb-blob approach as `settings` above so new fields need no column
// migration, but deliberately NOT that table: `settings` is a singleton every
// panel shares, and these are preferences that belong to one piece of hardware
// in one room , the device name (the only current field) is one of them, since
// two panels at the same level would be a coincidence, not a shared truth.
// Shape, defaults, and validation live in services/device-settings-service.ts;
// bounds in contract/device-settings.ts.
//
// device_id is the primary key and is minted client-side, so rows appear on
// first write from a panel and no registration step is needed.

// Kept as a structural type here so the jsonb column is typed; the authoritative
// shape + Zod schema + defaults live in services/device-settings-service.ts.
export interface DeviceSettingsValue {
  name: string;
}

export const deviceSettings = pgTable("device_settings", {
  deviceId: text("device_id").primaryKey(),
  value: jsonb("value").$type<DeviceSettingsValue>().notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Every other table this file used to declare now lives in the App that owns
// it, reaching drizzle-kit through the generated schema barrel
// (features/_generated/schema.gen.ts, which unions this file with every
// feature's schema.ts): `wake_photo` (features/wakes), `booth_photo`
// (features/booth), `lamp_mode` (features/ctrl), the two weather tables
// (features/weather). `device_state` and `integration_sync_status` live in
// @www/core and are re-exported above.
