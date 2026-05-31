import { describe, expect, it } from "vitest";

import { findLight, LAMP_ENTITY_IDS, LightKind } from "../config/lights";

describe("lights config", () => {
  it("includes the desk lamp as a color-capable lamp", () => {
    expect(LAMP_ENTITY_IDS).toContain("light.desk");

    const desk = findLight("light.desk");
    expect(desk?.kind).toBe(LightKind.Lamp);
    // Hue bulb — must advertise rgb so the scene/brightness controls reach it.
    expect(desk?.capabilities).toContain("rgb");
  });
});
