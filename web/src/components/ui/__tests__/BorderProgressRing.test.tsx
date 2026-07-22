import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BorderProgressRing, perimeterLength, perimeterPath } from "../BorderProgressRing";

afterEach(cleanup);

describe("perimeterLength", () => {
  it("equals 4 sides for a square with no corner radius", () => {
    expect(perimeterLength(100, 100, 0)).toBe(400);
  });

  it("equals a circle's circumference when radius fills the box", () => {
    // r = 50 on a 100×100 box → the four quarter-arcs make a full circle.
    expect(perimeterLength(100, 100, 50)).toBeCloseTo(2 * Math.PI * 50, 6);
  });

  it("clamps an over-large radius so it never exceeds the circle case", () => {
    expect(perimeterLength(100, 100, 999)).toBeCloseTo(2 * Math.PI * 50, 6);
  });

  it("never goes negative for a zero-size box", () => {
    expect(perimeterLength(0, 0, 10)).toBe(0);
  });
});

describe("perimeterPath", () => {
  it("starts at the top-center of the box", () => {
    // box [0,0,100,100], so top-center is x=50, y=0.
    expect(perimeterPath(0, 0, 100, 100, 10, "cw").startsWith("M 50 0")).toBe(true);
  });

  it("draws four corner arcs", () => {
    const d = perimeterPath(0, 0, 100, 100, 10, "cw");
    expect(d.match(/ A /g)?.length).toBe(4);
  });

  it("uses opposite arc sweep flags for cw vs ccw", () => {
    expect(perimeterPath(0, 0, 100, 100, 10, "cw")).toContain("0 0 1");
    expect(perimeterPath(0, 0, 100, 100, 10, "ccw")).toContain("0 0 0");
  });
});

describe("BorderProgressRing", () => {
  // Pass explicit width/height to bypass DOM measurement (jsdom has no layout).
  const dims = { width: 100, height: 100, radius: 0, strokeWidth: 2 };

  function renderRing(progress: number) {
    const { container } = render(<BorderProgressRing {...dims} progress={progress} />);
    const path = container.querySelector("[data-ring-path]") as SVGPathElement;
    return {
      path,
      length: Number(path.getAttribute("stroke-dasharray")),
      offset: Number(path.getAttribute("stroke-dashoffset")),
    };
  }

  it("renders an svg and a progress path at an explicit size", () => {
    const { path, length } = renderRing(0.5);
    expect(path).not.toBeNull();
    expect(length).toBeGreaterThan(0);
  });

  it("is empty at progress 0 (offset == full length)", () => {
    const { length, offset } = renderRing(0);
    expect(offset).toBeCloseTo(length, 6);
  });

  it("is half filled at progress 0.5 (offset == half length)", () => {
    const { length, offset } = renderRing(0.5);
    expect(offset).toBeCloseTo(length / 2, 6);
  });

  it("is full at progress 1 (offset == 0)", () => {
    const { offset } = renderRing(1);
    expect(offset).toBeCloseTo(0, 6);
  });

  it("clamps progress above 1", () => {
    const { offset } = renderRing(1.5);
    expect(offset).toBeCloseTo(0, 6);
  });

  it("clamps progress below 0", () => {
    const { length, offset } = renderRing(-0.5);
    expect(offset).toBeCloseTo(length, 6);
  });

  it("has no CSS transition by default (caller drives progress smoothly)", () => {
    const { path } = renderRing(0.25);
    expect(path.getAttribute("style")).toContain("transition: none");
  });

  it("applies a CSS sweep transition when transitionMs is set", () => {
    const { container } = render(
      <BorderProgressRing {...dims} progress={0.25} transitionMs={500} />,
    );
    const path = container.querySelector("[data-ring-path]") as SVGPathElement;
    expect(path.getAttribute("style")).toContain("stroke-dashoffset 500ms");
  });
});
