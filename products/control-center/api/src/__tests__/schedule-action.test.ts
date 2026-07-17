import { describe, expect, it } from "vitest";

import { RED_RGB, WHITE_SCENE_KELVIN } from "../config/lamp-scenes";
import { actionEndpoints } from "../services/schedule-fade";

describe("actionEndpoints", () => {
  it("maps a red scene to an rgb endpoint per target, on + brightness", () => {
    const eps = actionEndpoints({ on: true, scene: "red", brightness: 80 }, ["a", "b"]);
    const raw = Math.round((80 / 100) * 255);
    expect(eps.get("a")).toEqual({ on: true, rgb: [...RED_RGB], brightnessRaw: raw });
    expect(eps.get("b")).toEqual({ on: true, rgb: [...RED_RGB], brightnessRaw: raw });
  });
  it("maps a white scene to a kelvin endpoint", () => {
    const eps = actionEndpoints({ on: true, scene: "white" }, ["a"]);
    expect(eps.get("a")).toEqual({ on: true, kelvin: WHITE_SCENE_KELVIN });
  });
  it("gives each target a DISTINCT mood color", () => {
    const eps = actionEndpoints({ on: true, scene: "mood" }, ["a", "b", "c"]);
    const keys = ["a", "b", "c"].map((k) => JSON.stringify(eps.get(k)?.rgb));
    expect(new Set(keys).size).toBe(3);
  });
  it("off action yields on:false endpoints", () => {
    const eps = actionEndpoints({ on: false }, ["a"]);
    expect(eps.get("a")).toEqual({ on: false });
  });
  it("no scene leaves color unset (keep existing)", () => {
    const eps = actionEndpoints({ on: true, brightness: 50 }, ["a"]);
    const ep = eps.get("a");
    expect(ep?.rgb).toBeUndefined();
    expect(ep?.kelvin).toBeUndefined();
    expect(ep?.on).toBe(true);
  });
});
