import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampVolume,
  hydrateDeviceSettings,
  MAX_VOLUME,
  MIN_VOLUME,
  registerServerSink,
  resetDeviceSettings,
  setVolume,
  setVolumeFromDevice,
  useDeviceSettings,
} from "../device-settings";

// The store is a module-level singleton; reset it after each test so cases don't
// leak state into one another.
afterEach(() => {
  act(() => resetDeviceSettings());
});

function read() {
  return renderHook(() => useDeviceSettings()).result;
}

describe("device-settings defaults", () => {
  it("defaults volume to half rather than full", () => {
    act(() => resetDeviceSettings());
    expect(read().current.volume).toBe(0.5);
  });

  it("exposes the wire bounds, with 0 permitted as the mute value", () => {
    expect(MIN_VOLUME).toBe(0);
    expect(MAX_VOLUME).toBe(1);
  });
});

describe("clampVolume", () => {
  it("keeps an in-range value untouched", () => {
    expect(clampVolume(0.42)).toBe(0.42);
  });

  it("clamps above and below the bounds", () => {
    expect(clampVolume(2)).toBe(1);
    expect(clampVolume(-1)).toBe(0);
  });

  it("falls back to the default for a non-finite value", () => {
    expect(clampVolume(Number.NaN)).toBe(0.5);
  });

  it("permits a true 0 , muting is a volume, not a separate mode", () => {
    expect(clampVolume(0)).toBe(0);
  });
});

describe("setVolume", () => {
  it("updates the store", () => {
    const r = read();
    act(() => setVolume(0.25));
    expect(r.current.volume).toBe(0.25);
  });

  it("clamps out-of-range input rather than storing it", () => {
    const r = read();
    act(() => setVolume(5));
    expect(r.current.volume).toBe(1);
  });

  it("pushes to the server sink", () => {
    const sink = vi.fn();
    const unregister = registerServerSink(sink);
    act(() => setVolume(0.3));
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.3 }));
    unregister();
  });

  it("does not push when the value is unchanged", () => {
    const sink = vi.fn();
    const unregister = registerServerSink(sink);
    act(() => setVolume(0.5)); // already the default
    expect(sink).not.toHaveBeenCalled();
    unregister();
  });
});

describe("setVolumeFromDevice", () => {
  // The hardware buttons set the preference rather than temporarily overriding
  // it, so a device-origin change must persist exactly like a slider drag.
  it("updates the store and pushes to the server", () => {
    const sink = vi.fn();
    const unregister = registerServerSink(sink);
    const r = read();
    act(() => setVolumeFromDevice(0.75));
    expect(r.current.volume).toBe(0.75);
    expect(sink).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.75 }));
    unregister();
  });

  it("is a no-op when the device reports the value already held", () => {
    const sink = vi.fn();
    const unregister = registerServerSink(sink);
    act(() => setVolumeFromDevice(0.5)); // already the default
    expect(sink).not.toHaveBeenCalled();
    unregister();
  });
});

describe("hydrateDeviceSettings", () => {
  it("adopts the server value", () => {
    const r = read();
    act(() => hydrateDeviceSettings({ volume: 0.1 }));
    expect(r.current.volume).toBe(0.1);
  });

  it("does NOT echo back to the server sink", () => {
    const sink = vi.fn();
    const unregister = registerServerSink(sink);
    act(() => hydrateDeviceSettings({ volume: 0.2 }));
    expect(sink).not.toHaveBeenCalled();
    unregister();
  });

  it("falls back to the default for a field the stored row lacks", () => {
    const r = read();
    act(() => setVolume(0.9));
    act(() => hydrateDeviceSettings({}));
    expect(r.current.volume).toBe(0.5);
  });
});
