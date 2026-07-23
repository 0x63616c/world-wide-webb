/**
 * Thin binder over the generic durable job queue now owned by @www/core (S1).
 * apps/api's own producers (media.ts, playlist-poller-service.ts), its tests,
 * and the `@control-center/api/worker` barrel all keep importing from this
 * path with their pre-move signatures , the db is bound here once instead of
 * threaded through every call site.
 */
import * as core from "@www/core";
import { db } from "../db/index";

export type { JobHandler, JobSpec } from "@www/core";

// Interim registry augmentation (S1 commit 1). `notify` is registered here only
// until commit 2 moves the Notification Center into features/notif (it deletes
// this line atomically with the service move); `youtube_ingest` stays here
// through Wave 6 (media is not folded yet). Placement matters: worker-deps.ts
// re-exports through this file, so `youtube_ingest` reaches the apps/worker
// program transitively via the `@control-center/api/worker` barrel.
declare module "@www/core" {
  interface JobTypeRegistry {
    notify: { notificationId: string };
    youtube_ingest: { mediaItemId: string; videoId: string };
  }
}

export function enqueueJob<T extends core.JobType>(
  type: T,
  payload: core.JobPayload<T>,
  opts?: core.EnqueueOptions,
): Promise<number> {
  return core.enqueueJob(db, type, payload, opts);
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
