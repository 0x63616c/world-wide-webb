import { z } from "zod";
import { db } from "../../db/index";
import { mediaItem, mediaSource } from "../../db/schema";
import { enqueueJob } from "../../jobs/queue";
import {
  getTvNowPlaying,
  tvNext,
  tvPause,
  tvPlay,
  tvPrevious,
  tvSeek,
  tvStop,
} from "../../services/apple-tv-service";
import { publicProcedure, router } from "../init";

const TvNowPlayingSchema = z.object({
  state: z.string(),
  appName: z.string().nullable(),
  mediaTitle: z.string().nullable(),
  mediaArtist: z.string().nullable(),
  mediaPosition: z.number().nullable(),
  mediaDuration: z.number().nullable(),
  source: z.enum(["streaming", "line-in", "TV", "idle"]),
});

// Extract a YouTube video ID from a URL or bare ID string.
// Handles: https://youtu.be/<id>, https://www.youtube.com/watch?v=<id>,
// https://youtube.com/shorts/<id>, and bare 11-char IDs.
function parseYoutubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  // Bare ID: 11 alphanumeric chars (YouTube IDs are exactly 11 chars, [A-Za-z0-9_-]).
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.hostname === "youtu.be") return url.pathname.slice(1).split("?")[0] ?? null;
    if (url.hostname.includes("youtube.com")) {
      // /watch?v=<id>
      const v = url.searchParams.get("v");
      if (v) return v;
      // /shorts/<id> or /embed/<id> or /v/<id>
      const parts = url.pathname.split("/").filter(Boolean);
      const idx = parts.findIndex((p) => ["shorts", "embed", "v"].includes(p));
      if (idx !== -1 && parts[idx + 1]) return parts[idx + 1] ?? null;
    }
  } catch {
    // not a valid URL — could be a bare ID already checked above
  }
  return null;
}

/** Stripe-style id generator for media rows. */
function newId(prefix: string): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${prefix}_${hex}`;
}

// Media router — Apple TV, Sonos, Spotify, and media-ingest queries/mutations.
// Procedures are added per milestone; the router is registered in index.ts so
// typecheck sees it as part of AppRouter from the first milestone (www-51hf.1).
export const mediaRouter = router({
  tvNowPlaying: publicProcedure
    .input(z.object({}).optional())
    .output(TvNowPlayingSchema)
    .query(() => getTvNowPlaying()),

  tvPlay: publicProcedure.mutation(() => tvPlay()),

  tvPause: publicProcedure.mutation(() => tvPause()),

  tvNext: publicProcedure.mutation(() => tvNext()),

  tvPrevious: publicProcedure.mutation(() => tvPrevious()),

  tvStop: publicProcedure.mutation(() => tvStop()),

  tvSeek: publicProcedure
    .input(z.object({ seekPositionSeconds: z.number().nonnegative() }))
    .mutation(({ input }) => tvSeek(input.seekPositionSeconds)),

  // Paste-links-in-chat intake path (www-kp4k.3). Accepts an array of raw
  // YouTube URLs or video IDs; dedupes, creates pending media_items, and
  // enqueues youtube_ingest jobs. Idempotent: URLs already in the DB are
  // silently ignored (ON CONFLICT DO NOTHING on yt_video_id).
  addUrls: publicProcedure
    .input(z.object({ urls: z.array(z.string().min(1)).min(1).max(100) }))
    .mutation(async ({ input }) => {
      // Parse + dedupe within this batch — the same URL pasted 6× = 1 job.
      const seen = new Set<string>();
      const videoIds: string[] = [];
      for (const raw of input.urls) {
        const id = parseYoutubeVideoId(raw);
        if (id && !seen.has(id)) {
          seen.add(id);
          videoIds.push(id);
        }
      }

      if (videoIds.length === 0) {
        return { enqueued: 0, skipped: input.urls.length };
      }

      // Ensure the shared adhoc source exists (one per install, created lazily).
      // ON CONFLICT DO NOTHING keeps this idempotent across concurrent calls.
      const adhocSourceId = "src_adhoc";
      await db
        .insert(mediaSource)
        .values({
          id: adhocSourceId,
          kind: "adhoc",
          title: "Ad-hoc URLs",
          enabled: true,
          videoPolicy: "on",
        })
        .onConflictDoNothing();

      let enqueued = 0;
      for (const videoId of videoIds) {
        const rows = await db
          .insert(mediaItem)
          .values({
            id: newId("mi"),
            sourceId: adhocSourceId,
            ytVideoId: videoId,
            rawTitle: videoId, // will be enriched by the ingest handler
            status: "queued",
          })
          .onConflictDoNothing()
          .returning({ id: mediaItem.id });

        // Only enqueue if we actually inserted (not a duplicate).
        if (rows.length > 0 && rows[0]) {
          await enqueueJob("youtube_ingest", {
            mediaItemId: rows[0].id,
            videoId,
            videoPolicy: "on",
          });
          enqueued++;
        }
      }

      return { enqueued, skipped: input.urls.length - enqueued };
    }),
});
