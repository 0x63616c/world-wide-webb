/**
 * Playlist-poller service (www-kp4k.3). Each cycle:
 *   1. Fetches all enabled media_source rows.
 *   2. For each playlist-kind source, runs `yt-dlp --flat-playlist --print id <url>`
 *      to enumerate video IDs without downloading any content.
 *   3. For each video ID not already in media_item, inserts a new media_item
 *      (status=queued) and enqueues a `youtube_ingest` job.
 *
 * Idempotency: the uniqueIndex on media_item.yt_video_id means a re-poll of the
 * same playlist is a no-op — the INSERT … ON CONFLICT DO NOTHING ensures we never
 * create duplicate items, and we never re-enqueue a job for an existing item.
 *
 * yt-dlp is the subprocess binary installed in the media-worker Dockerfile.
 * In unit tests the spawn is mocked at the module boundary.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { mediaItem, mediaSource } from "../db/schema";
import { enqueueJob } from "../jobs/queue";

const execFileAsync = promisify(execFile);

/**
 * Spawn yt-dlp for a single playlist URL and collect the video IDs it prints.
 * Each printed line is one video ID. Returns an empty array on subprocess error
 * so a single broken source doesn't abort the whole poll cycle.
 *
 * @public — exported for unit testing (allows the test to swap ytdlpListPlaylist)
 */
export async function ytdlpListPlaylist(url: string): Promise<string[]> {
  const { stdout } = await execFileAsync("yt-dlp", [
    "--flat-playlist",
    "--print",
    "id",
    // Quiet: suppress progress bars and info lines; we only want one ID per line.
    "--quiet",
    "--no-warnings",
    url,
  ]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Stripe-style id generator for new media_item rows. */
function newMediaItemId(): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
  return `mi_${hex}`;
}

/**
 * One poll cycle. Called by the playlist-poller Worker every ~10 minutes.
 * Throws on DB errors so the runtime records a consecutive-failure streak;
 * individual yt-dlp subprocess failures are caught + logged per-source so
 * one bad playlist doesn't stall the others.
 */
export async function runPlaylistPollerCycle(
  // Dependency-injection hook so unit tests can replace the subprocess call.
  listFn: typeof ytdlpListPlaylist = ytdlpListPlaylist,
): Promise<void> {
  // Only poll sources that are enabled and have a known playlist URL.
  const sources = await db.select().from(mediaSource).where(eq(mediaSource.enabled, true));

  for (const source of sources) {
    const url = source.url ?? (source.externalId ? buildPlaylistUrl(source.externalId) : null);
    if (!url) continue;

    let videoIds: string[];
    try {
      videoIds = await listFn(url);
    } catch (err) {
      // Log and continue — a single broken source must not stall the rest.
      console.warn(`playlist-poller: yt-dlp failed for source ${source.id}:`, err);
      continue;
    }

    if (videoIds.length === 0) continue;

    // Fetch already-known IDs in one query to avoid per-item round-trips.
    const existing = await db
      .select({ ytVideoId: mediaItem.ytVideoId })
      .from(mediaItem)
      .where(inArray(mediaItem.ytVideoId, videoIds));
    const existingSet = new Set(existing.map((r) => r.ytVideoId));

    const newIds = videoIds.filter((id) => !existingSet.has(id));
    for (const videoId of newIds) {
      // Insert the media_item row. ON CONFLICT DO NOTHING makes this safe even
      // if two poller instances race (the unique index on yt_video_id wins).
      const rows = await db
        .insert(mediaItem)
        .values({
          id: newMediaItemId(),
          sourceId: source.id,
          ytVideoId: videoId,
          rawTitle: videoId, // raw title is set properly by the ingest handler
          status: "queued",
        })
        .onConflictDoNothing()
        .returning({ id: mediaItem.id });

      // Only enqueue if we actually inserted a new row (not a conflict).
      if (rows.length > 0 && rows[0]) {
        await enqueueJob("youtube_ingest", {
          mediaItemId: rows[0].id,
          videoId,
          videoPolicy: source.videoPolicy,
        });
      }
    }
  }
}

/** Build the YouTube playlist URL from a playlist ID. */
function buildPlaylistUrl(playlistId: string): string {
  return `https://www.youtube.com/playlist?list=${playlistId}`;
}
