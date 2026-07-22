/**
 * useLogTail , the single React seam onto the in-memory log ring.
 *
 * Every live-tail view (the Logs viewer, the Activity page's wake diagnostic)
 * needs the same three things: a snapshot under concurrent React, a re-render on
 * write, and no copying. `useSyncExternalStore` gives the first two and
 * `getTail()` is memoized behind a dirty flag for the third, so this is one line
 * , but it is a line that must be identical at every call site, which is exactly
 * what a hook is for. The ring is not a `createStore` singleton (it is a mutable
 * ring with a lazily-materialized snapshot, not replaced state), so this is the
 * sanctioned `useSyncExternalStore` outside `lib/store.ts`.
 */

import { useSyncExternalStore } from "react";
import { getTail, subscribe } from "./logger";
import type { LogEntry } from "./types";

/** The in-memory tail, oldest first. Referentially stable between writes. */
export function useLogTail(): LogEntry[] {
  return useSyncExternalStore(subscribe, getTail);
}
