// Drizzle schema. Backend agents add tables here.
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// The `job` durable queue table now lives in @www/core
// (packages/core/src/jobs/schema.ts). Re-exported here (an identifier
// re-export that preserves object identity) so the drizzle relational schema
// still registers it and existing imports from "../db/schema" keep working
// unchanged (same precedent as deviceState/integrationSyncStatus below).
export { job } from "@www/core";

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  place: text("place").notNull(),
  date: timestamp("date", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  (t) => [
    index("weather_reading_kind_target_recorded_idx").on(t.kind, t.targetHour, t.recordedAt),
    // Serves the 30-day retention purge's `recorded_at < cutoff` predicate. The
    // composite index above can't: recorded_at is its trailing column.
    index("weather_reading_recorded_at_idx").on(t.recordedAt),
  ],
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
  (t) => [
    index("weather_daily_target_recorded_idx").on(t.targetDate, t.recordedAt),
    // Serves the 30-day retention purge, same reason as weather_reading's.
    index("weather_daily_recorded_at_idx").on(t.recordedAt),
  ],
);

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

// Global control-center settings, a SINGLETON row (id = SETTINGS_SINGLETON_ID).
// Holds the wall panel's durable preferences (idle-dim, dev overlays, snap mode)
// as a single JSON blob so new fields can be added without a column
// migration. The web client reads/writes the whole Settings object; the shape,
// defaults, and validation live in services/settings-service.ts. Modeled on the
// lamp_mode keyed-singleton pattern.
export const SETTINGS_SINGLETON_ID = "singleton";

