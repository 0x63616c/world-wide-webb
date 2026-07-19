/**
 * Wall-panel settings , a singleton external store for the small set of
 * on-device preferences the settings gear panel edits (idle-dim behavior, the
 * FPS readout, the snap-mode experiment). Mirrors useNotifications.ts: one
 * module-level state object, a listener set, and useSyncExternalStore, so any
 * component (the panel, the board, the FPS meter, the idle-dim hook) reads the
 * same live values without prop-drilling or a state library.
 *
 * Persistence follows the board's existing `cc-*` localStorage convention
 * (loadSnapMode in Board.tsx): every write is best-effort and guarded, since
 * localStorage is absent in SSR/test envs and throws in private-mode Safari.
 */

import { useSyncExternalStore } from "react";
import { interaction } from "./log/interaction";
import { log } from "./log/logger";
import {
  type NotificationCategory,
  parseClock,
  parseMutedCategories,
  serializeMutedCategories,
  toggleMutedCategory,
} from "./notifications";

// Every panel setting that changes is a candidate explanation for "why is the
// board behaving like that" , cheap to record, and the alternative is guessing.
const settingsLog = log.child("settings");

// ─── snap-mode vocabulary (shared with Board) ─────────────────────────────────
// The board A/B-tests how it settles; the mode list + labels live here so both
// the board (which maps them to CSS scroll-snap) and the settings panel (which
// renders a picker) consume one source of truth. The CSS mapping itself stays
// in Board.tsx , it's a board-rendering concern.
export const SNAP_MODES = ["proximity", "mandatory", "mandatory-settle", "none", "spring"] as const;
export type SnapMode = (typeof SNAP_MODES)[number];
export const SNAP_MODE_LABEL: Record<SnapMode, string> = {
  proximity: "gentle",
  mandatory: "paged",
  "mandatory-settle": "paged+",
  none: "off",
  spring: "spring (old)",
};

// ─── settings shape + bounds ──────────────────────────────────────────────────

export interface Settings {
  /** Active (awake) backlight the panel drives itself, overriding whatever the
   *  OS brightness slider is set to. Clamped to [0.01, 1] (1%..100%). Idle
   *  dimming drops from here down to idleDimLevel. */
  activeBrightness: number;
  /** When true, the panel dims after the idle window; false disables dimming. */
  idleDimEnabled: boolean;
  /** Idle window before dimming, in ms. Clamped to [1min, 60min]. */
  idleDimTimeoutMs: number;
  /** Dim target as a 0..1 brightness fraction. Clamped to [0.01, 0.99]. */
  idleDimLevel: number;
  /** When true, the board glides back to the Clock after an idle window. */
  recenterEnabled: boolean;
  /** Idle window before recentering, in ms. Clamped to [1min, 60min]. */
  recenterTimeoutMs: number;
  /** Show the live FPS readout (top-right). */
  showFps: boolean;
  /** Show the build-hash + age badge (bottom-left). */
  showBuildBadge: boolean;
  /** Board settle feel (see SNAP_MODES). */
  snapMode: SnapMode;
  /** Show the board minimap (bottom-right). */
  showMinimap: boolean;
  /** Synced 6-digit PIN gating Settings + Wake photos (both gates always on).
   *  NOT auth , purely a frontend soft-lock. Exactly 6 digits; default "000000". */
  pinCode: string;
  /** Push notifications requested for THIS device. Drives the OS permission
   *  prompt + APNs token registration (lib/push.ts). Device-local by nature:
   *  a token belongs to one panel, so this must not sync across panels. */
  pushEnabled: boolean;
  /** Muted notification categories, comma-separated (e.g. "ci,media"). Encoded
   *  as a string because the store holds only primitives , parse/serialize via
   *  parseMutedCategories/serializeMutedCategories in lib/notifications.ts. */
  mutedCategories: string;
  /** When true, notifications raised inside the quiet window stay silent. */
  quietHoursEnabled: boolean;
  /** Quiet window start, "HH:MM" local. Wraps midnight when after the end. */
  quietHoursStart: string;
  /** Quiet window end, "HH:MM" local. */
  quietHoursEnd: string;
}

