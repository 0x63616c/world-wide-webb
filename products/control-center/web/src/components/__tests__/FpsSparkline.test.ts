import { describe, expect, it } from "vitest";
import { buildSparklinePath } from "../FpsSparkline";

// Parse a "x,y x,y ..." points string into numeric pairs.
function points(path: string): Array<[number, number]> {
  if (path === "") return [];
  return path.split(" ").map((p) => {
    const [x, y] = p.split(",").map(Number);
    return [x, y] as [number, number];
  });
}

describe("buildSparklinePath", () => {
  it("emits one point per sample, evenly spaced across the width", () => {
    const pts = points(buildSparklinePath([60, 60, 60], 72, 16));
    expect(pts).toHaveLength(3);
    expect(pts.map(([x]) => x)).toEqual([0, 36, 72]);
  });

  it("inverts y , a higher FPS sits higher on screen (smaller y)", () => {
    const pts = points(buildSparklinePath([0, 60], 72, 16, 60));
    // fps 0 → bottom (y = height), fps 60 (== max) → top (y = 0).
    expect(pts[0][1]).toBe(16);
    expect(pts[1][1]).toBe(0);
  });

  it("clamps samples above the max to the top rather than overshooting", () => {
    const pts = points(buildSparklinePath([120], 72, 16, 60));
    // A single sample collapses to x = 0; clamped fps sits at y = 0 (the top).
    expect(pts).toEqual([[0, 0]]);
  });

  it("clamps negative samples to the bottom", () => {
    const pts = points(buildSparklinePath([-10, 60], 72, 16, 60));
    expect(pts[0][1]).toBe(16);
  });

  it("returns an empty string for empty input", () => {
    expect(buildSparklinePath([], 72, 16)).toBe("");
  });
});
