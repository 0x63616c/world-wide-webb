/**
 * youtube_ingest job handler (www-kp4k.4 + www-kp4k.5). Given a mediaItemId:
 *   1. Validates the item exists and is not already done.
 *   2. Downloads one video-only file (audio is muxed inside the container) plus
 *      its thumbnail via a single yt-dlp call. NEVER re-transcodes , we pick the
 *      AV1 stream YouTube already serves.
 *   3. Records the file path, byte size, and duration in media_item.
 *   4. Sets status = 'ready' (or updates error on throw).
 *
 * Idempotent: if status is already 'ready', the handler is a no-op. The queue
 * handles retries via claimOne.
 *
 * Exported as runYoutubeIngest and wired into the worker's JOBS array; the
 * job:youtube_ingest worker is what drains it.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
import { getLogger } from "@www/logger";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { mediaItem } from "../db/schema";
import { env } from "../env";
import type { JobHandler } from "../jobs/queue";

const execFileAsync = promisify(execFile);

/** Payload written by playlist-poller when enqueueing youtube_ingest jobs. */
interface YoutubeIngestPayload {
  mediaItemId: string;
  videoId: string;
}

/**
 * Download one video (audio is inside the muxed container) plus its thumbnail.
 *
 * YouTube serves video and audio as separate DASH streams above 360p; the `+`
 * in the selector makes ffmpeg mux them into one file. AV1 is preferred as the
 * most efficient codec YouTube serves; the fallback after `/` is a pre-combined
 * stream. We never re-encode -- both paths are stream copies.
 *
 * The output template is archival rather than machine-keyed: the DB keeps the
 * video id as identity, while the filename serves whoever browses the NAS in
 * VLC a year from now. Because that template includes a subdirectory, we ask
 * yt-dlp for the exact path it wrote instead of globbing for it.
 *
 * @public - exported for unit testing so tests can mock the subprocess
 */
export async function ytdlpDownload(
  videoId: string,
  storageDir: string,
  signal: AbortSignal,
): Promise<{ videoPath: string; thumbPath: string | null }> {
  const output = `${storageDir}/%(uploader)s/%(upload_date)s - %(title)s [%(id)s].%(ext)s`;

  const { stdout } = await execFileAsync(
    "yt-dlp",
    [
      "-f",
      "bv*[vcodec^=av01][height<=1080]+ba/b[height<=1080]",
      "-N",
      "4", // concurrent DASH fragments -- the real throughput lever
      "--write-thumbnail",
      "--output",
      output,
      "--print",
      "after_move:filepath",
      "--no-simulate",
      "--quiet",
      "--no-warnings",
      `https://www.youtube.com/watch?v=${videoId}`,
    ],
    { signal },
  );

  const videoPath = stdout.trim().split("\n").filter(Boolean).pop();
  if (!videoPath) {
    throw new Error(`yt-dlp reported no output path for ${videoId}`);
  }
  if (!existsSync(videoPath)) {
    throw new Error(`yt-dlp reported a path that does not exist: ${videoPath}`);
  }

  return { videoPath, thumbPath: findThumbnailFor(videoPath) };
}

/**
 * Locate the thumbnail yt-dlp wrote alongside the video. --write-thumbnail uses
 * the same stem as the video file, so we look for that stem with an image
 * extension rather than globbing the whole directory.
 */
function findThumbnailFor(videoPath: string): string | null {
  const stem = videoPath.replace(/\.[^./]+$/, "");
  for (const ext of [".jpg", ".jpeg", ".png", ".webp"]) {
    if (existsSync(`${stem}${ext}`)) return `${stem}${ext}`;
  }
  return null;
}

/** Read file size in bytes; returns null if the file doesn't exist. */
function fileSizeBytes(path: string | null): number | null {
  if (!path) return null;
  try {
    return statSync(path).size;
  } catch {
    return null;
  }
}

/**
 * The actual youtube_ingest job handler, exported as runYoutubeIngest below.
 * Idempotent: exits early if the item is already 'ready'.
 *
 * The signal is threaded into every yt-dlp subprocess so a job that exceeds its
 * maxMs kills the download rather than leaving it running past the row's death.
 */
async function handleYoutubeIngest(rawPayload: unknown, signal: AbortSignal): Promise<void> {
  const payload = rawPayload as YoutubeIngestPayload;
  const { mediaItemId, videoId } = payload;

  // Load the item to check current state.
  const rows = await db.select().from(mediaItem).where(eq(mediaItem.id, mediaItemId)).limit(1);
  const item = rows[0];
  if (!item) {
    getLogger().error({ mediaItemId }, "media_item not found");
    throw new Error(`media_item not found: ${mediaItemId}`);
  }

  // Idempotency: if already complete, skip.
  if (item.status === "ready") {
    getLogger().debug({ mediaItemId, videoId }, "youtube_ingest skipped , already ready");
    return;
  }

  // Disk-space check is performed by the youtube_ingest JobSpec wrapper in the
  // worker app, before this handler is entered. Keeping it there rather than on
  // the shared cycle means a full NAS stops downloads without stopping `notify`.

  const storageDir = env.MEDIA_STORAGE_DIR;

  const downloadStart = performance.now();
  getLogger().info({ videoId }, "yt-dlp download start");
  const { videoPath, thumbPath } = await ytdlpDownload(videoId, storageDir, signal);
  const downloadMs = +(performance.now() - downloadStart).toFixed(1);

  const videoBytes = fileSizeBytes(videoPath);
  getLogger().info(
    { videoId, videoPath, videoBytes, durationMs: downloadMs },
    "yt-dlp download complete",
  );

  // Get duration from the file via yt-dlp --dump-json (already downloaded, so
  // this is metadata-only , no network). We tolerate failure here since the
  // file is already on disk.
  let durationSec: number | null = null;
  try {
    const { stdout } = await execFileAsync(
      "yt-dlp",
      ["--dump-json", "--no-playlist", `https://www.youtube.com/watch?v=${videoId}`],
      { signal },
    );
    const meta = JSON.parse(stdout) as { duration?: number };
    durationSec = typeof meta.duration === "number" ? Math.round(meta.duration) : null;
  } catch {
    // Non-fatal: duration will be null, which is acceptable.
    getLogger().warn({ videoId }, "yt-dlp --dump-json failed, duration will be null");
  }

  // Mark as ready and persist file metadata.
  await db
    .update(mediaItem)
    .set({
      status: "ready",
      videoPath,
      thumbPath: thumbPath ?? null,
      videoBytes: videoBytes ?? null,
      durationSec,
      updatedAt: new Date(),
    })
    .where(eq(mediaItem.id, mediaItemId));
}

/** The youtube_ingest job handler. Wired at the worker entrypoint. */
export const runYoutubeIngest: JobHandler = async (rawPayload, signal) => {
  await handleYoutubeIngest(rawPayload, signal);
};
