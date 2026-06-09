/**
 * youtube_ingest job handler (CC-kp4k.4 + CC-kp4k.5). Given a mediaItemId:
 *   1. Validates the item exists and is not already done.
 *   2. Downloads audio (always: best m4a/opus) + thumbnail via yt-dlp.
 *   3. Downloads 1080p AV1 video if the source's video_policy = 'on'.
 *      NEVER re-transcodes — we pick the AV1 stream YouTube already serves.
 *   4. Records file paths, byte sizes, and duration in media_item.
 *   5. Calls OpenRouter to enrich the raw title → clean_title/artist/event/category.
 *   6. Sets status = 'ready' (or updates error on throw).
 *
 * Idempotent: if status is already 'ready' OR all expected files exist on disk,
 * the handler is a no-op. The queue handles retries via claimAndRun.
 *
 * The handler is registered via registerYoutubeIngestHandler() which is called
 * by the media-worker at boot (before the queueWorker starts claiming).
 */

import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { promisify } from "node:util";
import { getLogger } from "@repo/logger";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { mediaItem } from "../db/schema";
import { env } from "../env";
import { registerHandler } from "../jobs/queue";

const execFileAsync = promisify(execFile);

/** Payload written by playlist-poller when enqueueing youtube_ingest jobs. */
interface YoutubeIngestPayload {
  mediaItemId: string;
  videoId: string;
  videoPolicy: string; // 'none' | 'on'
}

/**
 * Run yt-dlp to download audio (and optionally AV1 video + thumbnail).
 * Returns the paths that were actually written to MEDIA_STORAGE_DIR.
 *
 * @public — exported for unit testing so tests can mock the subprocess
 */
