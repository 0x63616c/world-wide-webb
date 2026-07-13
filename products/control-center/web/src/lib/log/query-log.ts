/**
 * React Query cache logging.
 *
 * The tRPC link (trpc-link.ts) records the HTTP truth: what went over the wire
 * and what came back. This records the app-state truth: which query is now in an
 * error state, how many times it has retried, when it recovered. Those are
 * different questions, and "Can't connect" is a function of the second one ,
 * `useConnectionStatus` derives the banner purely from cache status.
 *
 * Together they let the log read, in order:
 *
 *   trpc  weather.current failed  { httpStatus: 502, ms: 41 }
 *   query weather.current -> error (failureCount: 3)
 *   conn  online -> lost          { failing: ["weather.current", ...] }
 *
 * which is the causal chain the banner cannot currently tell you.
 *
 * Only transitions are logged, never steady state: a dashboard that polls would
 * otherwise fill the buffer with "still fine" lines.
 */

import type { Query, QueryClient } from "@tanstack/react-query";
import { log } from "./logger";

const queryLog = log.child("query");

/** tRPC query keys are [[ "weather", "current" ], { ... }] , flatten to a path. */
function keyOf(query: Query): string {
  const [path] = query.queryKey as [unknown];
  if (Array.isArray(path)) return path.join(".");
  return JSON.stringify(query.queryKey);
}

function errorOf(query: Query): unknown {
  const err = query.state.error;
  if (err instanceof Error) return { name: err.name, message: err.message };
  return err === null ? undefined : { value: String(err) };
}

/**
 * Subscribe to the cache and log every status transition. Returns an unsubscribe
 * fn. Called once at boot, not from a component , the point is to be recording
 * before anything renders.
 */
export function installQueryLogging(queryClient: QueryClient): () => void {
  const lastStatus = new Map<string, string>();

  return queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated") return;
    const query = event.query;
    const key = keyOf(query);
    const status = query.state.status;
    const previous = lastStatus.get(key);
    if (previous === status) return;
    lastStatus.set(key, status);

    if (status === "error") {
      queryLog.warn(`${key} -> error`, {
        failureCount: query.state.fetchFailureCount,
        error: errorOf(query),
      });
      return;
    }
    if (status === "success" && previous === "error") {
      queryLog.info(`${key} -> recovered`);
    }
  });
}

/** The query keys currently in an error state , the "why" behind the banner. */
export function failingQueryKeys(queryClient: QueryClient): string[] {
  return queryClient
    .getQueryCache()
    .getAll()
    .filter((q) => q.state.status === "error")
    .map(keyOf);
}
