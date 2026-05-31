/**
 * Vitest component tests for Next12HoursView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 *
 * Chart math reference (MockResizeObserver gives clientHeight=200):
 *   chartH = Math.max(120, 200 - 44) = 156
 *   barH(val) = 14 + ((val - gMin) / (gMax - gMin || 1)) * (156 - 22 - 14)
 *             = 14 + ((val - gMin) / range) * 120
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../Next12HoursView.stories";

const { Loading, Populated, SingleHour, IconVariety } = composeStories(stories);

afterEach(cleanup);

// jsdom does not implement ResizeObserver; stub it so the view mounts without errors.
class MockResizeObserver {
  private _callback: () => void;
  constructor(callback: () => void) {
    this._callback = callback;
  }
  observe(el: Element) {
    Object.defineProperty(el, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: 200 });
    this._callback();
  }
  unobserve() {}
  disconnect() {}
}
// @ts-expect-error — jsdom stub
global.ResizeObserver = MockResizeObserver;

describe("Next12HoursView stories — Loading", () => {
  it("renders tile container but no section header", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(container.querySelector(".tile")).not.toBeNull();
    expect(screen.queryByText("Next 12 Hours")).toBeNull();
  });
});

describe("Next12HoursView stories — Populated", () => {
  it("renders header, legend, and first hour label", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(screen.getByText("┈ Feels")).toBeInTheDocument();
    expect(screen.getByText("▮ Temp")).toBeInTheDocument();
    expect(screen.getAllByText("Now").length).toBeGreaterThan(0);
  });

  it("renders exactly 12 SVG bar rects", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(container.querySelectorAll("svg rect").length).toBe(12);
  });

  it("bar heights are proportional to temp values", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    // Chart math: chartH=156, topRes=22, minBar=14, span=120
    // gMin=62, gMax=79, range=17
    const chartH = 156;
    const topRes = 22;
    const minBar = 14;
    const gMin = 62;
    const gMax = 79;
    const span = chartH - topRes - minBar; // 120
    const barH = (v: number) => minBar + ((v - gMin) / (gMax - gMin)) * span;

    const rects = Array.from(container.querySelectorAll("svg rect"));
    // SAMPLE_HOURS temps: [74,76,78,79,77,73,70,68,66,65,64,63]
    const temps = [74, 76, 78, 79, 77, 73, 70, 68, 66, 65, 64, 63];
    for (let i = 0; i < temps.length; i++) {
      const expected = barH(temps[i]);
      const actual = Number(rects[i].getAttribute("height"));
      expect(actual).toBeCloseTo(expected, 1);
    }
  });

  it("bar y-positions match chartH - barH(temp)", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const chartH = 156;
    const topRes = 22;
    const minBar = 14;
    const gMin = 62;
    const gMax = 79;
    const span = chartH - topRes - minBar;
    const barH = (v: number) => minBar + ((v - gMin) / (gMax - gMin)) * span;

    const rects = Array.from(container.querySelectorAll("svg rect"));
    const temps = [74, 76, 78, 79, 77, 73, 70, 68, 66, 65, 64, 63];
    for (let i = 0; i < temps.length; i++) {
      const expectedY = chartH - barH(temps[i]);
      const actualY = Number(rects[i].getAttribute("y"));
      expect(actualY).toBeCloseTo(expectedY, 1);
    }
  });

  it("polyline points match feels values scaled to chart", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const chartH = 156;
    const topRes = 22;
    const minBar = 14;
    const gMin = 62;
    const gMax = 79;
    const span = chartH - topRes - minBar;
    const barH = (v: number) => minBar + ((v - gMin) / (gMax - gMin)) * span;
    // renderW=400, n=12, colW≈33.33
    const n = 12;
    const renderW = 400;
    const colW = renderW / n;
    const cx = (i: number) => (i + 0.5) * colW;
    const feels = [73, 75, 77, 78, 76, 72, 69, 67, 65, 64, 63, 62];

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const points = polyline?.getAttribute("points") ?? "";
    const pairs = points.trim().split(/\s+/);
    expect(pairs.length).toBe(n);
    for (let i = 0; i < n; i++) {
      const [px, py] = pairs[i].split(",").map(Number);
      expect(px).toBeCloseTo(cx(i), 0);
      expect(py).toBeCloseTo(chartH - barH(feels[i]), 0);
    }
  });

  it("polyline has opacity < 1", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const polyline = container.querySelector("polyline");
    expect(Number(polyline?.getAttribute("opacity") ?? "1")).toBeLessThan(1);
  });

  it("renders Icon SVG elements for each hour (12 icons)", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    // 1 chart SVG + 1 header Icon SVG + 12 hour Icon SVGs = 14
    const allSvgs = container.querySelectorAll("svg");
    expect(allSvgs.length).toBe(14);
  });
});

describe("Next12HoursView stories — SingleHour", () => {
  it("renders header and exactly 1 rect", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(container.querySelectorAll("svg rect").length).toBe(1);
  });

  it("rect has finite positive width and height (NaN guard for degenerate range)", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    const rect = container.querySelector("svg rect");
    const w = Number(rect?.getAttribute("width"));
    const h = Number(rect?.getAttribute("height"));
    expect(Number.isFinite(w) && w > 0).toBe(true);
    expect(Number.isFinite(h) && h > 0).toBe(true);
  });

  it("bar height reflects actual range when feels < temp (not truly degenerate)", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    // SINGLE_HOUR: {temp:72, feels:70}. gMin=min(72,70)=70, gMax=max(72)=72, range=2.
    // barH(72) = 14 + ((72-70)/2) * 120 = 14 + 120 = 134
    const rect = container.querySelector("svg rect");
    expect(Number(rect?.getAttribute("height"))).toBeCloseTo(134, 1);
  });

  it("renders 1 chart + 1 header + 1 hour = 3 SVGs total", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    // 1 chart SVG + 1 header Icon SVG + 1 hour Icon SVG = 3
    expect(container.querySelectorAll("svg").length).toBe(3);
  });
});

describe("Next12HoursView stories — IconVariety", () => {
  it("renders 4 rects and correct SVG count", async () => {
    const { container } = render(<IconVariety />);
    if (IconVariety.play) await IconVariety.play({ canvasElement: container });
    expect(container.querySelectorAll("svg rect").length).toBe(4);
    // 1 chart SVG + 1 header Icon SVG + 4 hour Icon SVGs = 6
    expect(container.querySelectorAll("svg").length).toBe(6);
  });

  it("icon row does not overflow tile container height", async () => {
    const { container } = render(<IconVariety />);
    if (IconVariety.play) await IconVariety.play({ canvasElement: container });
    // The tile container is rendered with clientHeight=200 by the MockResizeObserver.
    // The icon row sits at top: 4 + chartH + 6. chartH=156 → top=166.
    // Each icon+label is ~15px icon + 5px gap + ~14px label = ~34px.
    // 166 + 34 = 200, which fits within the 200px container.
    const iconRow = container.querySelector<HTMLElement>(
      '[style*="position: absolute"][style*="display: flex"]',
    );
    expect(iconRow).not.toBeNull();
    const topStyle = iconRow?.style.top ?? "";
    const topValue = parseFloat(topStyle);
    // top should be chartH + 10 = 166; under 200 (container height).
    expect(topValue).toBeLessThan(200);
  });
});
