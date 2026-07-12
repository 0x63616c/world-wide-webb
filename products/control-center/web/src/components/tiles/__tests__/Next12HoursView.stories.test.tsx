/**
 * Vitest component tests for Next12HoursView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 *
 * Bars are flex-column <div data-bar> elements (height in px), not SVG rects.
 * Chart math (MockResizeObserver gives the bar band clientWidth=400, clientHeight=200):
 *   bandH = 200, bandW = 400
 *   barH(val) = MIN_BAR + ((val - gMin) / (gMax - gMin || 1)) * (bandH - LABEL_HEADROOM - MIN_BAR)
 *             = 14 + ((val - gMin) / range) * (200 - 22 - 14)
 *             = 14 + ((val - gMin) / range) * 164
 * The feels-like overlay stays an SVG polyline; column centers are colCx(i)=(i+0.5)*bandW/n.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
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
// @ts-expect-error , jsdom stub
global.ResizeObserver = MockResizeObserver;

// Bar-height scale, mirroring the view (bandH=200, bandW=400 from the mock).
const MIN_BAR = 14;
const LABEL_HEADROOM = 22;
const BAND_H = 200;
const BAND_W = 400;
const SPAN = BAND_H - LABEL_HEADROOM - MIN_BAR; // 164
function makeBarH(gMin: number, gMax: number) {
  return (v: number) => MIN_BAR + ((v - gMin) / (gMax - gMin || 1)) * SPAN;
}

describe("Next12HoursView stories , Loading", () => {
  it("renders tile container and keeps the section header visible while loading", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(container.querySelector(".tile")).not.toBeNull();
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
  });
});

describe("Next12HoursView stories , Populated", () => {
  // SAMPLE_HOURS temps/feels , gMin = min(all temps, all feels) = 62, gMax = max(temps) = 79.
  const temps = [74, 76, 78, 79, 77, 73, 70, 68, 66, 65, 64, 63];
  const feels = [73, 75, 77, 78, 76, 72, 69, 67, 65, 64, 63, 62];
  const barH = makeBarH(62, 79);

  it("renders header, legend, and first hour label", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(screen.getByText("┈ Feels")).toBeInTheDocument();
    expect(screen.getByText("▮ Temp")).toBeInTheDocument();
    expect(screen.getAllByText("Now").length).toBeGreaterThan(0);
  });

  it("renders exactly 12 bars", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(container.querySelectorAll("[data-bar]").length).toBe(12);
  });

  it("bar heights are proportional to temp values", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const bars = Array.from(container.querySelectorAll<HTMLElement>("[data-bar]"));
    for (let i = 0; i < temps.length; i++) {
      expect(parseFloat(bars[i].style.height)).toBeCloseTo(barH(temps[i]), 1);
    }
  });

  it("the hottest hour has the tallest bar", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const heights = Array.from(container.querySelectorAll<HTMLElement>("[data-bar]")).map((b) =>
      parseFloat(b.style.height),
    );
    expect(heights.indexOf(Math.max(...heights))).toBe(temps.indexOf(Math.max(...temps)));
  });

  it("polyline points match feels values scaled to the bar band", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const n = 12;
    const colCx = (i: number) => ((i + 0.5) * BAND_W) / n;

    const polyline = container.querySelector("polyline");
    expect(polyline).not.toBeNull();
    const pairs = (polyline?.getAttribute("points") ?? "").trim().split(/\s+/);
    expect(pairs.length).toBe(n);
    for (let i = 0; i < n; i++) {
      const [px, py] = pairs[i].split(",").map(Number);
      expect(px).toBeCloseTo(colCx(i), 0);
      expect(py).toBeCloseTo(BAND_H - barH(feels[i]), 0);
    }
  });

  it("polyline has opacity < 1", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    const polyline = container.querySelector("polyline");
    expect(Number(polyline?.getAttribute("opacity") ?? "1")).toBeLessThan(1);
  });

  it("renders Icon SVG elements for each hour (14 svgs total)", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    // 1 feels-overlay SVG + 1 header Icon SVG + 12 hour Icon SVGs = 14
    expect(container.querySelectorAll("svg").length).toBe(14);
  });
});

describe("Next12HoursView stories , SingleHour", () => {
  it("renders header and exactly 1 bar", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-bar]").length).toBe(1);
  });

  it("bar has finite positive height (NaN guard for degenerate range)", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    const bar = container.querySelector<HTMLElement>("[data-bar]");
    const h = parseFloat(bar?.style.height ?? "");
    expect(Number.isFinite(h) && h > 0).toBe(true);
  });

  it("bar height reflects actual range when feels < temp (not truly degenerate)", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    // SINGLE_HOUR: {temp:72, feels:70}. gMin=min(72,70)=70, gMax=72, range=2.
    // barH(72) = 14 + ((72-70)/2) * 164 = 14 + 164 = 178
    const bar = container.querySelector<HTMLElement>("[data-bar]");
    expect(parseFloat(bar?.style.height ?? "")).toBeCloseTo(178, 1);
  });

  it("renders 1 overlay + 1 header + 1 hour = 3 SVGs total", async () => {
    const { container } = render(<SingleHour />);
    if (SingleHour.play) await SingleHour.play({ canvasElement: container });
    // 1 feels-overlay SVG + 1 header Icon SVG + 1 hour Icon SVG = 3
    expect(container.querySelectorAll("svg").length).toBe(3);
  });
});

describe("Next12HoursView stories , IconVariety", () => {
  it("renders 4 bars and correct SVG count", async () => {
    const { container } = render(<IconVariety />);
    if (IconVariety.play) await IconVariety.play({ canvasElement: container });
    expect(container.querySelectorAll("[data-bar]").length).toBe(4);
    // 1 feels-overlay SVG + 1 header Icon SVG + 4 hour Icon SVGs = 6
    expect(container.querySelectorAll("svg").length).toBe(6);
  });

  it("uses a flex layout (no absolutely-positioned icon row with magic offsets)", async () => {
    const { container } = render(<IconVariety />);
    if (IconVariety.play) await IconVariety.play({ canvasElement: container });
    // The refactor stacks bar band + label band in a flex column (even spacing by
    // construction), so there is no absolutely-positioned icon row to overflow.
    const absFlexRow = container.querySelector(
      '[style*="position: absolute"][style*="display: flex"]',
    );
    expect(absFlexRow).toBeNull();
  });
});
