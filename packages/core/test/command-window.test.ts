import { describe, expect, it } from "vitest";

import {
  COMMAND_WINDOW_MS,
  stampCommandWindow,
  windowOpen,
} from "../src/device-state/command-window";

describe("command-window", () => {
  it("COMMAND_WINDOW_MS is 10s", () => {
    expect(COMMAND_WINDOW_MS).toBe(10_000);
  });

  it("stampCommandWindow returns now + the window", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    expect(stampCommandWindow(now).getTime()).toBe(now.getTime() + COMMAND_WINDOW_MS);
  });

  it("windowOpen is true only while now is before a set desiredUntilUtc", () => {
    const now = new Date("2026-01-01T00:00:05Z");
    expect(windowOpen({ desiredUntilUtc: new Date("2026-01-01T00:00:10Z") }, now)).toBe(true);
    expect(windowOpen({ desiredUntilUtc: new Date("2026-01-01T00:00:01Z") }, now)).toBe(false);
    expect(windowOpen({ desiredUntilUtc: null }, now)).toBe(false);
  });
});
