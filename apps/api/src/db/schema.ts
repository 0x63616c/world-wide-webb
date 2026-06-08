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

/**
 * Colour of a light: either an RGB triple or a white colour temperature in
 * Kelvin (mutually exclusive in practice — HA reports whichever colour mode is
 * active). Carried in desired/reported state so the DB-authoritative enforcer
 * can drive and detect colour drift, not just on/off + brightness (CC-7d5b.2.2).
 */
export interface LightColor {
  rgb?: [number, number, number];
  kelvin?: number;
}

export interface DeviceLightState {
  on: boolean;
  brightness?: number;
  color?: LightColor;
}

/**
 * Climate (thermostat) state carried in a device_state row (CC-unxz.2). Only the
 * fields the dashboard COMMANDS live in DESIRED: hvac mode, the single setpoint
 * (cool/heat) or the heat_cool range, and the AC fan_mode. Ambient temperature
 * and the live hvac_action are REPORTED-ONLY (never desired) and always come from
 * real HA values — the enforcer writes them into reportedState each cycle, never
 * an invented number (repo zero-fake-data rule). `target` and `targetLow/High` are
 * mutually exclusive in practice (single vs range mode), mirroring ClimateState.
 */
export interface DeviceClimateState {
  mode: string;
  target?: number;
  targetLow?: number;
  targetHigh?: number;
  fanMode?: string;
  /** Reported-only: real ambient temperature from HA (current_temperature). */
  ambient?: number;
  /** Reported-only: real hvac_action from HA (cooling/heating/idle). */
  action?: string;
}

export type DeviceStateValue = DeviceLightState | DeviceClimateState;

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

// Append-only weather readings. The weather-ingest poller inserts a fresh row
// per forecast hour every cycle (never upserts), so we keep the full history of
// how each hour's forecast drifted run-over-run. `kind` separates forward
// forecasts from settled observed actuals (predicted-vs-actual = join on
// target_hour). The dashboard reads the latest row per target_hour.
export const weatherReading = pgTable(
  "weather_reading",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(), // 'forecast' | 'observed'
    targetHour: timestamp("target_hour", { withTimezone: true }).notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    tempF: integer("temp_f").notNull(),
    feelsF: integer("feels_f").notNull(),
    humidity: integer("humidity"),
    weatherCode: integer("weather_code").notNull(),
    windMph: integer("wind_mph"),
    isDay: boolean("is_day").notNull(),
    precipProbability: integer("precip_probability"),
    uvIndex: integer("uv_index"),
  },
  (t) => [index("weather_reading_kind_target_recorded_idx").on(t.kind, t.targetHour, t.recordedAt)],
);

// Daily-grain readings (today's hi/lo + sun times, plus the 7-day outlook).
// Separate table because this is a per-day grain that cannot live in a per-hour
// row. Append-only, same drift property as weather_reading.
export const weatherDailyReading = pgTable(
  "weather_daily_reading",
  {
    id: serial("id").primaryKey(),
    targetDate: text("target_date").notNull(), // YYYY-MM-DD (matches DailyItem.date)
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    hiF: integer("hi_f").notNull(),
    loF: integer("lo_f").notNull(),
    weatherCode: integer("weather_code").notNull(),
    precipProbability: integer("precip_probability"),
    sunriseIso: text("sunrise_iso"),
    sunsetIso: text("sunset_iso"),
  },
  (t) => [index("weather_daily_target_recorded_idx").on(t.targetDate, t.recordedAt)],
);

// Persistent lamp mode — a SINGLETON row (id = LAMP_MODE_SINGLETON_ID). Holds the
// active animated lamp mode that can't be inferred from a colour snapshot, so it
// must be durable: the worker reconciles it (start/stop the party engine) and
// re-arms after a restart. `mode` is 'none' | 'party' (LampMode); `speed` is
// 'slow' | 'medium' | 'fast' (LampModeSpeed) and only meaningful for animated
// modes. Modeled on integration_sync_status's keyed-singleton shape (CC-7d5b.3.2).
export const LAMP_MODE_SINGLETON_ID = "singleton";

export const lampMode = pgTable("lamp_mode", {
  id: text("id").primaryKey(),
  mode: text("mode").notNull().default("none"),
  speed: text("speed"),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Media ingest pipeline tables (CC-kp4k). media_source tracks YouTube playlists
// and ad-hoc video collections; media_item is each individual video moving through
// the download/metadata pipeline. The worker barrel re-exports these for the
// media-worker image.

export const mediaSource = pgTable(
  "media_source",
  {
    id: text("id").primaryKey(), // Stripe-style src_<id>
    kind: text("kind").notNull(), // 'playlist' | 'adhoc'
    externalId: text("external_id"), // YouTube playlist id for kind=playlist
    url: text("url"), // URL for kind=adhoc
    title: text("title").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    videoPolicy: text("video_policy").notNull().default("none"), // 'none' | 'on'
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("media_source_kind_idx").on(t.kind),
    index("media_source_enabled_idx").on(t.enabled),
  ],
);

export const mediaItem = pgTable(
  "media_item",
  {
    id: text("id").primaryKey(), // Stripe-style mi_<id>
    sourceId: text("source_id")
      .notNull()
      .references(() => mediaSource.id, { onDelete: "cascade" }),
    ytVideoId: text("yt_video_id").notNull(),
    rawTitle: text("raw_title").notNull(),
    cleanTitle: text("clean_title"),
    artist: text("artist"),
    event: text("event"),
    category: text("category"),
    status: text("status").notNull().default("pending"), // 'pending'|'downloading'|'done'|'failed'
    audioPath: text("audio_path"),
    videoPath: text("video_path"),
    thumbPath: text("thumb_path"),
    audioBytes: integer("audio_bytes"),
    videoBytes: integer("video_bytes"),
    durationSec: integer("duration_sec"),
    error: text("error"),
    retries: integer("retries").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("media_item_yt_video_id_idx").on(t.ytVideoId),
    index("media_item_source_id_idx").on(t.sourceId),
    index("media_item_status_idx").on(t.status),
  ],
);
