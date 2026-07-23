import { boolean, index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
