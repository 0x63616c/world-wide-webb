/**
 * Durable log history , IndexedDB.
 *
 * Why this exists at all: the native kiosk shell (web/ios/App/App) runs a
 * KioskWatchdog that reloads the webview when the dashboard stops responding.
 * Every failure the panel already automates around therefore destroys the
 * in-memory ring. Without a persistent layer the logs would be systematically
 * empty for exactly the incidents worth reading about.
 *
 * Written with the raw IndexedDB API rather than a wrapper: the surface we need
 * is four operations, and the web bundle ships to a wall panel where a new
 * runtime dependency has to earn its place.
 *
 * Rotation evicts on BOTH entry count and total bytes, whichever trips first.
 * Count-only eviction is how you discover the disk filled up, because a single
 * fat payload can be thousands of times larger than a typical line. `bytes` is
 * carried per record and the running total is kept in a meta record written in
 * the SAME transaction as every append/prune, so the two cannot drift apart
 * across a crash.
 *
 * Storage durability caveat: the Capacitor shell loads REMOTE content
 * (capacitor.config.ts `server.url` -> the hosted dashboard) rather than a
 * bundled local scheme, so the WKWebView origin is an ordinary https origin and
 * WebKit's 7-day cap on script-writable storage applies to it. Daily use of the
 * panel keeps resetting that clock, and requestPersistence() asks WebKit to
 * exempt us outright, but neither is a guarantee. If history is ever observed
 * evaporating, the escape hatch is writing through the Capacitor bridge to
 * native storage, which ITP does not touch.
 */

import type { LogEntry, LogLevel } from "./types";
import { LEVEL_RANK } from "./types";

const DB_NAME = "cc-logs";
// v2: the entries store was re-keyed from the per-session `seq` to the
// boot-scoped `id`. A v1 database left in place would keep the old keyPath and
// go on overwriting each reload's history, so the upgrade drops and rebuilds it.
// Discarding the old rows is fine , they are debug logs, and a v1 store by
// definition only ever held the current session anyway.
const DB_VERSION = 2;
const ENTRIES = "entries";
const META = "meta";
const META_KEY = "stats";

/** Hard caps. Whichever trips first drives eviction. */
export const MAX_ENTRIES = 100_000;
export const MAX_BYTES = 50 * 1024 * 1024; // ~50 MB

/** Evict in chunks so a single append doesn't walk the whole store. */
const PRUNE_SLACK = 2_000;

interface Stats {
  bytes: number;
}

export interface LogQuery {
  /** Minimum level, inclusive. Omit for all levels. */
  minLevel?: LogLevel;
  /** Exact source match. Omit for all sources. */
  source?: string;
  /** Case-insensitive substring match against msg + serialized data. */
  search?: string;
  /** Page backwards: return entries older than this entry id. */
  before?: string;
  /** Max entries to return. Defaults to 200. */
  limit?: number;
}

