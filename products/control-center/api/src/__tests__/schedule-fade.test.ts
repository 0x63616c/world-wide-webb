import { describe, expect, it } from "vitest";

import { type FadeEndpoint, interpolateLight } from "../services/schedule-fade";

const red: FadeEndpoint = { on: true, brightnessRaw: 255, rgb: [255, 0, 0] };

describe("interpolateLight", () => {
  it("returns the start at t=0", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 100, rgb: [0, 0, 0] };
    const e: FadeEndpoint = { on: true, brightnessRaw: 200, rgb: [255, 255, 255] };
    expect(interpolateLight(s, e, 0)).toEqual({
      on: true,
      brightness: 100,
      color: { rgb: [0, 0, 0] },
    });
  });
  it("returns the end at t=1", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, 1)).toEqual({
      on: true,
      brightness: 255,
      color: { rgb: [255, 0, 0] },
    });
  });
  it("lerps rgb + brightness at the midpoint", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, 0.5)).toEqual({
      on: true,
      brightness: 128,
      color: { rgb: [128, 0, 0] },
    });
  });
  it("clamps t below 0 and above 1", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 0, rgb: [0, 0, 0] };
    expect(interpolateLight(s, red, -1)).toEqual(interpolateLight(s, red, 0));
    expect(interpolateLight(s, red, 2)).toEqual(interpolateLight(s, red, 1));
  });
  it("ramps brightness toward 0 for an off target but keeps on:false", () => {
    const s: FadeEndpoint = { on: true, brightnessRaw: 200, rgb: [255, 0, 0] };
    const off: FadeEndpoint = { on: false, brightnessRaw: 0, rgb: [255, 0, 0] };
    expect(interpolateLight(s, off, 1)).toEqual({
      on: false,
      brightness: 0,
      color: { rgb: [255, 0, 0] },
    });
  });
});
