/**
 * Per-device settings , a singleton external store for preferences that belong
 * to THIS panel rather than the installation.
 *
 * Sibling of lib/settings.ts and deliberately shaped like it (module-level
 * state, listener set, useSyncExternalStore, best-effort `cc-*` localStorage
 * mirror). It is a separate store rather than more fields on that one because
 * the server side is a different row: `settings` is a singleton every panel
 * shares, while these are keyed on this panel's device_id. Mixing the two would
 * mean one store with two sync lifecycles.
 *
 * Volume is the first and currently only field.
 *
 * Note the extra participant compared to settings.ts: volume has a THIRD copy
 * living outside this store , the iOS system volume itself, which the user can
 * change with the hardware buttons at any time. `setVolumeFromDevice` is the
 * entry point for that direction and deliberately does not echo back; see the
 * comment there.
 */

import { DEVICE_SETTINGS_DEFAULTS, VOLUME_MAX, VOLUME_MIN } from "@cc/api/device-settings";
import { interaction } from "./log/interaction";
import { log } from "./log/logger";
import { createStore, useStore } from "./store";

const deviceSettingsLog = log.child("device-settings");

// ─── shape + bounds ───────────────────────────────────────────────────────────

export interface DeviceSettings {
  /** Output volume as a 0..1 fraction of this device's media volume. 0 is a
   *  real value , it is how the panel is muted, which is why there is no
   *  separate mute control. */
  volume: number;
}

// Wire contract, re-exported rather than restated (see lib/settings.ts).
export const MIN_VOLUME = VOLUME_MIN;
export const MAX_VOLUME = VOLUME_MAX;

const DEFAULTS: DeviceSettings = DEVICE_SETTINGS_DEFAULTS;

const KEYS = {
  volume: "cc-volume",
} as const;

// ─── clamps ───────────────────────────────────────────────────────────────────

export function clampVolume(level: number): number {
  if (!Number.isFinite(level)) return DEFAULTS.volume;
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, level));
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

function loadInitial(): DeviceSettings {
  const volume = readRaw(KEYS.volume);
  return {
    volume: volume === null ? DEFAULTS.volume : clampVolume(Number(volume)),
  };
}

// ─── singleton store ──────────────────────────────────────────────────────────

const store = createStore<DeviceSettings>(loadInitial());

// Optional server sink, registered by useDeviceSettingsSync. Null when unmounted
// / in tests / Storybook , the store is then local-only.
let serverSink: ((s: DeviceSettings) => void) | null = null;

/** Register the server pusher; returns an unregister fn. */
export function registerServerSink(fn: (s: DeviceSettings) => void): () => void {
  serverSink = fn;
  return () => {
    if (serverSink === fn) serverSink = null;
  };
}

function shallowEqual(a: DeviceSettings, b: DeviceSettings): boolean {
  for (const key of Object.keys(KEYS) as (keyof DeviceSettings)[]) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

/**
 * Commit a changed field: persist locally, notify subscribers, push to the
 * server. `origin` decides whether it also lands on the human-activity channel
 * , that channel's value depends on every entry being someone actually touching
 * a control, so a value the DEVICE reported is logged but not recorded as an
 * interaction with the Settings panel.
 */
function patch<K extends keyof DeviceSettings>(
  key: K,
  value: DeviceSettings[K],
  serialized: string,
  origin: "ui" | "device",
): void {
  const state = store.get();
  if (state[key] === value) return;
  deviceSettingsLog.info(`${key} changed`, { from: state[key], to: value, origin });
  if (origin === "ui") {
    interaction("settings", "change", `deviceSettings.${key}`, { from: state[key], to: value });
  }
  const next = { ...state, [key]: value };
  writeRaw(KEYS[key], serialized);
  store.set(next);
  serverSink?.(next);
}

/**
 * Adopt authoritative values from the server WITHOUT echoing back, used on load
 * and each poll. Missing fields fall back to their default, so a row written
 * before a field existed is safe.
 */
export function hydrateDeviceSettings(next: Partial<DeviceSettings>): void {
  const merged: DeviceSettings = { ...DEFAULTS, ...next };
  if (shallowEqual(store.get(), merged)) return;
  for (const key of Object.keys(KEYS) as (keyof DeviceSettings)[]) {
    writeRaw(KEYS[key], String(merged[key]));
  }
  store.set(merged);
}

// ─── setters ──────────────────────────────────────────────────────────────────

/** Set the volume from the UI (the Settings slider). Persists locally, pushes to
 *  the server, and , via the effect in useVolumeSync , down to the device. */
export function setVolume(level: number): void {
  const clamped = clampVolume(level);
  patch("volume", clamped, String(clamped), "ui");
}

/**
 * Adopt a volume the DEVICE reported (someone pressed the iPad's hardware
 * buttons; see the KVO listener in lib/panel-volume).
 *
 * This routes through the same `patch` as the slider, so the value is persisted
 * locally and to the server exactly as a UI edit would be , the physical buttons
 * set the preference, they are not a temporary override.
 *
 * What it must NOT do is write the value back to the device. That is not merely
 * redundant: the write would trigger another KVO callback, and the two would
 * chase each other. Suppression lives at the consumer (useVolumeSync tracks the
 * last value it applied) rather than here, so this stays a plain setter.
 */
export function setVolumeFromDevice(level: number): void {
  const clamped = clampVolume(level);
  patch("volume", clamped, String(clamped), "device");
}

/** Restore every per-device setting to its default. */
export function resetDeviceSettings(): void {
  if (shallowEqual(store.get(), DEFAULTS)) return;
  deviceSettingsLog.warn("reset to defaults");
  interaction("settings", "commit", "deviceSettings.reset");
  const next = { ...DEFAULTS };
  for (const key of Object.keys(KEYS) as (keyof DeviceSettings)[]) {
    writeRaw(KEYS[key], String(DEFAULTS[key]));
  }
  store.set(next);
  serverSink?.(next);
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useDeviceSettings(): DeviceSettings {
  return useStore(store);
}