export const MIN_IDLE_TIMEOUT_MS = 60_000; // 1 min
export const MAX_IDLE_TIMEOUT_MS = 10 * 60_000; // 10 min
export const PIN_LENGTH = 6;
export const DEFAULT_PIN = "000000";
export const MIN_DIM_LEVEL = 0.01; // 1 %
export const MAX_DIM_LEVEL = 0.99; // 99 %
// Active brightness goes to a full 100% (unlike the dim level, which stays below
// full so "dimmed" always reads darker than "awake").
export const MIN_BRIGHTNESS = 0.01; // 1 %
export const MAX_BRIGHTNESS = 1; // 100 %

const DEFAULTS: Settings = {
  activeBrightness: 1,
  idleDimEnabled: true,
  idleDimTimeoutMs: 10 * 60_000,
  idleDimLevel: 0.25,
  recenterEnabled: true,
  recenterTimeoutMs: 10 * 60_000,
  showFps: false,
  showBuildBadge: true,
  snapMode: "mandatory-settle",
  showMinimap: true,
  pinCode: DEFAULT_PIN,
  pushEnabled: false,
  mutedCategories: "",
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
};

// `cc-board-snap-mode` is reused verbatim so an existing SnapModeSwitcher choice
// migrates into the store with no data loss.
const KEYS = {
  activeBrightness: "cc-active-brightness",
  idleDimEnabled: "cc-idle-dim-enabled",
  idleDimTimeoutMs: "cc-idle-dim-timeout-ms",
  idleDimLevel: "cc-idle-dim-level",
  recenterEnabled: "cc-recenter-enabled",
  recenterTimeoutMs: "cc-recenter-timeout-ms",
  showFps: "cc-show-fps",
  showBuildBadge: "cc-show-build-badge",
  snapMode: "cc-board-snap-mode",
  showMinimap: "cc-show-minimap",
  pinCode: "cc-pin-code",
  pushEnabled: "cc-push-enabled",
  mutedCategories: "cc-muted-categories",
  quietHoursEnabled: "cc-quiet-hours-enabled",
  quietHoursStart: "cc-quiet-hours-start",
  quietHoursEnd: "cc-quiet-hours-end",
} as const;

/**
 * Fields the SERVER does not know about, so a poll must never overwrite them.
 *
 * `settings.get` returns a zod-validated object; a field the API's schema has no
 * key for is simply absent from the response, and `hydrateSettings` would then
 * fold in the DEFAULT and wipe what the user just chose (within one 15s poll).
 * Listing a field here keeps hydration from touching it, so it behaves as a
 * device-local preference until (and unless) the API grows the same key.
 *
 * `pushEnabled` is device-local BY DESIGN, not merely pending: an APNs token
 * belongs to one panel, so "push on" can never be a global truth.
 */
const LOCAL_ONLY_KEYS = new Set<keyof Settings>([
  "pushEnabled",
  "mutedCategories",
  "quietHoursEnabled",
  "quietHoursStart",
  "quietHoursEnd",
]);

// ─── clamps ───────────────────────────────────────────────────────────────────

function clampIdleTimeoutMs(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULTS.idleDimTimeoutMs;
  return Math.min(MAX_IDLE_TIMEOUT_MS, Math.max(MIN_IDLE_TIMEOUT_MS, Math.round(ms)));
}

export function clampDimLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULTS.idleDimLevel;
  return Math.min(MAX_DIM_LEVEL, Math.max(MIN_DIM_LEVEL, level));
}

