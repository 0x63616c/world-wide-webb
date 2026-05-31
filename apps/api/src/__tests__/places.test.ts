import { describe, expect, it } from "vitest";
import { findPlace, haversineMiles, PLACES } from "../config/places";

describe("haversineMiles", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMiles(34.0537, -118.2428, 34.0537, -118.2428)).toBeCloseTo(0, 5);
  });

  it("computes a known short distance (~0.95mi across central LA)", () => {
    // 34.0537,-118.2428 -> 34.0537,-118.2670 is ~0.95mi due east.
    const d = haversineMiles(34.0537, -118.2428, 34.0537, -118.267);
    expect(d).toBeGreaterThan(0.9);
    expect(d).toBeLessThan(1.0);
  });

  it("is symmetric", () => {
    const a = haversineMiles(34.0537, -118.2428, 34.09, -118.33);
    const b = haversineMiles(34.09, -118.33, 34.0537, -118.2428);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe("findPlace", () => {
  it("matches Home when within its 1mi radius", () => {
    expect(findPlace(34.061183, -118.284533)?.name).toBe("Home");
  });

  it("returns undefined when outside every place radius", () => {
    // Sound Nightclub area, ~2-3mi north-west of Home.
    expect(findPlace(34.09, -118.33)).toBeUndefined();
  });

  it("returns the first matching place (order is priority)", () => {
    // The point exactly at the first place must resolve to that first place.
    const first = PLACES[0];
    expect(findPlace(first.lat, first.lon)?.name).toBe(first.name);
  });
});
