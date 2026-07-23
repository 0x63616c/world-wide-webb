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

// Registry augmentation for the one queue producer still hand-wired in
// apps/api: `youtube_ingest` (media is not folded until Wave 6). `notify`
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
