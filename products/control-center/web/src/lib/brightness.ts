/**
 * Native backlight bridge , the first (and only) web→native Capacitor call in
 * the web layer. Wraps @capacitor-community/screen-brightness so the idle-dim
 * feature can drop the iPad's real backlight and restore it, while staying a
 * pure no-op in a plain browser / Storybook / test env (where the CSS dim
 * overlay provides the visual instead).
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

// The user's pre-dim brightness, captured the first time we dim so restore()
// puts it back exactly. null = not currently dimmed (nothing to restore).
let preDimBrightness: number | null = null;

/**
 * Drop the backlight to `level` (0..1). Captures the current brightness on the
 * first dim so restore() is exact; subsequent calls (e.g. a live level change
 * while already dimmed) re-apply without re-capturing. No-op off-device.
 */
export async function dimTo(level: number): Promise<void> {
  if (!isNativeDisplay()) return;
  try {
    if (preDimBrightness === null) {
      const { brightness } = await ScreenBrightness.getBrightness();
      preDimBrightness = brightness;
    }
    await ScreenBrightness.setBrightness({ brightness: level });
  } catch {
    // Best-effort , a brightness failure must never crash the board.
  }
}

/**
 * Restore the backlight to the value captured before dimming. No-op if not
 * currently dimmed, or off-device.
 */
export async function restore(): Promise<void> {
  if (!isNativeDisplay()) return;
  if (preDimBrightness === null) return;
  try {
    await ScreenBrightness.setBrightness({ brightness: preDimBrightness });
  } catch {
    // Best-effort.
  } finally {
    preDimBrightness = null;
  }
}