// A failed open (private mode, quota, corrupt db) must never take the app down:
// logging is the diagnostic layer, not a feature. We degrade to ring-only and
// remember the failure so we don't retry on every flush.
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      // Unconditionally drop and rebuild. An earlier version of this guarded the
      // drop on inspecting the existing store's keyPath via req.transaction ,
      // which can be null, in which case the guard silently skipped the
      // migration and left the old store (and the overwrite bug) in place. A
      // migration that quietly does nothing is worse than no migration. These
      // are debug logs: rebuilding costs nothing, so there is no reason to be
      // clever about preserving them.
      if (db.objectStoreNames.contains(ENTRIES)) db.deleteObjectStore(ENTRIES);
      {
        // keyPath "id" = "<bootMs>-<counter>", fixed-width and zero-padded, so
        // lexicographic key order IS insertion order across reloads. Keying on
        // the per-session `seq` instead would make every reload overwrite the
        // previous session's rows (see types.ts).
        const store = db.createObjectStore(ENTRIES, { keyPath: "id" });
        store.createIndex("ts", "ts");
        store.createIndex("level", "level");
      }
      if (!db.objectStoreNames.contains(META)) {
        db.createObjectStore(META);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Approximate on-disk cost of an entry. Cheap and good enough to drive eviction. */
export function entryBytes(entry: LogEntry): number {
  let n = 64; // seq/ts/level/flags overhead
  n += entry.source.length * 2;
  n += entry.msg.length * 2;
  if (entry.data !== undefined) {
    try {
      n += JSON.stringify(entry.data).length * 2;
    } catch {
      n += 256;
    }
  }
  return n;
}

/**
 * Ask the browser to exempt our origin from storage eviction. WebKit grants this
 * heuristically and may simply say no, hence best-effort , see the ITP note at
 * the top of this file.
 */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Append a batch. Rotation runs in the same transaction, so caps always hold. */
export async function append(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  if (!db) return;

  const tx = db.transaction([ENTRIES, META], "readwrite");
  const store = tx.objectStore(ENTRIES);
  const meta = tx.objectStore(META);

  const stats = ((await promisify(meta.get(META_KEY))) as Stats | undefined) ?? { bytes: 0 };
  let bytes = stats.bytes;

  for (const entry of entries) {
    store.put(entry);
    bytes += entryBytes(entry);
  }

  let count = await promisify(store.count());

  // Evict oldest-first until both caps hold. Cursor order == seq order ==
  // insertion order, so "oldest" is simply the front of the store.
  if (count > MAX_ENTRIES || bytes > MAX_BYTES) {
    const targetCount = Math.max(0, MAX_ENTRIES - PRUNE_SLACK);
    const targetBytes = MAX_BYTES * 0.9;
    await new Promise<void>((resolve, reject) => {
      const cursorReq = store.openCursor();
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve();
          return;
        }
        if (count <= targetCount && bytes <= targetBytes) {
          resolve();
          return;
        }
        bytes -= entryBytes(cursor.value as LogEntry);
        count -= 1;
        cursor.delete();
        cursor.continue();
      };
    });
  }

  meta.put({ bytes: Math.max(0, bytes) } satisfies Stats, META_KEY);
  await txDone(tx);
}

function matches(entry: LogEntry, q: LogQuery): boolean {
  if (q.minLevel && LEVEL_RANK[entry.level] < LEVEL_RANK[q.minLevel]) return false;
  if (q.source && entry.source !== q.source) return false;
  if (q.search) {
    const needle = q.search.toLowerCase();
    if (entry.msg.toLowerCase().includes(needle)) return true;
    if (entry.source.toLowerCase().includes(needle)) return true;
    if (entry.data === undefined) return false;
    try {
      return JSON.stringify(entry.data).toLowerCase().includes(needle);
    } catch {
      return false;
    }
  }
  return true;
}

/**
 * Page backwards through history, newest first. Filters are applied while
 * walking the cursor so we never materialize 100k entries to throw most away.
 */
export async function query(q: LogQuery = {}): Promise<LogEntry[]> {
  const db = await openDb();
  if (!db) return [];
  const limit = q.limit ?? 200;
  const range =
    q.before !== undefined ? IDBKeyRange.upperBound(q.before, /* open */ true) : undefined;

  const tx = db.transaction(ENTRIES, "readonly");
  const store = tx.objectStore(ENTRIES);

  return new Promise<LogEntry[]>((resolve, reject) => {
    const out: LogEntry[] = [];
    // "prev": descending seq, i.e. newest first.
    const cursorReq = store.openCursor(range ?? null, "prev");
    cursorReq.onerror = () => reject(cursorReq.error);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor || out.length >= limit) {
        resolve(out);
        return;
      }
      const entry = cursor.value as LogEntry;
      if (matches(entry, q)) out.push(entry);
      cursor.continue();
    };
  });
}

/** Entry count. Used by the viewer's footer and by tests. */
export async function count(): Promise<number> {
  const db = await openDb();
  if (!db) return 0;
  const tx = db.transaction(ENTRIES, "readonly");
  return promisify(tx.objectStore(ENTRIES).count());
}

/** Drop all history. Exposed in the viewer so a panel can be reset in the field. */
export async function clear(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const tx = db.transaction([ENTRIES, META], "readwrite");
  tx.objectStore(ENTRIES).clear();
  tx.objectStore(META).put({ bytes: 0 } satisfies Stats, META_KEY);
  await txDone(tx);
}

/** Test seam: forget the cached handle so a fresh fake-indexeddb can be opened. */
export function resetForTests(): void {
  dbPromise = null;
}