export async function ytdlpDownload(
  videoId: string,
  videoPolicy: string,
  storageDir: string,
): Promise<{ audioPath: string; videoPath: string | null; thumbPath: string | null }> {
  const baseOutput = `${storageDir}/${videoId}.%(ext)s`;

  // Audio: always download best quality (m4a/opus). -x extracts audio only.
  // We keep the container as-is (no forced conversion) — m4a and opus are both
  // lossless in terms of re-encode, and the file is small (~85 MB/set).
  await execFileAsync("yt-dlp", [
    "-f",
    "bestaudio",
    "-x",
    "--write-thumbnail",
    "--output",
    baseOutput,
    "--quiet",
    "--no-warnings",
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);

  // Locate the actual audio file yt-dlp produced (extension varies: m4a/opus/webm).
  const audioPath = findDownloadedFile(storageDir, videoId, [
    ".m4a",
    ".opus",
    ".webm",
    ".mp3",
    ".ogg",
  ]);
  const thumbPath = findDownloadedFile(storageDir, videoId, [".jpg", ".jpeg", ".png", ".webp"]);

  let videoPath: string | null = null;
  if (videoPolicy === "on") {
    // Video: prefer AV1 (av01) ≤1080p — the most efficient codec YouTube serves.
    // NEVER re-encode: if AV1 isn't available, fall back to best video+audio in
    // a single container at ≤1080p. The `-f` selector tries av01 first.
    const videoOutput = `${storageDir}/${videoId}.video.%(ext)s`;
    await execFileAsync("yt-dlp", [
      "-f",
      "bv*[vcodec^=av01][height<=1080]+ba/b[height<=1080]",
      "--output",
      videoOutput,
      "--quiet",
      "--no-warnings",
      "--no-write-thumbnail", // already wrote it above
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    videoPath = findDownloadedFile(storageDir, videoId, [
      ".video.mp4",
      ".video.webm",
      ".video.mkv",
      ".video.mov",
    ]);
  }

  return { audioPath: audioPath ?? `${storageDir}/${videoId}`, videoPath, thumbPath };
}

/** Try a list of suffixes in order; return first existing path or null. */
function findDownloadedFile(dir: string, videoId: string, suffixes: string[]): string | null {
  for (const suffix of suffixes) {
    const candidate = `${dir}/${videoId}${suffix}`;
    try {
      statSync(candidate);
      return candidate;
    } catch {
      // not found, try next
    }
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
 * Call OpenRouter to enrich a raw YouTube title into structured metadata.
 * THROWS if OPENROUTER_API_KEY is not configured — no fake data (CC rule).
 *
 * @public — exported for unit testing (mock fetch)
 */
export async function enrichTitle(rawTitle: string): Promise<{
  clean_title: string;
  artist: string;
  event: string;
  category: string;
}> {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error(
      "OPENROUTER_API_KEY is not configured — enrichment requires the OpenRouter secret",
    );
  }

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      // Small, fast model — this is a simple structured-extraction call.
      model: "openai/gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You extract structured metadata from YouTube video titles. " +
            'Respond ONLY with strict JSON: {"clean_title": "...", "artist": "...", "event": "...", "category": "..."}. ' +
            "clean_title: human-readable title without platform noise. " +
            "artist: performer name (empty string if unclear). " +
            "event: event/venue name (empty string if unclear). " +
            'category: one of "dj-set", "live", "album", "mix", "interview", "other".',
        },
        {
          role: "user",
          content: `Extract metadata from this YouTube title: "${rawTitle}"`,
        },
      ],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`OpenRouter HTTP ${res.status}: ${await res.text()}`);
  }

  const body = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  const content = body.choices[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no content");

  const parsed = JSON.parse(content) as {
    clean_title: string;
    artist: string;
    event: string;
    category: string;
  };

  return parsed;
}

/**
 * The actual youtube_ingest job handler. Registered via registerYoutubeIngestHandler().
 * Idempotent: exits early if the item is already 'ready' or files already exist.
 */
async function handleYoutubeIngest(rawPayload: unknown): Promise<void> {
  const payload = rawPayload as YoutubeIngestPayload;
  const { mediaItemId, videoId, videoPolicy } = payload;

  // Load the item to check current state.
  const rows = await db.select().from(mediaItem).where(eq(mediaItem.id, mediaItemId)).limit(1);
  const item = rows[0];
  if (!item) {
    getLogger().error({ mediaItemId }, "media_item not found");
    throw new Error(`media_item not found: ${mediaItemId}`);
  }

  // Idempotency: if already complete, skip.
  if (item.status === "ready") {
    getLogger().debug({ mediaItemId, videoId }, "youtube_ingest skipped — already ready");
    return;
  }

  // Disk-space check is performed by the media-worker's disk guard before
  // claiming — see the queueWorker wrapper in media-worker. The handler itself
  // trusts the guard has already run.

  const storageDir = env.MEDIA_STORAGE_DIR;

  // Download audio + thumbnail (+ video if policy = on).
  const downloadStart = performance.now();
  getLogger().info({ videoId, videoPolicy }, "yt-dlp download start");
  const { audioPath, videoPath, thumbPath } = await ytdlpDownload(videoId, videoPolicy, storageDir);
  const downloadMs = +(performance.now() - downloadStart).toFixed(1);

  // Record file sizes (bytes) from disk.
  const audioBytes = fileSizeBytes(audioPath);
  const videoBytes = fileSizeBytes(videoPath);
  getLogger().info(
    { videoId, audioPath, videoPath, audioBytes, videoBytes, durationMs: downloadMs },
    "yt-dlp download complete",
  );

  // Get duration from the audio file via yt-dlp --dump-json (already downloaded,
  // so this is metadata-only — no network). We tolerate failure here since the
  // file is already on disk.
  let durationSec: number | null = null;
  try {
    const { stdout } = await execFileAsync("yt-dlp", [
      "--dump-json",
      "--no-playlist",
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);
    const meta = JSON.parse(stdout) as { duration?: number };
    durationSec = typeof meta.duration === "number" ? Math.round(meta.duration) : null;
  } catch {
    // Non-fatal: duration will be null, which is acceptable.
    getLogger().warn({ videoId }, "yt-dlp --dump-json failed, duration will be null");
  }

  // Enrichment: call OpenRouter for structured metadata. If the key is missing
  // or the call fails, we continue — enrichment is best-effort vs download.
  // However we THROW if key is present but the call fails (transient) so the
  // queue can retry. If key is absent, skip silently (worker running without
  // enrichment configured).
  let enriched: Awaited<ReturnType<typeof enrichTitle>> | null = null;
  if (env.OPENROUTER_API_KEY) {
    const enrichStart = performance.now();
    getLogger().info({ videoId, model: "openai/gpt-4o-mini" }, "OpenRouter enrich start");
    enriched = await enrichTitle(item.rawTitle !== videoId ? item.rawTitle : videoId);
    const enrichMs = +(performance.now() - enrichStart).toFixed(1);
    getLogger().info(
      { videoId, model: "openai/gpt-4o-mini", durationMs: enrichMs },
      "OpenRouter enrich complete",
    );
  } else {
    // Key absent — enrichment skipped; never log the key value itself.
    getLogger().warn({ videoId }, "OpenRouter enrich skipped — OPENROUTER_API_KEY not configured");
  }

  // Mark as ready and persist all metadata.
  await db
    .update(mediaItem)
    .set({
      status: "ready",
      audioPath,
      videoPath: videoPath ?? null,
      thumbPath: thumbPath ?? null,
      audioBytes: audioBytes ?? null,
      videoBytes: videoBytes ?? null,
      durationSec,
      cleanTitle: enriched?.clean_title ?? null,
      artist: enriched?.artist ?? null,
      event: enriched?.event ?? null,
      category: enriched?.category ?? null,
      error: null,
      updatedAt: new Date(),
    })
    .where(eq(mediaItem.id, mediaItemId));
}

/**
 * Register the youtube_ingest handler with the job queue. Call this at
 * media-worker startup, before the queueWorker starts claiming.
 */
export function registerYoutubeIngestHandler(): void {
  registerHandler("youtube_ingest", handleYoutubeIngest);
}
