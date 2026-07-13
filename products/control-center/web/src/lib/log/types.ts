/**
 * The wire shape of a frontend log entry, shared by the ring buffer, the
 * IndexedDB store, and the viewer.
 *
 * `id` is the IndexedDB primary key and MUST be unique across page loads, not
 * just within one. A per-session counter is not: it restarts at 0 on every
 * reload, so the new session's rows would overwrite the previous session's row
 * for row, and the store would only ever hold the current session , destroying
 * precisely the history this layer exists to keep (the kiosk watchdog reloads
 * the webview on failure, so the interesting boot is always the *previous* one).
 *
 * So `id` is "<boot timestamp>-<counter>", both zero-padded to fixed width. That
 * makes it unique per boot AND lexicographically sortable, so an IndexedDB
 * cursor still walks entries in insertion order and paging backwards is a plain
 * key range. `seq` stays as the within-session counter, used for ordering inside
 * the ring where sorting strings would be silly.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  /** Globally unique, sortable: `${bootMs}-${seq}`, both zero-padded. IDB key. */
  id: string;
  /** Within-session counter. Not unique across reloads , see `id`. */
  seq: number;
  ts: number;
  /**
   * Short git SHA of the code that emitted this line.
   *
   * Carried per ENTRY, not just once at boot, because history outlives deploys:
   * the panel updates over the air (capacitor.config.ts points at the hosted
   * dashboard), so a large store routinely spans several deploys. Without this,
   * "the bug started happening" and "we shipped that afternoon" are two facts you
   * cannot line up. It also means a line can be blamed on a commit after the
   * fact, which is the whole point of keeping history.
   */
  sha: string;
  level: LogLevel;
  /** Subsystem tag, e.g. "boot", "trpc", "query", "tile:weather", "console". */
  source: string;
  msg: string;
  /** Structured payload. Truncated to MAX_DATA_BYTES; see `truncated`. */
  data?: unknown;
  /** Set when `data` was clipped, so the viewer can say so rather than lie. */
  truncated?: boolean;
}
