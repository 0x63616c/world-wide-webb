/**
 * The shutter's native-vs-fallback contract. The interesting behaviour is not
 * that a sound plays (nothing here can hear one) but that `playSystemSound`
 * reports honestly whether iOS took the sound , that boolean is what decides
 * whether playShutter synthesizes instead, so a wrong answer means either
 * silence on the kiosk or a double shutter.
 */

import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { playSystemSound, SYSTEM_SOUND } from "../system-sound";

const play = vi.fn(() => Promise.resolve());

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(), isPluginAvailable: vi.fn() },
  registerPlugin: () => ({ play: (...args: unknown[]) => play(...(args as [])) }),
}));

const isNative = vi.mocked(Capacitor.isNativePlatform);
const hasPlugin = vi.mocked(Capacitor.isPluginAvailable);

describe("playSystemSound", () => {
  beforeEach(() => {
    play.mockClear();
    play.mockImplementation(() => Promise.resolve());
  });

  it("hands the sound to iOS on the kiosk", () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(true);

    expect(playSystemSound(SYSTEM_SOUND.photoShutter)).toBe(true);
    expect(play).toHaveBeenCalledWith({ id: 1108 });
  });

  it("reports false off-native so callers fall back", () => {
    isNative.mockReturnValue(false);
    hasPlugin.mockReturnValue(true);

    expect(playSystemSound(SYSTEM_SOUND.photoShutter)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("reports false when the build lacks the plugin", () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(false);

    expect(playSystemSound(SYSTEM_SOUND.photoShutter)).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });

  it("swallows a rejecting bridge , a failed cue must not break a capture", async () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(true);
    play.mockImplementation(() => Promise.reject(new Error("bridge gone")));

    expect(() => playSystemSound(SYSTEM_SOUND.photoShutter)).not.toThrow();
    // Let the rejected promise settle; an unhandled rejection would fail the run.
    await Promise.resolve();
  });
});
