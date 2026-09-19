import { SETTINGS_DEFAULTS } from "@cc/api/settings";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PIN,
  hydrateSettings,
  IDLE_DIM_LEVEL,
  IDLE_DIM_TIMEOUT_MS,
  PIN_LENGTH,
  resetSettings,
  setAccent,
  setPinCode,
  setTimeZone,
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
  it("starts at the contract defaults", () => {
    act(() => resetSettings());
    const s = read().current;
    expect(s.pinCode).toBe("000000");
    expect(s.accent).toBe(SETTINGS_DEFAULTS.accent);
    expect(s.timeZone).toBe(SETTINGS_DEFAULTS.timeZone);
  });

  it("exports PIN_LENGTH = 6 and DEFAULT_PIN = 000000", () => {
    expect(PIN_LENGTH).toBe(6);
    expect(DEFAULT_PIN).toBe("000000");
  });

  it("holds the idle-dim behaviour as constants, not settings", () => {
    expect(IDLE_DIM_TIMEOUT_MS).toBe(60_000);
    expect(IDLE_DIM_LEVEL).toBe(0.3);
  });

  it("defaults to the panel timezone and accepts a valid IANA replacement", () => {
    expect(read().current.timeZone).toBe(SETTINGS_DEFAULTS.timeZone);
    act(() => setTimeZone("Europe/London"));
    expect(read().current.timeZone).toBe("Europe/London");
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

describe("accent setter", () => {
  it("stores a chosen accent", () => {
    act(() => setAccent("green"));
    expect(read().current.accent).toBe("green");
  });

  // Asserts against the CONTRACT's default rather than a literal: the baseline
  // is a product decision that has already moved once (blue -> white), and a
  // hardcoded colour here would fail the next time it moves for the wrong reason.
  it("resets to the default accent", () => {
    act(() => setAccent("orange"));
    act(() => resetSettings());
    expect(read().current.accent).toBe(SETTINGS_DEFAULTS.accent);
  });
});

describe("hydrateSettings", () => {
  // The deploy-skew case: web knows a setting the api does not, so `settings.get`
  // returns it missing. Adopting the DEFAULT there would undo the user's choice
  // on the very next poll.
  it("keeps the current value for a field the server omits", () => {
    act(() => setAccent("orange"));
    act(() => hydrateSettings({ timeZone: "Europe/Paris" }));
    expect(read().current.accent).toBe("orange");
    expect(read().current.timeZone).toBe("Europe/Paris");
  });

  it("still adopts a value the server does send", () => {
    act(() => setAccent("orange"));
    act(() => hydrateSettings({ accent: "white" }));
    expect(read().current.accent).toBe("white");
  });
});
