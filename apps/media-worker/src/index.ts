/**
 * Media-worker app entrypoint (www-kp4k.2). A separate deployable image from
 * the main worker app — heavy/long downloads (90+ min sets) must not share a
 * container with the 1s light-enforcer loop. Isolated blast radius, different
 * resource profile, independent deploy cadence.
 *
 * Workers registered here:
 *   - queue-worker (2s): claims ONE job from the generic queue per tick, dispatches
 *     to the registered handler. youtube_ingest is the first handler.
 *   - playlist-poller (10m): for each enabled media_source, runs yt-dlp
 *     --flat-playlist and upserts any unseen video IDs as pending media_items.
 *
 * Domain (services, schema, env) lives in @repo/api and is imported via the
 * ./media barrel — the same seam pattern as apps/worker's ./worker barrel.
 */

import { statfsSync } from "node:fs";
import {
  claimAndRun,
  env,
  registerYoutubeIngestHandler,
  runMigrations,
  runPlaylistPollerCycle,
} from "@repo/api/media";

// Apply pending schema migrations before any worker cycle touches the DB.
await runMigrations();

// Register all job handlers before the queue-worker starts claiming.
// Handlers must be registered synchronously at startup — the queue-worker
// starts dispatching immediately after runtime.start().
registerYoutubeIngestHandler();

// Disk guard: check free space on the media storage volume before each download.
// Refuses downloads when free bytes fall below 10 GB to protect the NAS.
const DISK_FREE_THRESHOLD_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB

/**
 * Returns true if MEDIA_STORAGE_DIR has enough free space for a download.
 * Uses statfsSync to avoid spawning a subprocess; tolerates missing dir
 * (returns true — let the actual download fail with a clear error).
 */
export function hasSufficientDisk(
  dir: string = env.MEDIA_STORAGE_DIR,
  thresholdBytes: number = DISK_FREE_THRESHOLD_BYTES,
): boolean {
  try {
    const stats = statfsSync(dir);
    // bavail = blocks available to non-root; bsize = block size in bytes.
    const freeBytes = stats.bavail * stats.bsize;
    return freeBytes >= thresholdBytes;
  } catch {
    // statfsSync failed (dir doesn't exist yet, etc.) — don't block startup.
    return true;
  }
}

// Import the Worker framework from the same package (apps/media-worker owns the
// framework src since apps/worker co-locates runtime.ts + types.ts; we mirror
// that by importing from the relative path — both apps bundle their own copy).
import { createWorkerRuntime } from "./runtime";
import type { Worker } from "./types";

const workers: Worker[] = [
  {
    // Generic queue consumer: claims one job per tick and dispatches to its
    // registered handler. Tight loop (2s) so jobs are picked up promptly.
    // claimAndRun returns false when the queue is empty; the runtime's
    // await-before-reschedule ensures we don't spin-loop on an empty queue.
    name: "queue-worker",
    intervalMs: 2_000,
    runOnStart: true,
    run: async () => {
      // Check disk before claiming — a full NAS must not start a new download.
      // claimAndRun handles individual job dispatch; we guard at the worker level
      // so the guard applies to every claim regardless of handler.
      if (!hasSufficientDisk()) {
        console.warn("queue-worker: disk below threshold, skipping claim");
        return;
      }
      // Drain the queue (claim + run until empty or one failure).
      // Single-flight: the FOR UPDATE SKIP LOCKED in claimAndRun ensures two
      // media-worker replicas (if ever run) can't claim the same job.
      await claimAndRun();
    },
  },
  {
    // Playlist poller: every ~10 minutes, list each enabled media_source via
    // yt-dlp --flat-playlist, upsert unseen video IDs, enqueue ingest jobs.
    name: "playlist-poller",
    intervalMs: 10 * 60_000, // 10 minutes
    runOnStart: true,
    run: runPlaylistPollerCycle,
  },
];

const runtime = createWorkerRuntime(workers);
runtime.start();

console.warn(
  `Media-worker started (env=${env.NODE_ENV}); workers: ${workers.map((w) => w.name).join(", ")}`,
);

// Graceful shutdown: stop scheduling new cycles so Swarm can replace the task
// without an in-flight download racing the kill signal.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.warn(`Media-worker received ${signal}; stopping runtime`);
    runtime.stop();
    process.exit(0);
  });
}
