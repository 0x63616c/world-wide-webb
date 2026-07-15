/**
 * Native write-through mirror for the log store , the "escape hatch" the
 * store.ts header promises.
 *
 * WHY: the panel's WKWebView origin is an ordinary https origin (the shell
 * loads the hosted dashboard remotely), so ALL script-writable storage ,
 * IndexedDB included , lives under WebKit's ITP eviction rules, and
 * requestPersistence() is routinely denied in a webview. Native files written
 * through the Capacitor bridge are outside ITP's reach entirely. Every flushed
 * batch is appended here as JSONL, and if the IndexedDB store ever comes up
 * empty (evicted), boot restores history from the mirror.
 *
 * Pure no-op off-device (browser / Storybook / tests): every entry point
 * guards on the plugin being available. The @capacitor/filesystem import is
 * dynamic so the plugin code never loads in a plain browser session.
 *
 * Rotation: two generations (current + previous), each capped at
 * GENERATION_MAX_BYTES. When current fills, it becomes previous and a fresh
 * current starts. The mirror therefore holds the most recent ~128 MB of
 * history , it is disaster recovery for the recent past, not a byte-for-byte
 * replica of the 1 GB IndexedDB cap.
 *
 * Restore is idempotent by construction: entries are keyed on `id` and
 * store.append() uses put(), so re-importing lines that survived in IndexedDB
 * overwrites them with themselves.
 */

import type { LogEntry } from "./types";

const DIR = "cc-logs";
const CURRENT = `${DIR}/current.jsonl`;
const PREVIOUS = `${DIR}/previous.jsonl`;
const GENERATION_MAX_BYTES = 64 * 1024 * 1024;
/** Restore writes into IndexedDB in chunks so one transaction never holds 100k+ puts. */
const RESTORE_CHUNK = 5_000;

/**
 * The four Filesystem operations we use, plus the enum values we pass. Typed
 * locally so tests can inject a fake without the plugin present.
 */
export interface LogFilesystem {
  appendFile(opts: {
    path: string;
    directory: string;
    data: string;
    encoding: string;
  }): Promise<void>;
  readFile(opts: {
    path: string;
    directory: string;
    encoding: string;
  }): Promise<{ data: string | Blob }>;
  stat(opts: { path: string; directory: string }): Promise<{ size: number }>;
  getUri(opts: { path: string; directory: string }): Promise<{ uri: string }>;
  rename(opts: { from: string; to: string; directory: string; toDirectory: string }): Promise<void>;
  deleteFile(opts: { path: string; directory: string }): Promise<void>;
  mkdir(opts: { path: string; directory: string; recursive: boolean }): Promise<void>;
}

/** Directory.Data , the app's own container, backed up, never user-visible. */
const DATA = "DATA";
const UTF8 = "utf8";

// Resolved once. `null` = not native / plugin missing / init failed: mirror off.
let fsPromise: Promise<LogFilesystem | null> | null = null;
// Approximate size of current.jsonl, seeded from stat() and advanced per append,
// so rotation doesn't stat the file on every flush.
let currentBytes = 0;

async function loadFilesystem(): Promise<LogFilesystem | null> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("Filesystem")) return null;
    const { Filesystem } = await import("@capacitor/filesystem");
    return Filesystem as unknown as LogFilesystem;
  } catch {
    return null;
  }
}

async function init(fs: LogFilesystem): Promise<void> {
  try {
    await fs.mkdir({ path: DIR, directory: DATA, recursive: true });
  } catch {
    // Already exists , the only mkdir failure worth ignoring; a genuinely
    // unwritable container will surface on the first append instead.
  }
  try {
    currentBytes = (await fs.stat({ path: CURRENT, directory: DATA })).size;
  } catch {
    currentBytes = 0; // no current file yet
  }
}

function getFs(): Promise<LogFilesystem | null> {
  if (!fsPromise) {
    fsPromise = loadFilesystem().then(async (fs) => {
      if (fs) await init(fs);
      return fs;
    });
  }
  return fsPromise;
}

