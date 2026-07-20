/**
 * The device-volume bridge's availability and failure contract. Nothing here can
 * observe a real volume change; what matters is that the module reports honestly
 * when it cannot reach the device (which is what greys out the Settings slider)
 * and that a refused write degrades to null rather than throwing , the native
 * write depends on an undocumented iOS detail, so "it stopped working" has to be
 * a survivable outcome.
 */

import { Capacitor } from "@capacitor/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPanelVolume,
  isPanelVolumeAvailable,
  onPanelVolumeChanged,
  setPanelVolume,
} from "../panel-volume";

const getVolume = vi.fn(() => Promise.resolve({ value: 0.5 }));
const setVolume = vi.fn((opts: { value: number }) => Promise.resolve({ value: opts.value }));
const remove = vi.fn(() => Promise.resolve());
const addListener = vi.fn(() => Promise.resolve({ remove }));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(), isPluginAvailable: vi.fn() },
  registerPlugin: () => ({
    getVolume: () => getVolume(),
    setVolume: (opts: { value: number }) => setVolume(opts),
    addListener: (...args: unknown[]) => addListener(...(args as [])),
  }),
}));

const isNative = vi.mocked(Capacitor.isNativePlatform);
const hasPlugin = vi.mocked(Capacitor.isPluginAvailable);

function onPanel() {
  isNative.mockReturnValue(true);
  hasPlugin.mockReturnValue(true);
}

beforeEach(() => {
  vi.clearAllMocks();
  getVolume.mockImplementation(() => Promise.resolve({ value: 0.5 }));
  setVolume.mockImplementation((opts) => Promise.resolve({ value: opts.value }));
  addListener.mockImplementation(() => Promise.resolve({ remove }));
});

describe("isPanelVolumeAvailable", () => {
  it("is true on the kiosk", () => {
    onPanel();
    expect(isPanelVolumeAvailable()).toBe(true);
  });

  it("is false in a browser , there is no way to set system volume there", () => {
    isNative.mockReturnValue(false);
    hasPlugin.mockReturnValue(true);
    expect(isPanelVolumeAvailable()).toBe(false);
  });

  it("is false on a native build predating the plugin", () => {
    isNative.mockReturnValue(true);
    hasPlugin.mockReturnValue(false);
    expect(isPanelVolumeAvailable()).toBe(false);
  });
});

describe("getPanelVolume", () => {
  it("returns the device's value on the kiosk", async () => {
    onPanel();
    await expect(getPanelVolume()).resolves.toBe(0.5);
  });

  it("returns null off the panel without calling the bridge", async () => {
    isNative.mockReturnValue(false);
    await expect(getPanelVolume()).resolves.toBeNull();
    expect(getVolume).not.toHaveBeenCalled();
  });

  it("returns null rather than throwing when the bridge fails", async () => {
    onPanel();
    getVolume.mockImplementation(() => Promise.reject(new Error("bridge gone")));
    await expect(getPanelVolume()).resolves.toBeNull();
  });
});

describe("setPanelVolume", () => {
  it("passes the value through and returns what the device reports", async () => {
    onPanel();
    await expect(setPanelVolume(0.25)).resolves.toBe(0.25);
    expect(setVolume).toHaveBeenCalledWith({ value: 0.25 });
  });

  it("surfaces the device's own value when it quantises the request", async () => {
    onPanel();
    // iOS snaps volume to 16 steps, so the value that lands is rarely the exact
    // one requested; the caller needs the real one, not its own input echoed.
    setVolume.mockImplementation(() => Promise.resolve({ value: 0.4375 }));
    await expect(setPanelVolume(0.42)).resolves.toBe(0.4375);
  });

  it("returns null off the panel without calling the bridge", async () => {
    isNative.mockReturnValue(false);
    await expect(setPanelVolume(0.25)).resolves.toBeNull();
    expect(setVolume).not.toHaveBeenCalled();
  });

  it("returns null when the native write is refused", async () => {
    onPanel();
    // What a future iOS breaking the MPVolumeView technique looks like here.
    setVolume.mockImplementation(() => Promise.reject(new Error("Volume slider unavailable")));
    await expect(setPanelVolume(0.25)).resolves.toBeNull();
  });
});

describe("onPanelVolumeChanged", () => {
  it("registers a listener on the kiosk", () => {
    onPanel();
    onPanelVolumeChanged(() => {});
    expect(addListener).toHaveBeenCalledWith("volumeChanged", expect.any(Function));
  });

  it("is an inert no-op off the panel", () => {
    isNative.mockReturnValue(false);
    const unsubscribe = onPanelVolumeChanged(() => {});
    expect(addListener).not.toHaveBeenCalled();
    expect(() => unsubscribe()).not.toThrow();
  });

  it("forwards the reported value to the handler", async () => {
    onPanel();
    const handler = vi.fn();
    onPanelVolumeChanged(handler);
    const [, forward] = addListener.mock.calls[0] as unknown as [
      string,
      (d: { value: number }) => void,
    ];
    forward({ value: 0.75 });
    expect(handler).toHaveBeenCalledWith(0.75);
  });

  it("removes the listener even when unsubscribed before registration settled", async () => {
    onPanel();
    const unsubscribe = onPanelVolumeChanged(() => {});
    unsubscribe(); // before the addListener promise resolves
    await Promise.resolve();
    await Promise.resolve();
    expect(remove).toHaveBeenCalled();
  });
});
