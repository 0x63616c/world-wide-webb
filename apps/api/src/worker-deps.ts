/**
 * Barrel of everything the worker app (@control-center/worker) needs from the
 * api domain (www-xjba): today, just the migrator, re-exported through the
 * `@control-center/api/worker` subpath. Domain cycles are App-owned and reach
 * the worker through features/_generated/workers.gen.ts.
 *
 * The durable job queue that used to be re-exported here is gone (The
 * Simplification §3): no feature declared a `jobs.ts` facet any more once
 * weather's retention purge became a plain worker cycle, so the queue, its
 * workers and the `job` table were deleted rather than kept running empty.
 *
 * No env re-export and no hydrate side-effect import here: the worker hydrates
 * via its own pinned `./boot-env` (apps/worker/src/index.ts) and reads config
 * directly from `@www/platform/env`.
 */

export { runMigrations } from "./db/migrate";