async function rotateIfFull(fs: LogFilesystem): Promise<void> {
  if (currentBytes < GENERATION_MAX_BYTES) return;
  try {
    await fs.deleteFile({ path: PREVIOUS, directory: DATA });
  } catch {
    // no previous generation to drop
  }
  await fs.rename({ from: CURRENT, to: PREVIOUS, directory: DATA, toDirectory: DATA });
  currentBytes = 0;
}

/**
 * Append a flushed batch to the native mirror. Best-effort: a mirror failure
 * must never fail the flush that also feeds IndexedDB.
 */
export async function nativeAppend(entries: LogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const fs = await getFs();
  if (!fs) return;
  try {
    await rotateIfFull(fs);
    const data = `${entries.map((e) => JSON.stringify(e)).join("\n")}\n`;
    await fs.appendFile({ path: CURRENT, directory: DATA, data, encoding: UTF8 });
    currentBytes += data.length;
  } catch {
    // Best-effort by contract , IndexedDB still has the batch.
  }
}

function parseLines(raw: string | Blob): LogEntry[] {
  if (typeof raw !== "string") return []; // utf8 encoding always yields string
  const out: LogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as LogEntry;
      if (typeof entry.id === "string" && typeof entry.ts === "number") out.push(entry);
    } catch {
      // A torn tail line from a mid-write kill is expected; skip it.
    }
  }
  return out;
}

async function readGeneration(fs: LogFilesystem, path: string): Promise<LogEntry[]> {
  try {
    const { data } = await fs.readFile({ path, directory: DATA, encoding: UTF8 });
    return parseLines(data);
  } catch {
    return []; // generation doesn't exist
  }
}

/**
 * If IndexedDB came up empty (WebKit evicted it), reload history from the
 * mirror , oldest generation first so store rotation, if it triggers, evicts
 * the right end. Returns the number of entries restored (0 = nothing to do).
 *
 * `isEmpty` / `append` are injected so this module drives the restore without
 * a static import cycle with store.ts (logger → native, boot → native → store
 * would otherwise meet logger → store).
 */
export async function restoreFromNative(
  isEmpty: () => Promise<boolean>,
  append: (entries: LogEntry[]) => Promise<void>,
): Promise<number> {
  const fs = await getFs();
  if (!fs) return 0;
  try {
    if (!(await isEmpty())) return 0;
    const entries = [
      ...(await readGeneration(fs, PREVIOUS)),
      ...(await readGeneration(fs, CURRENT)),
    ];
    for (let i = 0; i < entries.length; i += RESTORE_CHUNK) {
      await append(entries.slice(i, i + RESTORE_CHUNK));
    }
    return entries.length;
  } catch {
    return 0; // recovery is best-effort; an unreadable mirror is just absent
  }
}

/**
 * Resolve shareable file URIs for the on-disk mirror generations, oldest first
 * (`previous`, then `current`). This is the export seam: the OS reads these files
 * directly via the share sheet, so nothing is serialized at share time.
 *
 * Best-effort like the rest of the module: returns `[]` off-device (no fs), for
 * a generation that doesn't exist yet (stat throws → skipped), and on any
 * unexpected error, rather than throwing into the caller.
 */
export async function getMirrorFileUris(): Promise<string[]> {
  const fs = await getFs();
  if (!fs) return [];
  try {
    const uris: string[] = [];
    for (const path of [PREVIOUS, CURRENT]) {
      try {
        await fs.stat({ path, directory: DATA }); // missing generation throws
      } catch {
        continue; // generation doesn't exist yet
      }
      const { uri } = await fs.getUri({ path, directory: DATA });
      uris.push(uri);
    }
    return uris;
  } catch {
    return []; // export is best-effort; an unresolvable mirror is just absent
  }
}

/** Test seam: inject a fake Filesystem (or null to simulate off-device). */
export function setFilesystemForTests(fs: LogFilesystem | null): void {
  fsPromise = fs ? loadInjected(fs) : Promise.resolve(null);
}

async function loadInjected(fs: LogFilesystem): Promise<LogFilesystem | null> {
  await init(fs);
  return fs;
}

/** Test seam: forget the cached plugin handle. */
export function resetNativeForTests(): void {
  fsPromise = null;
  currentBytes = 0;
}