// Kept as a structural type here so the jsonb column is typed; the authoritative
// Settings shape + Zod schema + defaults live in services/settings-service.ts.
export interface SettingsValue {
  idleDimEnabled: boolean;
  idleDimTimeoutMs: number;
  idleDimLevel: number;
  showFps: boolean;
  showBuildBadge: boolean;
  snapMode: "proximity" | "mandatory" | "mandatory-settle" | "none" | "spring";
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
// in one room. Volume is the first , two panels at the same level would be a
// coincidence, not a shared truth. Shape, defaults, and validation live in
// services/device-settings-service.ts; bounds in contract/device-settings.ts.
//
// device_id is the primary key and is minted client-side, so rows appear on
// first write from a panel and no registration step is needed.

// Kept as a structural type here so the jsonb column is typed; the authoritative
// shape + Zod schema + defaults live in services/device-settings-service.ts.
export interface DeviceSettingsValue {
  volume: number;
}

export const deviceSettings = pgTable("device_settings", {
  deviceId: text("device_id").primaryKey(),
  value: jsonb("value").$type<DeviceSettingsValue>().notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Latest known TestFlight build of the wall-panel iOS shell, a SINGLETON row
// (id = ASC_BUILD_STATUS_SINGLETON_ID). Written by the asc-version-poll worker
// (App Store Connect /v1/builds), read by the system.appUpdateStatus tRPC query
// so the board can raise an "update available" banner. One row is enough: build
// numbers are contiguous (fastlane latest_testflight_build_number + 1), so
// "builds behind" is latest - installed with no history needed. Modeled on the
// lamp_mode / settings keyed-singleton pattern.
export const ASC_BUILD_STATUS_SINGLETON_ID = "singleton";

export const ascBuildStatus = pgTable("asc_build_status", {
  id: text("id").primaryKey(),
  buildNumber: integer("build_number").notNull(),
  marketingVersion: text("marketing_version").notNull(),
  uploadedAtUtc: timestamp("uploaded_at_utc", { withTimezone: true }).notNull(),
  fetchedAtUtc: timestamp("fetched_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Media ingest pipeline tables (www-kp4k). media_source tracks YouTube playlists
// and ad-hoc video collections; media_item is each individual video moving through
// the download/metadata pipeline. The worker barrel re-exports these for the
// worker image.

export const mediaSource = pgTable(
  "media_source",
  {
    id: text("id").primaryKey(), // Stripe-style src_<id>
    externalId: text("external_id"), // YouTube playlist id for playlist sources
    url: text("url"), // URL for ad-hoc sources
    title: text("title").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("media_source_enabled_idx").on(t.enabled)],
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
    uploader: text("uploader"), // YouTube channel that published it; null until downloaded
    status: text("status").notNull().default("pending"), // 'queued' (poller) | 'ready' (ingest handler)
    videoPath: text("video_path"),
    thumbPath: text("thumb_path"),
    videoBytes: integer("video_bytes"),
    durationSec: integer("duration_sec"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("media_item_yt_video_id_idx").on(t.ytVideoId),
    index("media_item_source_id_idx").on(t.sourceId),
    index("media_item_status_idx").on(t.status),
  ],
);

// ─── Captive portal (www-q002) ──────────────────────────────────────────────
// The portal_rate_limit + portal_authorization tables + PORTAL_RATE_LIMIT_ID
// were FOLDED into the guest-wifi feature (Track C, C7): they now live in
// features/guest-wifi/schema.ts and reach drizzle-kit via the generated schema
// barrel (features/_generated/schema.gen.ts, which unions this file with every
// feature's schema.ts). Nothing in apps/api references them directly anymore.

// Frontend log shipping (spec 2026-07-18-frontend-log-shipping-design). The wall
// panel and other devices mirror their on-device frontend logs (IndexedDB + the
// native JSONL file) into Postgres so they're queryable from a desk via SQL
// instead of only readable standing at the panel. The frontend tracks a cursor
// (last shipped entry_id) and pushes everything after it; offline windows
// backfill on reconnect. Ingest is idempotent by construction via the composite
// PK — entry ids (`bootMs-seq`) are only unique per device, so identity is
// (device_id, entry_id), and resends / cursor resets `on conflict do nothing`.
// All four levels ship; retention (30 days, frontend-log-purge-service) is the
// size control, not level filtering.
export const frontendLog = pgTable(
  "frontend_log",
  {
    deviceId: text("device_id").notNull(), // stable id, e.g. "ipad13-1-3f9a2c1b" / "web-<8hex>"
    entryId: text("entry_id").notNull(), // `bootMs-seq`, lexicographically ordered per device
    ts: timestamp("ts", { withTimezone: true }).notNull(), // capture time
    level: text("level").notNull(), // debug | info | warn | error
    source: text("source").notNull(),
    msg: text("msg").notNull(),
    data: jsonb("data"), // nullable structured payload
    sha: text("sha").notNull(), // git sha of the web bundle
    build: text("build").notNull(), // app build number ("80") or "web"
    deviceName: text("device_name").notNull(), // display label at capture time
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.deviceId, t.entryId] }),
    // Time-range reads ("last day of warn/error") drive the query surface; the
    // bare ts index serves ts-only scans, (level, ts) the level-filtered ones.
    index("frontend_log_ts_idx").on(t.ts),
    index("frontend_log_level_ts_idx").on(t.level, t.ts),
    // The sessions aggregate (interaction-session-service) reads ui-channel
    // rows by their JSONB session id , without this partial expression index
    // every per-session lookup is a full scan of a table that holds 30 days of
    // EVERY device's debug logs. Partial on source='ui' keeps it tiny: only
    // interaction rows are indexed, and the service always filters on both.
    index("frontend_log_ui_session_idx")
      .on(sql`(${t.data}->>'interactionSessionId')`)
      .where(sql`${t.source} = 'ui'`),
  ],
);

// Wake photos (spec docs/specs/2026-07-18-interaction-logging-design.md). The
// front-camera burst frames the panel uploads on every undim. The BYTES stay on
// disk (<MEDIA_STORAGE_DIR>/wake-photos/YYYY/MM/DD/...); this table is the index
// over them, which the dated directory tree used to serve implicitly.
//
// It exists for three things the tree could not do: correlate a frame with the
// interaction session it belongs to, attribute a frame to a device, and give
// retention a cheap cutoff query instead of a full-tree walk.
//
// `interactionSessionId` is a PLAIN COLUMN, not a foreign key. There is no
// sessions table by design (sessions are derived from frontend_log), and even if
// there were, the photo uploads immediately over HTTP while the log ships on a
// 3s batch that backfills across offline windows , so the photo routinely lands
// BEFORE the session it names. A soft reference tolerates that ordering; an FK
// would reject the insert.
export const wakePhoto = pgTable(
  "wake_photo",
  {
    // Path relative to the wake-photos root, e.g. "2026-07-18T12-40-00.000Z-0.jpg".
    // Also the id: it is what GET /media/wake-photos/<path> serves, and the
    // filesystem already guarantees it is unique.
    path: text("path").primaryKey(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    // Nullable: bursts uploaded before this column existed, and any burst that
    // fires with no live session, are legitimately unattributed.
    interactionSessionId: text("interaction_session_id"),
    // Nullable for the same backfill reason. Matches frontend_log.device_id.
    deviceId: text("device_id"),
    // 0-based position within its burst. Nullable for backfilled rows, where the
    // information does not exist , the old filename suffix was a same-millisecond
    // collision counter, not a frame index.
    frameIdx: integer("frame_idx"),
    bytes: integer("bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The Sessions view's primary read: every frame of one visit.
    index("wake_photo_session_idx").on(t.interactionSessionId),
    // Day-grouped listing (the existing viewer) and the retention cutoff.
    index("wake_photo_captured_at_idx").on(t.capturedAt),
  ],
);

// Photo booth: the wall panel's on-demand camera. Unlike wake photos (an
// automatic front-camera burst on every undim), these are deliberate captures a
// person triggers, in one of four modes: a single `photo`, a `burst` of stills,
// a `four_frame` strip, or an animated `gif`. The BYTES live on disk
// (<MEDIA_STORAGE_DIR>/booth-photos/YYYY/MM/DD/...); this table is the gallery
// index over them, one row per frame.
//
// Modelled on wake_photo but deliberately separate: a distinct storage dir,
// table, and router keep the deliberate-capture gallery from tangling with the
// automatic undim burst. Two things differ from wake_photo:
//   - A `group_id` ties the frames of one multi-frame capture (burst, four_frame)
//     together so the gallery renders a burst as a single item, not N loose
//     stills. A single photo or gif is a group of one.
//   - `soft_deleted_at` gives the gallery a reversible remove: a non-null value
//     hides the frame from every read without destroying the bytes.
export const boothPhoto = pgTable(
  "booth_photo",
  {
    // Stripe-style id (repo IDs default to prefix_<id>): bph_<random>.
    id: text("id").primaryKey(),
    // Path relative to the booth-photos root, e.g. "2026-07-19T12-40-00.000Z-0.jpg".
    // What GET /media/booth-photos/<path> serves; unique on disk by construction.
    path: text("path").notNull().unique(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    // Capture mode: 'photo' | 'burst' | 'four_frame' | 'gif'.
    mode: text("mode").notNull(),
    // Ties the frames of one capture together (bpg_<random>). Every frame of a
    // burst/four_frame shares it; a single photo/gif is its own group of one.
    groupId: text("group_id").notNull(),
    // 0-based position within the group, ordering the frames of a burst/strip.
    frameIdx: integer("frame_idx").notNull().default(0),
    // 'image/jpeg' | 'image/gif'. Drives the serve route's Content-Type.
    mimeType: text("mime_type").notNull(),
    bytes: integer("bytes").notNull(),
    // Non-destructive filter id (e.g. 'noir', 'warm_70s'). The web owns the
    // id->CSS mapping; the backend only stores the string. Nullable: an unfiltered
    // capture, and gif uploads (which bake their filter in client-side) send none.
    // Validated `^[a-z0-9_]{1,32}$` at the edge so no arbitrary text can land here.
    filter: text("filter"),
    // Which panel took the shot. Matches frontend_log.device_id; nullable when
    // the uploader sends no (or a malformed) attribution header.
    deviceId: text("device_id"),
    // Source-only frame: kept for future re-assembly but never shown in the
    // gallery. A GIF capture stores the assembled .gif (source_only=false) AND
    // its individual raw JPEG frames (source_only=true) in the same group; the
    // listing drops the frames so a gif group renders as just its .gif. A
    // source-only JPEG is allowed under gif mode (see saveBoothPhoto).
    sourceOnly: boolean("source_only").notNull().default(false),
    // Reversible remove for the gallery: non-null hides the frame from every
    // read, the bytes stay on disk. (User-facing copy never says "soft delete".)
    softDeletedAt: timestamp("soft_deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The gallery's read: every frame of one capture, ordered.
    index("booth_photo_group_idx").on(t.groupId),
    // Newest-first gallery listing.
    index("booth_photo_captured_at_idx").on(t.capturedAt),
  ],
);

// ─── GitHub Actions deploy pipeline (www-github-deploy) ────────────────────
// githubRun, githubRunLogTail, githubPollStatus, GITHUB_POLL_STATUS_SINGLETON_ID
// were FOLDED into the deploys feature (Track C, Wave 2): they now live in
// features/deploys/schema.ts and reach drizzle-kit via the generated schema
// barrel (features/_generated/schema.gen.ts, which unions this file with every
// feature's schema.ts). github-purge-service.ts still purges the physical
// github_run/github_run_log_tail tables via raw SQL (table names unaffected by
// which schema.ts declares them), so no change was needed there.

// notification + devicePushToken (Notification Center) were FOLDED into the
// notif feature (Track C, S1): they now live in features/notif/schema.ts and
// reach drizzle-kit via the generated schema barrel (unions this file with
// every feature's schema.ts), same precedent as the deploys fold above.
