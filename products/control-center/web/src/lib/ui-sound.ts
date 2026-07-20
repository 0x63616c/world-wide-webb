/**
 * ui-sound , the web side of the iOS UISound plugin
 * (ios/App/App/UISoundPlugin.swift).
 *
 * Lets the kiosk play a sound iOS already ships instead of one we synthesize or
 * bundle. Nothing is downloaded and nothing is licensed: the sound lives in
 * /System/Library/Audio/UISounds and the plugin loads it into an AVAudioPlayer
 * on the panel's `.playback` session , so it plays through the same audio
 * session as everything else and survives the hardware silent switch (a system
 * sound would not; see the plugin's header).
 *
 * Native-only by nature. Off the kiosk (a browser, Storybook, CI) the plugin is
 * absent, `playUISound` reports false, and the caller falls back to synthesis.
 * The only caller is the sound bus (lib/sound), which owns that choice for every
 * cue.
 */

import { Capacitor, registerPlugin } from "@capacitor/core";

interface UISoundPlugin {
  play(options: { path: string }): Promise<void>;
}

/**
 * Paths to Apple's own UISounds. The location is community-mapped rather than
 * documented, so treat it as best-effort: a path iOS cannot read is a logged
 * no-op natively, never a throw.
 */
export const UI_SOUND = {
  /** photoShutter.caf , the stock camera shutter. */
  photoShutter: "/System/Library/Audio/UISounds/photoShutter.caf",
} as const;

const plugin = registerPlugin<UISoundPlugin>("UISound");

/**
 * Play an iOS UISounds recording by path through the panel's audio session.
 * Returns whether it was handed to the plugin, so a caller can fall back when it
 * was not (web, or a build without the plugin). Never throws , audio is a cue,
 * and a failed cue must not break the capture it accompanies.
 */
export function playUISound(path: string): boolean {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("UISound")) return false;
  void plugin.play({ path }).catch(() => {
    // Swallowed deliberately , see above.
  });
  return true;
}
