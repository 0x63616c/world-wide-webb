// Drizzle schema. Backend agents add tables here.
import { boolean, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// The `job` durable queue table now lives in @www/core
// (packages/core/src/jobs/schema.ts). Re-exported here (an identifier
// re-export that preserves object identity) so the drizzle relational schema
// still registers it and existing imports from "../db/schema" keep working
// unchanged (same precedent as deviceState/integrationSyncStatus below).
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
  job,
  type LightColor,
} from "@www/core";

// The lamp_mode table (LAMP_MODE_SINGLETON_ID) now lives in features/ctrl/schema.ts
// (Track C fold) — imported by the hand-wired light-enforcer/party-service via
// @features/ctrl/schema.

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

// Media ingest pipeline tables (www-kp4k) were FOLDED into the sound feature
// (Track C, Wave 6): media_source/media_item now live in
// features/sound/schema.ts and reach drizzle-kit via the generated schema
// barrel (features/_generated/schema.gen.ts). apps/api/src/services/
// youtube-ingest-service.ts (the app-level youtube_ingest job handler) imports
// mediaItem from @features/sound/schema.

// ─── Captive portal (www-q002) ──────────────────────────────────────────────
// The portal_rate_limit + portal_authorization tables + PORTAL_RATE_LIMIT_ID
// were FOLDED into the guest-wifi feature (Track C, C7): they now live in
// features/guest-wifi/schema.ts and reach drizzle-kit via the generated schema
// barrel (features/_generated/schema.gen.ts, which unions this file with every
// feature's schema.ts). Nothing in apps/api references them directly anymore.

// Wake photos (spec docs/specs/2026-07-18-interaction-logging-design.md) were
// FOLDED into the wakes feature (Track C, Wave 5): the `wake_photo` table now
// lives in features/wakes/schema.ts and reaches drizzle-kit via the generated
// schema barrel (features/_generated/schema.gen.ts). It stays referenced below
// only in `boothPhoto`'s doc comment, which compares the two tables.

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
