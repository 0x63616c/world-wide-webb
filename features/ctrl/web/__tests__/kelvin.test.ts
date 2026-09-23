import { describe, expect, it } from "vitest";
import { kelvinToHex, whiteSwatchHex } from "../kelvin";

function rgb(hex: string): [number, number, number] {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

describe("kelvinToHex", () => {
  it("is a six-digit hex color", () => {
    expect(kelvinToHex(2700)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("warms toward orange at low kelvin and whitens at high kelvin", () => {
    const [r1, g1, b1] = rgb(kelvinToHex(2000));
    const [r2, g2, b2] = rgb(kelvinToHex(6500));
    expect(r1).toBe(255);
    expect(b1).toBeLessThan(g1);
    expect(g1).toBeLessThan(r1);
    // Daylight white: every channel near full, blue no longer suppressed.
    expect(Math.min(r2, g2, b2)).toBeGreaterThan(240);
  });

  it("gets bluer monotonically as the temperature rises", () => {
    const blues = [2000, 2700, 3500, 4500, 5500, 6500].map((k) => rgb(kelvinToHex(k))[2]);
    for (let i = 1; i < blues.length; i++) expect(blues[i]).toBeGreaterThanOrEqual(blues[i - 1]);
  });

  it("whiteSwatchHex is a lighter, less saturated version of the same tint", () => {
    const raw = rgb(kelvinToHex(2700));
    const swatch = rgb(whiteSwatchHex(2700));
    expect(swatch[0]).toBe(255);
    expect(swatch[2]).toBeGreaterThan(raw[2]);
    expect(swatch[1]).toBeGreaterThan(raw[1]);
    expect(swatch[2]).toBeLessThan(swatch[1]);
  });
});