export function clampBrightness(level: number): number {
  if (!Number.isFinite(level)) return DEFAULTS.activeBrightness;
  return Math.min(MAX_BRIGHTNESS, Math.max(MIN_BRIGHTNESS, level));
}

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
  const brightness = readRaw(KEYS.activeBrightness);
  const enabled = readRaw(KEYS.idleDimEnabled);
  const timeout = readRaw(KEYS.idleDimTimeoutMs);
  const level = readRaw(KEYS.idleDimLevel);
  const fps = readRaw(KEYS.showFps);
  const snap = readRaw(KEYS.snapMode);
  const recenterEnabled = readRaw(KEYS.recenterEnabled);
  const recenterTimeout = readRaw(KEYS.recenterTimeoutMs);
  const buildBadge = readRaw(KEYS.showBuildBadge);
  const minimap = readRaw(KEYS.showMinimap);
  const pin = readRaw(KEYS.pinCode);
  const push = readRaw(KEYS.pushEnabled);
  const muted = readRaw(KEYS.mutedCategories);
  const quietEnabled = readRaw(KEYS.quietHoursEnabled);
  const quietStart = readRaw(KEYS.quietHoursStart);
  const quietEnd = readRaw(KEYS.quietHoursEnd);
  return {
    activeBrightness:
      brightness === null ? DEFAULTS.activeBrightness : clampBrightness(Number(brightness)),
    idleDimEnabled: enabled === null ? DEFAULTS.idleDimEnabled : enabled === "true",
    idleDimTimeoutMs:
      timeout === null ? DEFAULTS.idleDimTimeoutMs : clampIdleTimeoutMs(Number(timeout)),
    idleDimLevel: level === null ? DEFAULTS.idleDimLevel : clampDimLevel(Number(level)),
    recenterEnabled:
      recenterEnabled === null ? DEFAULTS.recenterEnabled : recenterEnabled === "true",
    recenterTimeoutMs:
      recenterTimeout === null
        ? DEFAULTS.recenterTimeoutMs
        : clampIdleTimeoutMs(Number(recenterTimeout)),
    showFps: fps === null ? DEFAULTS.showFps : fps === "true",
    showBuildBadge: buildBadge === null ? DEFAULTS.showBuildBadge : buildBadge === "true",
    snapMode:
      snap && (SNAP_MODES as readonly string[]).includes(snap)
        ? (snap as SnapMode)
        : DEFAULTS.snapMode,
    showMinimap: minimap === null ? DEFAULTS.showMinimap : minimap === "true",
    pinCode: pin && /^\d{6}$/.test(pin) ? pin : DEFAULTS.pinCode,
    pushEnabled: push === null ? DEFAULTS.pushEnabled : push === "true",
    // Re-serialized through the codec so a hand-edited / stale storage value
    // (an unknown category, stray whitespace) can never enter the store.
    mutedCategories:
      muted === null
        ? DEFAULTS.mutedCategories
        : serializeMutedCategories(parseMutedCategories(muted)),
    quietHoursEnabled: quietEnabled === null ? DEFAULTS.quietHoursEnabled : quietEnabled === "true",
    quietHoursStart:
      quietStart && parseClock(quietStart) !== null ? quietStart : DEFAULTS.quietHoursStart,
    quietHoursEnd: quietEnd && parseClock(quietEnd) !== null ? quietEnd : DEFAULTS.quietHoursEnd,
  };
}

// ─── singleton store ──────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();
let state: Settings = loadInitial();

function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot(): Settings {
  return state;
}

function emit(): void {
  for (const cb of listeners) cb();
}

// Optional server sink: the sync hook (useSettingsSync) registers a pusher so a
// user edit also persists globally, syncing across every wall panel. Null when
// unmounted / in tests / Storybook , the store then behaves local-only.
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
  if (state[key] === value) return;
  settingsLog.info(`${key} changed`, { from: state[key], to: value });
  // Also on the human-activity channel. `patch` is reached ONLY from the setters
  // a control calls, never from `hydrateSettings` (the server poll), so every
  // call here is genuinely someone touching the Settings panel , which is
  // exactly the human-origin-only rule this channel depends on.
  interaction("settings", "change", `settings.${key}`, { from: state[key], to: value });
  state = { ...state, [key]: value };
  writeRaw(KEYS[key], serialized);
  emit();
  serverSink?.(state);
}

/**
 * Adopt authoritative settings from the server WITHOUT echoing back to it (no
 * sink call), used on load + each poll. Writes through to the localStorage cache
 * so an offline reload keeps the last-known global values. Missing fields fall
 * back to their default, so a server row written before a field existed is safe.
 */
