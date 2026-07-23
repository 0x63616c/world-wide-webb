import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
