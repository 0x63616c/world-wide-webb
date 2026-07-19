/**
 * Pure unit tests for the Lights mode-cycle helpers.
 * No React/trpc , just the mode <-> fixtures <-> label mapping and the cycle.
 */

import { describe, expect, it } from "vitest";
import {
  deriveLightsMode,
  LightsMode,
  lightsModeLabel,
  lightsModeToFixtures,
  nextLightsMode,
} from "../lights-mode";

describe("deriveLightsMode", () => {
  it("both off → off", () => {
    expect(deriveLightsMode({ kitchen: false, overhead: false })).toBe(LightsMode.Off);
  });
  it("kitchen only → kitchen", () => {
    expect(deriveLightsMode({ kitchen: true, overhead: false })).toBe(LightsMode.Kitchen);
  });
  it("overhead only → overhead", () => {
    expect(deriveLightsMode({ kitchen: false, overhead: true })).toBe(LightsMode.Overhead);
  });
  it("both on → on", () => {
    expect(deriveLightsMode({ kitchen: true, overhead: true })).toBe(LightsMode.On);
  });

  it("is a total bijection: every fixtures combo derives then round-trips", () => {
    for (const kitchen of [false, true]) {
      for (const overhead of [false, true]) {
        const mode = deriveLightsMode({ kitchen, overhead });
        expect(lightsModeToFixtures(mode)).toEqual({ kitchen, overhead });
      }
    }
  });
});

describe("lightsModeToFixtures", () => {
  it("maps each mode to its {kitchen, overhead}", () => {
    expect(lightsModeToFixtures(LightsMode.Off)).toEqual({ kitchen: false, overhead: false });
    expect(lightsModeToFixtures(LightsMode.Kitchen)).toEqual({ kitchen: true, overhead: false });
    expect(lightsModeToFixtures(LightsMode.Overhead)).toEqual({ kitchen: false, overhead: true });
    expect(lightsModeToFixtures(LightsMode.On)).toEqual({ kitchen: true, overhead: true });
  });
});

describe("nextLightsMode", () => {
  it("advances OFF → K ON → O ON → ON → OFF (wrap-around)", () => {
    expect(nextLightsMode(LightsMode.Off)).toBe(LightsMode.Kitchen);
    expect(nextLightsMode(LightsMode.Kitchen)).toBe(LightsMode.Overhead);
    expect(nextLightsMode(LightsMode.Overhead)).toBe(LightsMode.On);
    expect(nextLightsMode(LightsMode.On)).toBe(LightsMode.Off);
  });

  it("a full cycle of four taps returns to the start", () => {
    let mode: LightsMode = LightsMode.Off;
    for (let i = 0; i < 4; i++) mode = nextLightsMode(mode);
    expect(mode).toBe(LightsMode.Off);
  });

  it("defensive fallback: an unrecognised mode advances to OFF", () => {
    expect(nextLightsMode("bogus" as LightsMode)).toBe(LightsMode.Off);
  });
});

describe("lightsModeLabel", () => {
  it("labels the four modes OFF / K ON / O ON / ON", () => {
    expect(lightsModeLabel(LightsMode.Off)).toBe("OFF");
    expect(lightsModeLabel(LightsMode.Kitchen)).toBe("K ON");
    expect(lightsModeLabel(LightsMode.Overhead)).toBe("O ON");
    expect(lightsModeLabel(LightsMode.On)).toBe("ON");
  });
});
