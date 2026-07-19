import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PIN,
  MAX_IDLE_TIMEOUT_MS,
  PIN_LENGTH,
  resetSettings,
  setPinCode,
  setShowMinimap,
  useSettings,
} from "../settings";

// The store is a module-level singleton; reset it after each test so cases don't
// leak state into one another.
afterEach(() => {
  act(() => resetSettings());
});

function read() {
  return renderHook(() => useSettings()).result;
}

describe("settings defaults", () => {
  it("includes the minimap + PIN fields at their defaults", () => {
    act(() => resetSettings());
    const s = read().current;
    expect(s.showMinimap).toBe(true);
    expect(s.pinCode).toBe("000000");
  });

  it("defaults showBuildNumber to false (opt-in, native-only)", () => {
    act(() => resetSettings());
    expect(read().current.showBuildNumber).toBe(false);
  });

  it("exports PIN_LENGTH = 6 and DEFAULT_PIN = 000000", () => {
    expect(PIN_LENGTH).toBe(6);
    expect(DEFAULT_PIN).toBe("000000");
  });

  it("caps the idle timeout at 10 minutes", () => {
    expect(MAX_IDLE_TIMEOUT_MS).toBe(600_000);
  });
});

describe("setPinCode", () => {
  it("accepts an exactly-6-digit code", () => {
    act(() => setPinCode("123456"));
    expect(read().current.pinCode).toBe("123456");
  });

  it("ignores a non-numeric code", () => {
    act(() => setPinCode("123456"));
    act(() => setPinCode("12x456"));
    expect(read().current.pinCode).toBe("123456");
  });

  it("ignores a too-short code", () => {
    act(() => setPinCode("123456"));
    act(() => setPinCode("12345"));
    expect(read().current.pinCode).toBe("123456");
  });

  it("ignores a too-long code", () => {
    act(() => setPinCode("123456"));
    act(() => setPinCode("1234567"));
    expect(read().current.pinCode).toBe("123456");
  });
});

describe("resetSettings", () => {
  it("restores pinCode to the default", () => {
    act(() => setPinCode("123456"));
    act(() => resetSettings());
    expect(read().current.pinCode).toBe("000000");
  });
});

describe("minimap setter", () => {
  it("toggles showMinimap", () => {
    act(() => setShowMinimap(false));
    expect(read().current.showMinimap).toBe(false);
  });
});
