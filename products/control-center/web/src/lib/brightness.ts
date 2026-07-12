/**
 * Native backlight bridge , the first (and only) web→native Capacitor call in
 * the web layer. Wraps @capacitor-community/screen-brightness so the idle-dim
 * feature can drive the iPad's real backlight, while staying a pure no-op in a
 * plain browser / Storybook / test env (where the CSS dim overlay provides the
 * visual instead).
 *
 * The panel OWNS its backlight ABSOLUTELY: awake it holds the configured active
 * brightness, idle it drops to the dim level , both overriding whatever the iOS
 * brightness slider is set to. Nothing here reads or restores the device's own
 * brightness; a hand-dimmed iPad still comes up at the app's active level.
 *
 * Isolated here on purpose: nothing else imports @capacitor/* , if the shell or
 * plugin ever changes, this is the single seam to update.
 */

import { Capacitor } from "@capacitor/core";
import { ScreenBrightness } from "@capacitor-community/screen-brightness";

/**
 * True only inside the native Capacitor shell (the iPad app). In a browser this
 * is false, so callers fall back to the CSS overlay and never touch the plugin.
 */
export function isNativeDisplay(): boolean {
  return Capacitor.isNativePlatform();
}

/** Set the backlight to an absolute level (0..1). No-op off-device. */
async function setBacklight(level: number): Promise<void> {
  if (!isNativeDisplay()) return;
  try {
    await ScreenBrightness.setBrightness({ brightness: level });
    lastLevel = level;
  } catch {
    // Best-effort , a brightness failure must never crash the board.
  }
}

// ─── ramped transitions ───────────────────────────────────────────────────────
// The backlight has no native transition, so a "fade" is a stepped ramp from
// the last level this module set. Only one ramp runs at a time: a new dim/wake
// call cancels the in-flight ramp and starts from wherever it got to, so a tap
// mid-dim brightens from the current level rather than snapping.

const RAMP_STEP_MS = 40; // ~25 steps/second , visually continuous on the panel

let lastLevel: number | null = null;
let rampToken = 0;

async function rampBacklight(target: number, durationMs: number): Promise<void> {
  if (!isNativeDisplay()) return;
  const token = ++rampToken;
  const from = lastLevel;
  // No known starting point (first call after boot) or no fade requested: jump.
  if (from === null || durationMs <= 0 || Math.abs(target - from) < 0.005) {
    await setBacklight(target);
    return;
  }
  const steps = Math.max(1, Math.round(durationMs / RAMP_STEP_MS));
  for (let i = 1; i <= steps; i++) {
    if (token !== rampToken) return; // superseded by a newer dim/wake
    await setBacklight(from + ((target - from) * i) / steps);
    if (i < steps) await new Promise((r) => setTimeout(r, RAMP_STEP_MS));
  }
}

/** Fade the backlight to the (absolute) idle dim `level` over `durationMs`. */
export async function dimTo(level: number, durationMs = 0): Promise<void> {
  await rampBacklight(level, durationMs);
}

/** Fade the backlight to the (absolute) active/awake `level` over `durationMs`. */
export async function wakeTo(level: number, durationMs = 0): Promise<void> {
  await rampBacklight(level, durationMs);
}
