/**
 * Wall-panel settings , a singleton external store for the small set of
 * preferences the settings panel still edits: the PIN, the accent colour, and
 * the panel's time zone. Mirrors useNotifications.ts: one module-level state
 * object, a listener set, and useSyncExternalStore, so any component reads the
 * same live values without prop-drilling or a state library.
 *
 * Persistence follows the board's `cc-*` localStorage convention: every write
 * is best-effort and guarded, since localStorage is absent in SSR/test envs and
 * throws in private-mode Safari.
 *
 * Everything the panel used to expose as a knob , brightness, dim timings, the
 * snap mode, the minimap, the PIN-pad layout, the typeface , is now a constant.
 * The ones the board still needs are exported from here (see IDLE_DIM_* below)
 * so there is one place that states them.
 */

import { ACCENTS, type Accent, DEFAULT_TIME_ZONE, SETTINGS_DEFAULTS } from "@cc/api/settings";
import { createStore, useStore } from "./store";

// ─── hardcoded panel behaviour ────────────────────────────────────────────────
// Idle dimming is always on: the panel dims one minute after the last touch and
// drops the backlight to 30%. These were sliders; nobody moved them off these
// values, and a wall panel that can be configured into never dimming is a worse
// panel, not a more flexible one.

/** Idle window before the session ends and the panel dims, in ms. */
export const IDLE_DIM_TIMEOUT_MS = 60_000;
/** Dim target, as a 0..1 brightness fraction. */
export const IDLE_DIM_LEVEL = 0.3;
/** Awake backlight the panel holds, overriding the OS slider. */
export const ACTIVE_BRIGHTNESS = 1;

// ─── settings shape ───────────────────────────────────────────────────────────

export interface Settings {
  /** Synced 6-digit PIN gating Settings + PIN-gated detail pages (e.g.
   *  Activity); the gates are always on.
   *  NOT auth , purely a frontend soft-lock. Exactly 6 digits; default "000000". */
  pinCode: string;
  /** The single highlight colour the board is built around (see lib/accent.ts).
   *  Synced, not device-local: the accent is how the installation looks, not a
   *  property of one panel. */
  accent: Accent;
  /** IANA zone used for panel-facing dates and day boundaries. */
  timeZone: string;
}

export const PIN_LENGTH = 6;
export const DEFAULT_PIN = SETTINGS_DEFAULTS.pinCode;

const DEFAULTS: Settings = {
  pinCode: SETTINGS_DEFAULTS.pinCode,
  accent: SETTINGS_DEFAULTS.accent,
  timeZone: SETTINGS_DEFAULTS.timeZone,
};

const KEYS = {
  pinCode: "cc-pin-code",
  accent: "cc-accent",
  timeZone: "cc-time-zone",
} as const;

// ─── best-effort localStorage IO ──────────────────────────────────────────────

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
    // ignore , persistence is best-effort (blocked/full store)
  }
}

function loadInitial(): Settings {
  const pin = readRaw(KEYS.pinCode);
  const accent = readRaw(KEYS.accent);
  const timeZone = readRaw(KEYS.timeZone);
  return {
    pinCode: pin && /^\d{6}$/.test(pin) ? pin : DEFAULTS.pinCode,
    accent:
      accent && (ACCENTS as readonly string[]).includes(accent)
        ? (accent as Accent)
        : DEFAULTS.accent,
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE,
  };
}

// ─── singleton store ──────────────────────────────────────────────────────────

const store = createStore<Settings>(loadInitial());

// Optional server sink: the sync hook (useSettingsSync) registers a pusher so a
// user edit also persists globally, syncing across every wall panel. Null when
// unmounted / in tests , the store then behaves local-only.
let serverSink: ((s: Settings) => void) | null = null;

/** Register the server pusher; returns an unregister fn. */
export function registerServerSink(fn: (s: Settings) => void): () => void {
  serverSink = fn;
  return () => {
    if (serverSink === fn) serverSink = null;
  };
}

function shallowEqual(a: Settings, b: Settings): boolean {
  for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

// Replace state only when the value actually changes so useSyncExternalStore
// consumers don't re-render on no-op writes (referential stability). A user edit
// (patch) also pushes to the server sink so the change syncs to other panels.
function patch<K extends keyof Settings>(key: K, value: Settings[K], serialized: string): void {
  const state = store.get();
  if (state[key] === value) return;
  const next = { ...state, [key]: value };
  writeRaw(KEYS[key], serialized);
  store.set(next);
  serverSink?.(next);
}

/** Drop explicitly-undefined keys so a spread cannot punch a hole in `state`. */
function stripUndefined(next: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

/**
 * Adopt authoritative settings from the server WITHOUT echoing back to it (no
 * sink call), used on load + each poll. Writes through to the localStorage cache
 * so an offline reload keeps the last-known global values.
 *
 * A field the response OMITS keeps this panel's current value rather than
 * falling back to its default. The two differ exactly during a deploy skew ,
 * web ships a new setting before the api knows the key, so `settings.get`
 * (a zod object, which strips what it has no key for) returns it missing, and
 * defaulting here would undo the user's choice on the next poll.
 */
export function hydrateSettings(next: Partial<Settings>): void {
  const state = store.get();
  const merged: Settings = { ...DEFAULTS, ...state, ...stripUndefined(next) };
  if (shallowEqual(state, merged)) return;
  for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
    writeRaw(KEYS[key], String(merged[key]));
  }
  store.set(merged);
}

// ─── setters (module-level, stable) ───────────────────────────────────────────

/** Set the synced PIN. No-op unless the input is exactly 6 digits , the schema
 *  guard, not auth (a wrong-format value never reaches storage or the server). */
export function setPinCode(pin: string): void {
  if (!/^\d{6}$/.test(pin)) return;
  patch("pinCode", pin, pin);
}

/** Set the board's highlight colour. The vars it drives are applied by
 *  lib/useAccentTheme, not here , this stays a plain store write. */
export function setAccent(accent: Accent): void {
  patch("accent", accent, accent);
}

function isValidTimeZone(value: string | null): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Set the shared IANA zone that defines panel-facing calendar dates. */
export function setTimeZone(timeZone: string): void {
  if (!isValidTimeZone(timeZone)) return;
  patch("timeZone", timeZone, timeZone);
}

/**
 * Reset every setting to its default and push the reset to the server sink so it
 * propagates to other panels (same path as a user edit).
 */
export function resetSettings(): void {
  if (shallowEqual(store.get(), DEFAULTS)) return;
  const next = { ...DEFAULTS };
  for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
    writeRaw(KEYS[key], String(DEFAULTS[key]));
  }
  store.set(next);
  serverSink?.(next);
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the live settings. Setters are module-level exports (stable
 * references), so components import them directly rather than reading them off
 * the hook return.
 */
export function useSettings(): Settings {
  return useStore(store);
}
