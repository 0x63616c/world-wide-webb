// Notification Center schema (Track C, S1 fold). One row per raised
// notification, written by any producer (CI/deploy poller, system health, home
// automation, media pipeline) through service.raiseNotification. The panel
// reads the feed; the same raise also enqueues a `notify` job (via @www/core's
// durable queue) that pushes to registered devices via APNs.
//
// `dedupe_key` is the collapse handle: a producer that re-raises the SAME
// logical condition (a flapping integration, a repeatedly failing deploy) passes
// a stable key and the unique index turns the second raise into an UPDATE of the
// existing row instead of a new feed entry. It is nullable  --  a notification
// with no key is always a distinct event. Postgres treats NULLs as distinct in a
// unique index, so unkeyed rows never collide with each other.
//
// `read_at` is the sole lifecycle stamp: a notification is unread until the user
// opens the feed, then read. The unread badge counts rows where read_at is null.
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(), // notif_<8hex>, minted in service.ts
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(), // ci | system | home | media
    severity: text("severity").notNull(), // info | warning | critical
    title: text("title").notNull(),
    body: text("body"),
    deepLink: text("deep_link"), // panel route to open on tap, e.g. "/settings/network"
    data: jsonb("data"), // producer-specific structured payload
    readAt: timestamp("read_at", { withTimezone: true }),
    dedupeKey: text("dedupe_key"),
  },
  (t) => [
    uniqueIndex("notification_dedupe_key_idx").on(t.dedupeKey),
    // The feed is always "newest first", so the sort column is the index.
    index("notification_created_at_idx").on(t.createdAt.desc()),
    // The unread badge polls constantly and unread rows are a small minority of
    // a growing table; a partial index keeps that count off a full scan.
    index("notification_unread_idx").on(t.createdAt.desc()).where(sql`${t.readAt} is null`),
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
