/**
 * time-suite localStorage IO , the ONE seam between the stores and their
 * persistence layer. Every store reads/writes its versioned `cc-*-v1` envelope
 * and follows cross-tab writes exclusively through here, so the eventual
 * DB-table + tRPC home (see the stores' persistence notes) swaps in by
 * replacing this module , the store APIs never move.
 *
 * All IO is best-effort and SSR-safe: a missing `window`, a blocked/full
 * store, or an unparseable value degrades to null / a silent no-op. Record
 * validation stays in each store , this layer only moves JSON.
 */

/** Parsed JSON under `key`, or null when absent/unreadable/unparseable. */
export function readJson(key: string): unknown {
  try {
    const raw = window.localStorage?.getItem(key) ?? null;
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

/** Persist `value` as JSON under `key`. Best-effort , failures are ignored. */
export function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // ignore , persistence is best-effort (blocked/full store)
  }
}

/**
 * Run `cb` whenever ANOTHER tab writes `key` (the `storage` event never fires
 * in the writing tab). Single-tab kiosk assumption: callers reload state with
 * NO cue evaluation , the writing tab already cued.
 */
export function onExternalWrite(key: string, cb: () => void): void {
  if (typeof window === "undefined") return;
  window.addEventListener("storage", (e) => {
    if (e.key !== key) return;
    cb();
  });
}
