import { describe, expect, it } from "vitest";
import {
  baselinesForCalibration,
  calibratedBaseline,
  displayVolume,
  rawVolume,
} from "./calibration";

describe("calibration math (ported from hammerspoon/lib/sonos.lua)", () => {
  it("passes raw volume straight through when uncalibrated", () => {
    expect(displayVolume(37, null)).toBe(37);
    expect(displayVolume(37, undefined)).toBe(37);
    expect(displayVolume(37, 0)).toBe(37);
    expect(rawVolume(37, null)).toBe(37);
    expect(rawVolume(140, null)).toBe(100);
    expect(rawVolume(-3, null)).toBe(0);
  });

  it("stores raw*2 so the calibrated moment reads back as exactly 50%", () => {
    for (const raw of [1, 12, 49, 50, 73, 100]) {
      const baseline = calibratedBaseline(raw);
      expect(baseline).toBe(raw * 2);
      expect(displayVolume(raw, baseline)).toBe(50);
    }
  });

  it("does not clamp the baseline: a loud room still calibrates (the #8 regression)", () => {
    // Raw 73 -> baseline 146 (> 100). A clamp would have made this a no-op.
    const baseline = calibratedBaseline(73);
    expect(baseline).toBe(146);
    expect(displayVolume(73, baseline)).toBe(50);
    // Dragging to the slider's top sends the speaker's real max, never more.
    expect(rawVolume(100, baseline)).toBe(100);
    // ...and that raw 100 honestly redisplays under 100% against the baseline.
    expect(displayVolume(100, baseline)).toBe(68);
  });

  it("displays >100% when a room is past its calibrated ceiling", () => {
    expect(displayVolume(60, 40)).toBe(150);
  });

  it("round-trips display -> raw through the baseline", () => {
    expect(rawVolume(50, 60)).toBe(30);
    expect(rawVolume(75, 60)).toBe(45);
    expect(rawVolume(0, 60)).toBe(0);
  });

  it("skips rooms read as 0 when computing calibration baselines", () => {
    expect(
      baselinesForCalibration([
        { uuid: "media_player.desk", volume: 30 },
        { uuid: "media_player.kitchen", volume: 0 },
      ]),
    ).toEqual({ "media_player.desk": 60 });
  });
});
