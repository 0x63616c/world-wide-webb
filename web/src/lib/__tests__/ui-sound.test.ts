/**
 * The shutter's native-vs-fallback contract. The interesting behaviour is not
 * that a sound plays (nothing here can hear one) but that `playUISound` reports
 * honestly whether the plugin took the sound , that boolean is what decides
 * whether playShutter synthesizes instead, so a wrong answer means either
 * silence on the kiosk or a double shutter.
 */

import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { playUISound, UI_SOUND } from "../ui-sound";

const play = vi.fn(() => Promise.resolve());

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(), isPluginAvailable: vi.fn() },
  registerPlugin: () => ({ play: (...args: unknown[]) => play(...(args as [])) }),
}));

const isNative = vi.mocked(Capacitor.isNativePlatform);
const hasPlugin = vi.mocked(Capacitor.isPluginAvailable);

describe("playUISound", () => {
  beforeEach(() => {
    play.mockClear();
    play.mockImplementation(() => Promise.resolve());
  });

  it("hands the sound to the plugin on the kiosk", () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(true);

    expect(playUISound(UI_SOUND.photoShutter)).toBe(true);
    expect(play).toHaveBeenCalledWith({ path: UI_SOUND.photoShutter });
  });

  it("reports false off-native so callers fall back", () => {
    isNative.mockReturnValue(false);
    hasPlugin.mockReturnValue(true);

    expect(playUISound(UI_SOUND.photoShutter)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("reports false when the build lacks the plugin", () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(false);

    expect(playUISound(UI_SOUND.photoShutter)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("swallows a rejecting bridge , a failed cue must not break a capture", async () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(true);
    play.mockImplementation(() => Promise.reject(new Error("bridge gone")));

    expect(() => playUISound(UI_SOUND.photoShutter)).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await Promise.resolve();
  });
});
