import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Media ingest pipeline tables (www-kp4k, moved into features/sound Track C
// Wave 6). media_source tracks YouTube playlists and ad-hoc video collections;
// media_item is each individual video moving through the download/metadata
// pipeline. apps/api/src/services/youtube-ingest-service.ts (the youtube_ingest
// job handler, stays app-level) imports mediaItem from here.

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
