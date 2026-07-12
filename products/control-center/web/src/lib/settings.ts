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

// ─── theme vocabulary (shared with lib/theme) ─────────────────────────────────
// `auto` follows the sun at the home location: light after sunrise, dark after
// sunset, both shifted by themeSunOffsetMin. The switching logic lives in
// lib/theme.ts; this is just the persisted preference.
export const THEME_MODES = ["auto", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const THEME_MODE_LABEL: Record<ThemeMode, string> = {
  auto: "auto",
  light: "light",
  dark: "dark",
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
  /** Board color theme (see THEME_MODES). */
  themeMode: ThemeMode;
  /** Auto-theme switch offset in minutes relative to sunrise/sunset. Positive
   *  switches later (+30 ≈ hold light until civil twilight ends). */
  themeSunOffsetMin: number;
  /** Light↔dark cross-fade duration in ms (0 = instant). */
  themeFadeMs: number;
  /** Idle-dim backlight ramp duration in ms (0 = instant). */
  dimFadeMs: number;
}

export const MIN_IDLE_TIMEOUT_MS = 60_000; // 1 min
export const MAX_IDLE_TIMEOUT_MS = 60 * 60_000; // 60 min
export const MIN_DIM_LEVEL = 0.01; // 1 %
export const MAX_DIM_LEVEL = 0.99; // 99 %
// Active brightness goes to a full 100% (unlike the dim level, which stays below
// full so "dimmed" always reads darker than "awake").
export const MIN_BRIGHTNESS = 0.01; // 1 %
export const MAX_BRIGHTNESS = 1; // 100 %
// Fades cap at 10s; the sun offset stays within ±2h of the event (mirrors the
// server-side settingsSchema bounds so a synced value always round-trips).
export const MIN_FADE_MS = 0;
export const MAX_FADE_MS = 10_000;
export const MIN_SUN_OFFSET_MIN = -120;
export const MAX_SUN_OFFSET_MIN = 120;

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
  // Dark default preserves the panel's historical look until a user opts in.
  themeMode: "dark",
  themeSunOffsetMin: 30,
  themeFadeMs: 1200,
  dimFadeMs: 1000,
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
  themeMode: "cc-theme-mode",
  themeSunOffsetMin: "cc-theme-sun-offset-min",
  themeFadeMs: "cc-theme-fade-ms",
  dimFadeMs: "cc-dim-fade-ms",
} as const;

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

export function clampFadeMs(ms: number, fallback: number): number {
  if (!Number.isFinite(ms)) return fallback;
  return Math.min(MAX_FADE_MS, Math.max(MIN_FADE_MS, Math.round(ms)));
}

export function clampSunOffsetMin(min: number): number {
  if (!Number.isFinite(min)) return DEFAULTS.themeSunOffsetMin;
  return Math.min(MAX_SUN_OFFSET_MIN, Math.max(MIN_SUN_OFFSET_MIN, Math.round(min)));
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
  const themeMode = readRaw(KEYS.themeMode);
  const themeSunOffset = readRaw(KEYS.themeSunOffsetMin);
  const themeFade = readRaw(KEYS.themeFadeMs);
  const dimFade = readRaw(KEYS.dimFadeMs);
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
    themeMode:
      themeMode && (THEME_MODES as readonly string[]).includes(themeMode)
        ? (themeMode as ThemeMode)
        : DEFAULTS.themeMode,
    themeSunOffsetMin:
      themeSunOffset === null
        ? DEFAULTS.themeSunOffsetMin
        : clampSunOffsetMin(Number(themeSunOffset)),
    themeFadeMs:
      themeFade === null
        ? DEFAULTS.themeFadeMs
        : clampFadeMs(Number(themeFade), DEFAULTS.themeFadeMs),
    dimFadeMs:
      dimFade === null ? DEFAULTS.dimFadeMs : clampFadeMs(Number(dimFade), DEFAULTS.dimFadeMs),
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

export function setThemeMode(mode: ThemeMode): void {
  patch("themeMode", mode, mode);
}

export function setThemeSunOffsetMin(min: number): void {
  const clamped = clampSunOffsetMin(min);
  patch("themeSunOffsetMin", clamped, String(clamped));
}

export function setThemeFadeMs(ms: number): void {
  const clamped = clampFadeMs(ms, DEFAULTS.themeFadeMs);
  patch("themeFadeMs", clamped, String(clamped));
}

export function setDimFadeMs(ms: number): void {
  const clamped = clampFadeMs(ms, DEFAULTS.dimFadeMs);
  patch("dimFadeMs", clamped, String(clamped));
}

/**
 * Reset every setting to its default and push the reset to the server sink so it
 * propagates to other panels (same path as a user edit).
 */
export function resetSettings(): void {
  if (shallowEqual(state, DEFAULTS)) return;
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
