/**
 * system-sound , the web side of the iOS SystemSound plugin
 * (ios/App/App/SystemSoundPlugin.swift).
 *
 * Lets the kiosk play a sound iOS already ships instead of one we synthesize or
 * bundle. Nothing is downloaded and nothing is licensed: the sound lives in
 * /System/Library/Audio/UISounds and we only ask the system to play it.
 *
 * Native-only by nature. Off the kiosk (a browser, Storybook, CI) the plugin is
 * absent, `playSystemSound` reports false, and the caller falls back to
 * synthesis. The only caller is the sound bus (lib/sound), which owns that
 * choice for every cue.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

interface SystemSoundPlugin {
  play(options: { id: number }): Promise<void>;
}

/**
 * Apple's own sound ids. Community-mapped rather than documented, so treat them
 * as best-effort: an id iOS does not recognise is a silent no-op, never a throw.
 */
export const SYSTEM_SOUND = {
  /** photoShutter.caf , the stock camera shutter. */
  photoShutter: 1108,
} as const;

const plugin = registerPlugin<SystemSoundPlugin>("SystemSound");

/**
 * Play an iOS system sound. Returns whether it was actually handed to the
 * system, so a caller can fall back when it was not (web, or a build without
 * the plugin). Never throws , audio is a cue, and a failed cue must not break
 * the capture it accompanies.
 */
export function playSystemSound(id: number): boolean {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("SystemSound")) return false;
  void plugin.play({ id }).catch(() => {
    // Swallowed deliberately , see above.
  });
  return true;
}