export function hydrateSettings(next: Partial<Settings>): void {
  const merged: Settings = { ...DEFAULTS, ...next };
  // Local-only fields keep whatever this panel has; the server has no opinion on
  // them, and folding in the DEFAULT here would silently undo a user's choice on
  // the next poll (see LOCAL_ONLY_KEYS).
  for (const key of LOCAL_ONLY_KEYS) {
    // Assigning through a per-key generic keeps the value's type tied to its
    // key (a blanket Record<string, unknown> cast would erase that).
    const assign = <K extends keyof Settings>(k: K) => {
      merged[k] = state[k];
    };
    assign(key);
  }
  if (shallowEqual(state, merged)) return;
  state = merged;
  for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
    writeRaw(KEYS[key], String(merged[key]));
  }
  emit();
}

// ─── setters (module-level, stable) ───────────────────────────────────────────

export function setActiveBrightness(level: number): void {
  const clamped = clampBrightness(level);
  patch("activeBrightness", clamped, String(clamped));
}

export function setIdleDimEnabled(v: boolean): void {
  patch("idleDimEnabled", v, String(v));
}

export function setIdleDimTimeoutMs(ms: number): void {
  const clamped = clampIdleTimeoutMs(ms);
  patch("idleDimTimeoutMs", clamped, String(clamped));
}

export function setIdleDimLevel(level: number): void {
  const clamped = clampDimLevel(level);
  patch("idleDimLevel", clamped, String(clamped));
}

export function setRecenterEnabled(v: boolean): void {
  patch("recenterEnabled", v, String(v));
}

export function setRecenterTimeoutMs(ms: number): void {
  const clamped = clampIdleTimeoutMs(ms);
  patch("recenterTimeoutMs", clamped, String(clamped));
}

export function setShowFps(v: boolean): void {
  patch("showFps", v, String(v));
}

export function setShowBuildBadge(v: boolean): void {
  patch("showBuildBadge", v, String(v));
}

export function setSnapMode(mode: SnapMode): void {
  patch("snapMode", mode, mode);
}

export function setShowMinimap(v: boolean): void {
  patch("showMinimap", v, String(v));
}

/** Set the synced PIN. No-op unless the input is exactly 6 digits , the schema
 *  guard, not auth (a wrong-format value never reaches storage or the server). */
export function setPinCode(pin: string): void {
  if (!/^\d{6}$/.test(pin)) return;
  patch("pinCode", pin, pin);
}

export function setPushEnabled(v: boolean): void {
  patch("pushEnabled", v, String(v));
}

/** Mute or unmute one notification category (see lib/notifications.ts codec). */
export function setCategoryMuted(category: NotificationCategory, muted: boolean): void {
  const next = toggleMutedCategory(state.mutedCategories, category, muted);
  patch("mutedCategories", next, next);
}

export function setQuietHoursEnabled(v: boolean): void {
  patch("quietHoursEnabled", v, String(v));
}

/** Set the quiet-window start. No-op on a malformed "HH:MM" (schema guard). */
export function setQuietHoursStart(hhmm: string): void {
  if (parseClock(hhmm) === null) return;
  patch("quietHoursStart", hhmm, hhmm);
}

/** Set the quiet-window end. No-op on a malformed "HH:MM" (schema guard). */
export function setQuietHoursEnd(hhmm: string): void {
  if (parseClock(hhmm) === null) return;
  patch("quietHoursEnd", hhmm, hhmm);
}

/** The muted categories as a parsed list , the form every consumer wants. */
export function mutedCategoriesOf(settings: Settings): NotificationCategory[] {
  return parseMutedCategories(settings.mutedCategories);
}

/**
 * Reset every setting to its default and push the reset to the server sink so it
 * propagates to other panels (same path as a user edit).
 */
export function resetSettings(): void {
  if (shallowEqual(state, DEFAULTS)) return;
  settingsLog.warn("reset to defaults");
  interaction("settings", "commit", "settings.reset");
  state = { ...DEFAULTS };
  for (const key of Object.keys(KEYS) as (keyof Settings)[]) {
    writeRaw(KEYS[key], String(DEFAULTS[key]));
  }
  emit();
  serverSink?.(state);
}

// ─── hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to the live settings. Setters are module-level exports (stable
 * references), so components import them directly rather than reading them off
 * the hook return.
 */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
