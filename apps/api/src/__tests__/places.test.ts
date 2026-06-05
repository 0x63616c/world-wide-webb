import { describe, expect, it } from "vitest";
import { findPlace, haversineMiles, PLACES } from "../config/places";

describe("haversineMiles", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMiles(34.0537, -118.2428, 34.0537, -118.2428)).toBeCloseTo(0, 5);
  });

  it("computes a known short distance (~0.95mi across central LA)", () => {
    // 34.0537,-118.2428 -> 34.0537,-118.2262 is ~0.95mi due east.
    const d = haversineMiles(34.0537, -118.2428, 34.0537, -118.2262);
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
  it("matches the configured home place within its radius", () => {
    // PLACES is built from the HOME_* env; with the public test defaults that is
    // { name: "Home", lat: 34.0537, lon: -118.2428, radiusMiles: 1 }.
    expect(findPlace(34.0537, -118.2428)?.name).toBe("Home");
  });

  it("returns undefined when outside every place radius", () => {
    // ~3mi north-west of the configured home, outside the 1mi radius.
    expect(findPlace(34.09, -118.33)).toBeUndefined();
  });

  it("returns the first matching place (order is priority)", () => {
    // The point exactly at the first place must resolve to that first place.
    const first = PLACES[0];
    expect(findPlace(first.lat, first.lon)?.name).toBe(first.name);
  });
});
