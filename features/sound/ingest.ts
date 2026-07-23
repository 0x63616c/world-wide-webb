/**
 * Paste-links-in-chat intake path (www-kp4k.3), moved out of the shared media
 * router into features/sound/api.ts's `addUrls` mutation (Track C, Wave 6
 * fold). Accepts an array of raw YouTube URLs or video IDs; dedupes, creates
 * pending media_items, and enqueues youtube_ingest jobs. Idempotent: URLs
 * already in the DB are silently ignored (ON CONFLICT DO NOTHING on
 * yt_video_id).
 */
import { enqueueJob } from "@www/core";
import { db } from "./db";
import { mediaItem, mediaSource } from "./schema";

// JobTypeRegistry augmentation for youtube_ingest. Also declared in
// apps/api/src/jobs/queue.ts (needed there for the worker's env-gated JOBS
// entry) — TS interface-merging two identical declarations of the same member
// is harmless. This copy is what makes the type visible to programs that
// compile this file without pulling in apps/api's queue binder (@cc/api,
// storybook, web , all of which type-check ingest.ts transitively via the
// generated AppRouter).
declare module "@www/core" {
  interface JobTypeRegistry {
    youtube_ingest: { mediaItemId: string; videoId: string };
  }
}

// Extract a YouTube video ID from a URL or bare ID string.
// Handles: https://youtu.be/<id>, https://www.youtube.com/watch?v=<id>,
// https://youtube.com/shorts/<id>, and bare 11-char IDs.
export function parseYoutubeVideoId(input: string): string | null {
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
    // not a valid URL , could be a bare ID already checked above
  }
  return null;
}

/** Stripe-style id generator for media rows. */
function newId(prefix: string): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `${prefix}_${hex}`;
}

export interface AddUrlsResult {
  enqueued: number;
  skipped: number;
}

/**
 * Parses + dedupes the given raw URLs/IDs, ensures the shared adhoc source
 * exists, inserts a pending media_item per new video, and enqueues a
 * youtube_ingest job for each. Idempotent across concurrent calls
 * (ON CONFLICT DO NOTHING on both inserts).
 */
export async function addUrls(urls: string[]): Promise<AddUrlsResult> {
  // Parse + dedupe within this batch , the same URL pasted 6× = 1 job.
  const seen = new Set<string>();
  const videoIds: string[] = [];
  for (const raw of urls) {
    const id = parseYoutubeVideoId(raw);
    if (id && !seen.has(id)) {
      seen.add(id);
      videoIds.push(id);
    }
  }

  if (videoIds.length === 0) {
    return { enqueued: 0, skipped: urls.length };
  }

  // Ensure the shared adhoc source exists (one per install, created lazily).
  // ON CONFLICT DO NOTHING keeps this idempotent across concurrent calls.
  const adhocSourceId = "src_adhoc";
  await db
    .insert(mediaSource)
    .values({
      id: adhocSourceId,
      title: "Ad-hoc URLs",
      enabled: true,
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
      await enqueueJob(db, "youtube_ingest", {
        mediaItemId: rows[0].id,
        videoId,
      });
      enqueued++;
    }
  }

  return { enqueued, skipped: urls.length - enqueued };
}
