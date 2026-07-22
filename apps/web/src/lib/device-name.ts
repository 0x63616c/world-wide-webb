/**
 * Per-device name , a dependency-light singleton store for the human-readable
 * name this particular panel/browser carries (e.g. "iPad", "Calum's Laptop").
 *
 * Mirrors the useSyncExternalStore shape of lib/settings.ts and
 * lib/useNotifications.ts (module-level state + a listener set + a hook), so the
 * settings input, the "please set your name" banner, and the logger all read one
 * live source of truth without prop-drilling.
 *
 * DELIBERATELY NOT part of lib/settings.ts. That store is GLOBAL: every write
 * goes through a server sink and syncs to every wall panel. The device name is
 * the opposite , it is strictly per-device and must never leave the browser, so
 * it lives in its own local-only store with no server sink.
 *
 * Two localStorage keys, on purpose (a separate-key design, not a sentinel):
 *   - `cc-device-name`      the USER-set name. Absent until the user explicitly
 *                           sets one; its presence (non-empty) is the sole
 *                           "user has chosen a name" signal.
 *   - `cc-device-name-auto` the derived default, persisted once so the effective
 *                           name is stable across reloads even if UA parsing
 *                           later changes.
 * The effective name (used for logs + display) is the user value if set, else
 * the auto default , so it is never empty, while "user has not chosen one" stays
 * independently detectable for the banner.
 *
 * MUST NOT statically import log/logger.ts: the logger imports getDeviceName()
 * to stamp every line, so a static import back would form a cycle. (A lazy
 * dynamic import inside a setter would be fine, but we do not log name changes.)
 */

import { createStore, useStore } from "./store";

const USER_KEY = "cc-device-name";
const AUTO_KEY = "cc-device-name-auto";

/** Honest last resort when there is no UA to derive from (SSR / locked-down env). */
const UNKNOWN_DEVICE = "unknown-device";

// ─── best-effort localStorage IO (guarded , SSR/tests/private-mode Safari) ─────

function readRaw(key: string): string | null {
  try {
    return window.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // persistence is best-effort (blocked / full store)
  }
}

function removeRaw(key: string): void {
  try {
    window.localStorage?.removeItem(key);
  } catch {
    // best-effort
  }
}

function readNavigator(): { userAgent: string; platform: string } {
  try {
    return {
      userAgent: navigator.userAgent ?? "",
      // `platform` is deprecated but still the most reliable iPad/Mac hint on
      // WebKit; a missing value simply drops out of the haystack below.
      platform: navigator.platform ?? "",
    };
  } catch {
    return { userAgent: "", platform: "" };
  }
}

// ─── default derivation (pure, deterministic, unit-testable) ───────────────────

function detectOs(haystack: string): string {
  if (/Android/i.test(haystack)) return "Android";
  if (/CrOS/i.test(haystack)) return "ChromeOS";
  if (/Windows/i.test(haystack)) return "Windows";
  if (/Mac OS X|Macintosh|MacIntel/i.test(haystack)) return "macOS";
  if (/Linux/i.test(haystack)) return "Linux";
  return "";
}

function detectBrowser(ua: string): string {
  // Order matters: Edge/Opera masquerade as Chrome, Chrome masquerades as Safari.
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\/|Opera/.test(ua)) return "Opera";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "";
}

/**
 * A short, readable slug from the user agent + platform, e.g. "iPad", "iPhone",
 * "Chrome-macOS". Pure: the navigator values default in but can be passed for
 * tests. Never empty , falls back to `unknown-device` when nothing is known.
 */
export function deriveDefaultName(
  ua: string = readNavigator().userAgent,
  platform: string = readNavigator().platform,
): string {
  const haystack = `${ua} ${platform}`;
  if (/iPad/i.test(haystack)) return "iPad";
  if (/iPhone/i.test(haystack)) return "iPhone";
  if (/iPod/i.test(haystack)) return "iPod";

  const os = detectOs(haystack);
  const browser = detectBrowser(ua);
  if (browser && os) return `${browser}-${os}`;
  if (os) return os;
  if (browser) return browser;
  return UNKNOWN_DEVICE;
}

// ─── singleton store ───────────────────────────────────────────────────────────

/**
 * The effective name is read on EVERY log write, so it is cached in a module var
 * and only recomputed when the user sets/clears the name. `null` = not yet
 * computed (recompute on next read).
 */
let cache: string | null = null;

function resolveAuto(): string {
  const stored = readRaw(AUTO_KEY);
  if (stored?.trim()) return stored;
  // Generate + persist the auto default on first read so it stays stable across
  // reloads (req: sensible default that does not drift with UA-parser changes).
  const derived = deriveDefaultName() || UNKNOWN_DEVICE;
  writeRaw(AUTO_KEY, derived);
  return derived;
}

function resolveName(): string {
  const user = readRaw(USER_KEY);
  if (user?.trim()) return user;
  return resolveAuto();
}

/** Effective name: user value if set, else the persisted auto default. Cheap (cached). */
export function getDeviceName(): string {
  if (cache !== null) return cache;
  cache = resolveName();
  return cache;
}

/** True iff the user has explicitly set a non-empty name (drives the banner). */
export function isDeviceNameSet(): boolean {
  const user = readRaw(USER_KEY);
  return Boolean(user?.trim());
}

/**
 * Set (or, with empty/whitespace input, clear) the user name. Clearing reverts
 * the effective name to the auto default and re-shows the banner.
 */
export interface DeviceNameState {
  name: string;
  isSet: boolean;
}

function snapshotNow(): DeviceNameState {
  return { name: getDeviceName(), isSet: isDeviceNameSet() };
}

// Recomputed only on a real write so useStore consumers get a referentially
// stable snapshot between changes (no re-render storm on unrelated updates).
const store = createStore<DeviceNameState>(snapshotNow());

export function setDeviceName(name: string): void {
  if (name.trim()) {
    writeRaw(USER_KEY, name);
  } else {
    removeRaw(USER_KEY);
  }
  cache = null; // recompute lazily on next getDeviceName()
  store.set(snapshotNow());
}

/**
 * Subscribe to the live device name. `name` is the effective name (never empty);
 * `isSet` is whether the user has chosen one. Setters are module-level exports.
 */
export function useDeviceName(): DeviceNameState {
  return useStore(store);
}

/** Test seam: forget the cached name + snapshot so a test can start clean. */
export function resetDeviceNameForTests(): void {
  cache = null;
  store.set(snapshotNow());
}
