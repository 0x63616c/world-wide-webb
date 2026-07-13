/**
 * The frontend logger , the only module the rest of the app imports.
 *
 * Callers see `log.info("mounted", { tile })` and `log.child("tile:weather")`.
 * They do not know a ring buffer exists, that IndexedDB exists, or that a viewer
 * exists. Swapping the persistence layer changes nothing outside `lib/log/`.
 *
 * Shape follows docs/logging.md: the same info/warn/error vocabulary as the
 * backend's pino loggers, with a `source` binding playing the role of pino's
 * child bindings. §7 of that doc explicitly sanctions a dependency-free console
 * wrapper for the web app rather than pino's browser build , the ring, the store
 * and the viewer are the actual work either way, and the wall panel's bundle does
 * not need a logging library to gain a `child()` method.
 *
 * ALWAYS ON. Not gated behind a debug flag, because you cannot capture the crash
 * you did not anticipate behind a switch you turn on after it happens. The cost
 * is bounded by design: a log call is an array write plus a queue push, and the
 * only I/O is a batched flush on a timer.
 *
 * Level policy is the inverse of a server logger: EVERY level, including debug,
 * is captured. Filtering happens in the viewer, not at write time. On a
 * 100k-entry store the cost of keeping debug is ring space already paid for, and
 * the one time it is needed it will be there.
 */

import { LogRing } from "./ring";
import * as store from "./store";
import type { LogEntry, LogLevel } from "./types";

/** Flush cadence. Batched so the write path never touches IndexedDB. */
const FLUSH_INTERVAL_MS = 3_000;
/** Ceiling on a single entry's `data`, so one fat payload can't dominate the store. */
export const MAX_DATA_CHARS = 2_000;

const ring = new LogRing();
let queue: LogEntry[] = [];
let seq = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Boot stamp, fixed for the life of this page. Combined with `seq` it makes each
 * entry's key unique across reloads , without it, every reload would overwrite
 * the previous session's rows in IndexedDB (see types.ts).
 *
 * 14 digits covers epoch-ms until the year 5138; 8 digits covers 100M entries in
 * a single session, which a panel logging flat-out would take weeks to reach.
 */
const BOOT_STAMP = String(Date.now()).padStart(14, "0");

function makeId(n: number): string {
  return `${BOOT_STAMP}-${String(n).padStart(8, "0")}`;
}

// Live-tail subscribers (the viewer). Notified on write, coalesced by React.
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Snapshot of the in-memory tail, oldest first. Referentially stable per write. */
let snapshot: LogEntry[] = [];
let snapshotDirty = true;

export function getTail(): LogEntry[] {
  if (snapshotDirty) {
    snapshot = ring.toArray();
    snapshotDirty = false;
  }
  return snapshot;
}

/**
 * Truncate `data` to a bounded serialized size. Returns the value to store plus
 * whether it was clipped, so the viewer can say "truncated" instead of silently
 * showing a half object.
 */
function clampData(data: unknown): { data: unknown; truncated: boolean } {
  if (data === undefined) return { data: undefined, truncated: false };
  let json: string;
  try {
    json = JSON.stringify(data) ?? String(data);
  } catch {
    // Circular / non-serializable (DOM nodes, Errors with cycles).
    return { data: String(data), truncated: false };
  }
  if (json.length <= MAX_DATA_CHARS) return { data, truncated: false };
  return { data: `${json.slice(0, MAX_DATA_CHARS)}…`, truncated: true };
}

function write(level: LogLevel, source: string, msg: string, data?: unknown): void {
  const clamped = clampData(data);
  const n = seq++;
  const entry: LogEntry = {
    id: makeId(n),
    seq: n,
    ts: Date.now(),
    level,
    source,
    msg,
    ...(clamped.data === undefined ? {} : { data: clamped.data }),
    ...(clamped.truncated ? { truncated: true } : {}),
  };
  ring.push(entry);
  queue.push(entry);
  snapshotDirty = true;
  for (const cb of listeners) cb();
}

async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    await store.append(batch);
  } catch {
    // Persistence is best-effort. A failed flush must not throw into a timer or
    // a visibilitychange handler, and must not resurrect the batch , retrying a
    // batch that failed on quota would just fail again, forever.
  }
}

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
  /** A logger bound to a sub-source, e.g. log.child("tile:weather"). */
  child(source: string): Logger;
}

function makeLogger(source: string): Logger {
  return {
    debug: (msg, data) => write("debug", source, msg, data),
    info: (msg, data) => write("info", source, msg, data),
    warn: (msg, data) => write("warn", source, msg, data),
    error: (msg, data) => write("error", source, msg, data),
    child: (sub) => makeLogger(sub),
  };
}

export const log: Logger = makeLogger("app");

/**
 * Start the batched flush loop. Idempotent. Also flushes on visibilitychange and
 * pagehide, which are the last moments we get before a kiosk reload or the iPad
 * suspending the webview , without them, up to FLUSH_INTERVAL_MS of the most
 * interesting entries (the ones right before the crash) would never reach disk.
 */
export function startFlushing(): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const onHide = () => {
    if (document.visibilityState === "hidden") void flush();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", () => void flush());
}

/** Test seam. */
export function stopFlushing(): void {
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = null;
}

/** Force a flush now. The viewer calls this before reading history from IDB. */
export function flushNow(): Promise<void> {
  return flush();
}
