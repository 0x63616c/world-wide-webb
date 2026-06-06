import { describe, expect, it } from "vitest";

import {
  findLight,
  LAMP_ENTITY_IDS,
  LIGHTS,
  LightControl,
  LightKind,
  lightControl,
} from "../config/lights";

describe("lights config", () => {
  it("includes the desk lamp as a color-capable lamp", () => {
    expect(LAMP_ENTITY_IDS).toContain("light.desk");

    const desk = findLight("light.desk");
    expect(desk?.kind).toBe(LightKind.Lamp);
    // Hue bulb — must advertise rgb so the scene/brightness controls reach it.
    expect(desk?.capabilities).toContain("rgb");
  });
});

describe("per-device control policy (CC-7d5b.2.1)", () => {
  it("defaults to adopt when control is unspecified", () => {
    // The resolver is the single source of the default so the enforcer never
    // has to special-case a missing field: unspecified means adopt (safe — a
    // new device never fights its own switch unless opted into enforce).
    expect(lightControl({ control: undefined } as never)).toBe(LightControl.Adopt);
    expect(LightControl.Adopt).toBe("adopt");
    expect(LightControl.Enforce).toBe("enforce");
  });

  it("marks all 7 Hue lamps as enforce", () => {
    const lamps = LIGHTS.filter((l) => l.kind === LightKind.Lamp);
    expect(lamps).toHaveLength(7);
    for (const lamp of lamps) {
      expect(lightControl(lamp)).toBe(LightControl.Enforce);
    }
  });

  it("keeps the two switch fixtures as adopt so their wall switches win", () => {
    const overhead = findLight("switch.overhead_lights");
    const cabinet = findLight("switch.under_cabinet");
    expect(overhead && lightControl(overhead)).toBe(LightControl.Adopt);
    expect(cabinet && lightControl(cabinet)).toBe(LightControl.Adopt);
  });
});
