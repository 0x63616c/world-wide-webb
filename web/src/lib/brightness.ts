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
  } catch {
    // Best-effort , a brightness failure must never crash the board.
  }
}

/** Drop the backlight to the (absolute) idle dim `level`. */
export async function dimTo(level: number): Promise<void> {
  await setBacklight(level);
}

/** Drive the backlight to the (absolute) active/awake `level`. */
export async function wakeTo(level: number): Promise<void> {
  await setBacklight(level);
}
