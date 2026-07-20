// Drizzle schema. Backend agents add tables here.
import { sql } from "drizzle-orm";
import {
  bigint,
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

// Generic durable job queue (www-kp4k.12). Any background work that needs
// at-least-once delivery, per-attempt retry backoff, and a typed handler
// registry registers here. `youtube_ingest` is the first consumer; future async
// work (transcode, notifications, backups) registers a handler and gets retry +
// observability for free.
export const job = pgTable(
  "job",
  {
    id: serial("id").primaryKey(),
    // Stable string identifying the handler (e.g. 'youtube_ingest', 'enrich_media').
    type: text("type").notNull(),
    // Arbitrary JSON input consumed by the handler, schema is handler-specific.
    payload: jsonb("payload").notNull(),
    // Lifecycle: queued → running → done | failed. A failed job that hasn't
    // exhausted its attempts is re-queued with an exponential run_after bump.
    status: text("status").notNull().default("queued"),
    // Higher priority = claimed first (ORDER BY priority DESC, created_at ASC).
    priority: integer("priority").notNull().default(0),
    // How many times the handler has been invoked (counting the current attempt).
    attempts: integer("attempts").notNull().default(0),
    // Maximum attempts before the job is permanently failed.
    maxAttempts: integer("max_attempts").notNull().default(5),
    // Not eligible for claiming until this wall-clock time. Default: now = immediately
    // claimable. Set forward by the retry logic for exponential backoff.
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    // The instance that claimed this job (e.g. hostname or UUID), used to
    // detect stuck running jobs if we add a watchdog later.
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    // JSON result blob written on success (optional; useful for debugging).
    result: jsonb("result"),
    // Error message from the last failed attempt.
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Primary claim query: status=queued + run_after<=now, ordered by priority
    // then arrival order. The partial index on (status, run_after, priority) lets
    // the DB satisfy this in one index scan rather than a heap filter sweep.
    index("job_claim_idx").on(t.status, t.runAfter, t.priority),
  ],
);

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
 * Color of a light: either an RGB triple or a white color temperature in
 * Kelvin (mutually exclusive in practice, HA reports whichever color mode is
 * active). Carried in desired/reported state so the DB-authoritative enforcer
 * can drive and detect color drift, not just on/off + brightness (www-7d5b.2.2).
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
 * Climate (thermostat) state carried in a device_state row (www-unxz.2). Only the
 * fields the dashboard COMMANDS live in DESIRED: hvac mode, the single setpoint
 * (cool/heat) or the heat_cool range, and the AC fan_mode. Ambient temperature
 * and the live hvac_action are REPORTED-ONLY (never desired) and always come from
 * real HA values, the enforcer writes them into reportedState each cycle, never
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

/**
 * Sonos speaker state carried in a device_state row (www-5mek). Volume is the
 * single commandable dimension: the dashboard writes DESIRED instantly and the
 * sonos-volume-enforcer reconciles it onto the player over UPnP, adopting
 * external changes (Sonos app, hardware buttons) outside the command window ,
 * the same DB-authoritative model as lights.
 */
export interface DeviceSpeakerState {
  volume: number;
}

export type DeviceStateValue = DeviceLightState | DeviceClimateState | DeviceSpeakerState;

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
// Holds the wall panel's durable preferences (idle-dim, recenter, dev overlays,
// snap mode) as a single JSON blob so new fields can be added without a column
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
  recenterEnabled: boolean;
  recenterTimeoutMs: number;
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

// ─── Captive portal (www-q002) ──────────────────────────────────────────────
// Guest WiFi onboarding at captive-portal.worldwidewebb.co. A guest verifies
// their email with a 6-digit code, enters the WiFi password, and gets 30 days
// of internet per device via UniFi authorize-guest. Postgres replaces the
// spec's Redis suggestion (Calum override): codes/counters are short-lived
// rows, cleaned up by a scheduled CronJob (not a worker loop). UTC throughout.

// Global wrong-password rate limit (www-p9hx). The portal is password-only: a
// single shared WiFi password (no email/OTP), so there is no per-device identity
// to meaningfully rate-limit (an open SSID lets an attacker rotate MACs freely).
// Instead a single global counter caps wrong password attempts per UTC calendar
// day. `dateUtc` (YYYY-MM-DD) scopes the count to one day; crossing midnight UTC
// resets it. Singleton: exactly one row, id = PORTAL_RATE_LIMIT_ID.
export const portalRateLimit = pgTable("portal_rate_limit", {
  id: text("id").primaryKey(), // constant 'global'
  dateUtc: text("date_utc").notNull(), // YYYY-MM-DD (UTC) the count applies to
  wrongAttempts: integer("wrong_attempts").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// A granted device authorization. The DB is the source of truth for the 30-day
// window (mirrors the lights desired-state model); UniFi is the actuator. One
// row per device MAC (unique) so re-authorizing the same device is an
// idempotent upsert. status(mac) reads this: active (now < expires) →
// AlreadyConnected; expired row → SessionExpired; none → fresh flow. Password-only
// means the MAC is the sole identity, no guest row.
export const portalAuthorization = pgTable(
  "portal_authorization",
  {
    id: text("id").primaryKey(), // Stripe-style auth_<id>
    mac: text("mac").notNull(),
    grantedAtUtc: timestamp("granted_at_utc", { withTimezone: true }).notNull().defaultNow(),
    expiresAtUtc: timestamp("expires_at_utc", { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex("portal_authorization_mac_idx").on(t.mac)],
);

/** @public - constant primary key for the portalRateLimit singleton row. */
export const PORTAL_RATE_LIMIT_ID = "global";

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

// Per-tile board placement, where each REAL tile sits in the 64×64 pannable
// world. Row per tile keyed by the registry tile id (e.g. "tile_clock"). The
// tile SET (component, size, label) is code-owned in the web tile-registry;
// this table only overrides positions. A missing row means "use the registry
// default", so a never-edited board stores nothing. Whole-layout saves replace
// all rows in one transaction (services/board-layout-service.ts).
export const boardTilePlacement = pgTable("board_tile_placement", {
  tileId: text("tile_id").primaryKey(),
  worldCol: integer("world_col").notNull(),
  worldRow: integer("world_row").notNull(),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).defaultNow().notNull(),
});

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
    // Path relative to the wake-photos root, e.g. "2026/07/18/1752849600000-0.jpg".
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
    // Path relative to the booth-photos root, e.g. "2026/07/19/1752849600000-0.jpg".
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

// GitHub Actions deploy pipeline (spec 2026-07-18-github-deploy-tile-design).
// The worker's github-actions poll writes these; the github tRPC router reads
// them; the Deploys tile renders them. Neither the api nor the tile ever calls
// GitHub directly.

// One row per workflow run on main. "Currently deployed" is the newest run
// whose DEPLOY JOB concluded success (not merely the newest green run  --  path
// filters can skip deploy inside a successful run), which is why
// deploy_job_conclusion is a first-class column.
export const githubRun = pgTable(
  "github_run",
  {
    // GitHub's run id. bigint: GitHub ids are int64 and already past 2^31.
    id: bigint("id", { mode: "number" }).primaryKey(),
    runNumber: integer("run_number").notNull(),
    workflowName: text("workflow_name").notNull(),
    headSha: text("head_sha").notNull(),
    commitMessage: text("commit_message"),
    commitAuthor: text("commit_author"),
    status: text("status").notNull(), // 'queued' | 'in_progress' | 'completed'
    conclusion: text("conclusion"), // null while in flight
    // Conclusion of the run's `deploy` job: 'success' | 'failure' | 'skipped' |
    // null (job not finished / jobs not yet fetched). Drives "currently deployed".
    deployJobConclusion: text("deploy_job_conclusion"),
    // First failing job/step, for the tile's "failed" verdict; the failed job id
    // is what the log-tail fetch needs.
    failedJobId: bigint("failed_job_id", { mode: "number" }),
    failedJobName: text("failed_job_name"),
    failedStepName: text("failed_step_name"),
    // Job/step currently executing while the run is in flight (tile "deploying"
    // sub-line). Cleared once the run completes.
    currentJobName: text("current_job_name"),
    currentStepName: text("current_step_name"),
    startedAtUtc: timestamp("started_at_utc", { withTimezone: true }).notNull(),
    completedAtUtc: timestamp("completed_at_utc", { withTimezone: true }),
    // Diffstat from the commit detail endpoint; null until that one-time fetch.
    changedFileCount: integer("changed_file_count"),
    additions: integer("additions"),
    deletions: integer("deletions"),
    htmlUrl: text("html_url").notNull(),
  },
  (t) => [
    // Newest-first feed reads and the 30-day retention cutoff.
    index("github_run_started_at_idx").on(t.startedAtUtc),
  ],
);

// Last 4KB of the failed job's log, one row per run. Separate table so the
// blobs never ride the hot feed read. `attempts` caps the retry loop: job logs
// 404 for a few seconds after a job flips to failure, so the tail is fetched on
// later ticks with backoff rather than in the same cycle that saw the failure.
export const githubRunLogTail = pgTable("github_run_log_tail", {
  runId: bigint("run_id", { mode: "number" }).primaryKey(),
  jobId: bigint("job_id", { mode: "number" }).notNull(),
  logTail: text("log_tail"), // null until a fetch succeeds
  attempts: integer("attempts").notNull().default(0),
  fetchedAtUtc: timestamp("fetched_at_utc", { withTimezone: true }),
});

// Poll-state SINGLETON (id = GITHUB_POLL_STATUS_SINGLETON_ID): the staleness
// envelope (modeled on integration_sync_status) plus the denormalized
// currently-deployed pointer so the tile answers "what is deployed" in one
// read. NEVER purged  --  if the last deploy is 31 days old the history goes but
// this pointer stays (retention sweep must exclude it).
export const GITHUB_POLL_STATUS_SINGLETON_ID = "singleton";

export const githubPollStatus = pgTable("github_poll_status", {
  id: text("id").primaryKey(),
  lastPolledAtUtc: timestamp("last_polled_at_utc", { withTimezone: true }),
  lastError: text("last_error"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  deployedSha: text("deployed_sha"),
  deployedRunId: bigint("deployed_run_id", { mode: "number" }),
  deployedAtUtc: timestamp("deployed_at_utc", { withTimezone: true }),
  // Head of main as GitHub reports it (newest run's head sha).
  mainHeadSha: text("main_head_sha"),
  // Exact commit count deployed..head from the compare endpoint; 0 when equal.
  commitsBehind: integer("commits_behind").notNull().default(0),
  updatedAtUtc: timestamp("updated_at_utc", { withTimezone: true }).notNull().defaultNow(),
});

// Notification Center. One row per raised notification, written by any producer
// (CI/deploy poller, system health, home automation, media pipeline) through
// notification-service.raiseNotification. The panel reads the feed; the same
// raise also enqueues a `notify` job that pushes to registered devices via APNs.
//
// `dedupe_key` is the collapse handle: a producer that re-raises the SAME
// logical condition (a flapping integration, a repeatedly failing deploy) passes
// a stable key and the unique index turns the second raise into an UPDATE of the
// existing row instead of a new feed entry. It is nullable  --  a notification
// with no key is always a distinct event. Postgres treats NULLs as distinct in a
// unique index, so unkeyed rows never collide with each other.
//
// read/dismissed are separate lifecycle stamps, not one status column: reading a
// notification (opening the feed) and dismissing it (swiping it away) are
// independent actions, and the unread badge must not be cleared by a dismissal.
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(), // notif_<8hex>, minted in notification-service
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(), // ci | system | home | media
    severity: text("severity").notNull(), // info | warning | critical
    title: text("title").notNull(),
    body: text("body"),
    deepLink: text("deep_link"), // panel route to open on tap, e.g. "/settings/network"
    data: jsonb("data"), // producer-specific structured payload
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
  },
  (t) => [
    uniqueIndex("notification_dedupe_key_idx").on(t.dedupeKey),
    // The feed is always "newest first", so the sort column is the index.
    index("notification_created_at_idx").on(t.createdAt.desc()),
    // The unread badge polls constantly and unread rows are a small minority of
    // a growing table; a partial index keeps that count off a full scan.
    index("notification_unread_idx")
      .on(t.createdAt.desc())
      .where(sql`${t.readAt} is null and ${t.dismissedAt} is null`),
  ],
);

// APNs push targets, one row per panel/device. Keyed by the same stable
// `device_id` the frontend log shipper uses (`<model-slug>-<idfv8>`), so a
// device's logs and its push token join on one identity. The token itself
// rotates (APNs reissues it), so the device re-registers on every boot and the
// row is upserted rather than inserted  --  device identity is stable, the token
// is not. `push_enabled` is the user's per-device opt-out; the notify job only
// ever loads rows where it is true.
export const devicePushToken = pgTable("device_push_token", {
  deviceId: text("device_id").primaryKey(),
  token: text("token").notNull(), // APNs device token, lowercase hex
  platform: text("platform").notNull(), // ios
  deviceName: text("device_name"),
  pushEnabled: boolean("push_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
