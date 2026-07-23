/**
 * Thin binder over the generic durable job queue now owned by @www/core (S1).
 * apps/api's tests and the `@control-center/api/worker` barrel keep importing
 * from this path with their pre-move signatures , the db is bound here once
 * instead of threaded through every call site. `enqueueJob` itself is NOT
 * re-exported here: apps/api no longer enqueues (the last producer,
 * playlist-poller/addUrls, moved into features/sound in the media split,
 * Track C Wave 6, calling core.enqueueJob directly with the feature's own db).
 */
import * as core from "@www/core";
import { db } from "../db/index";

export type { JobHandler, JobSpec } from "@www/core";

// Registry augmentation for the one queue producer still hand-wired in
// apps/api: `youtube_ingest` (the app-level job HANDLER; the producer moved
// into features/sound, Wave 6, which carries its own copy of this
// augmentation for programs that don't compile this file). `notify`
// registered here through S1 commit 1; relocated to features/notif/jobs.ts +
// service.ts in commit 2 (this line deleted atomically with the service move).
// Placement matters: worker-deps.ts re-exports through this file, so
// `youtube_ingest` reaches the apps/worker program transitively via the
// `@control-center/api/worker` barrel.
declare module "@www/core" {
  interface JobTypeRegistry {
    youtube_ingest: { mediaItemId: string; videoId: string };
  }
}

export function releaseInFlightJobsWithTimeout(timeoutMs?: number): Promise<number> {
  return core.releaseInFlightJobsWithTimeout(db, timeoutMs);
}

export function jobWorker(spec: core.JobSpec): ReturnType<typeof core.jobWorker> {
  return core.jobWorker(db, spec);
}

export function staleJobReaper(
  specs: readonly core.JobSpec[],
): ReturnType<typeof core.staleJobReaper> {
  return core.staleJobReaper(db, specs);
}
