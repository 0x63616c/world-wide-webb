/**
 * Next12HoursView , pure presentational component tests.
 * No trpc mocking needed: all inputs are props.
 */
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { HourlyEntry, Next12HoursViewProps } from "../Next12HoursView";
import { Next12HoursView } from "../Next12HoursView";

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

const SAMPLE_HOURS: HourlyEntry[] = [
  { t: "Now", temp: 74, feels: 73, ic: "cloud-sun" },
  { t: "2", temp: 76, feels: 75, ic: "sun" },
  { t: "3", temp: 78, feels: 77, ic: "sun" },
  { t: "4", temp: 79, feels: 78, ic: "sun" },
  { t: "5", temp: 77, feels: 76, ic: "cloud-sun" },
  { t: "6", temp: 73, feels: 72, ic: "cloud" },
  { t: "7", temp: 70, feels: 69, ic: "cloud" },
  { t: "8", temp: 68, feels: 67, ic: "moon" },
  { t: "9", temp: 66, feels: 65, ic: "moon" },
  { t: "10", temp: 65, feels: 64, ic: "moon" },
  { t: "11", temp: 64, feels: 63, ic: "moon" },
  { t: "12", temp: 63, feels: 62, ic: "moon" },
];

const loadingProps: Next12HoursViewProps = { status: "loading" };
const populatedProps: Next12HoursViewProps = { status: "populated", hours: SAMPLE_HOURS };

describe("Next12HoursView , loading/skeleton state", () => {
  it("renders a .tile container", () => {
    const { container } = render(<Next12HoursView {...loadingProps} />);
    expect(container.querySelector(".tile")).toBeInTheDocument();
  });

  it("does not render hour labels", () => {
    render(<Next12HoursView {...loadingProps} />);
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
  });

  it("still renders the section header so the tile is identifiable while loading", () => {
    render(<Next12HoursView {...loadingProps} />);
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
  });
});

describe("Next12HoursView , populated state", () => {
  it("renders the section header", () => {
    render(<Next12HoursView {...populatedProps} />);
    expect(screen.getByText("Next 12 Hours")).toBeInTheDocument();
  });

  it("renders the legend items", () => {
    render(<Next12HoursView {...populatedProps} />);
    expect(screen.getByText("┈ Feels")).toBeInTheDocument();
    expect(screen.getByText("▮ Temp")).toBeInTheDocument();
  });

  it("renders the first hour label", () => {
    render(<Next12HoursView {...populatedProps} />);
    expect(screen.getAllByText("Now").length).toBeGreaterThan(0);
  });

  it("renders subsequent hour labels", () => {
    render(<Next12HoursView {...populatedProps} />);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("renders one bar per hour entry", () => {
    const { container } = render(<Next12HoursView {...populatedProps} />);
    const bars = container.querySelectorAll("[data-bar]");
    expect(bars.length).toBe(SAMPLE_HOURS.length);
  });

  it("renders exactly 12 bars for 12 data points", () => {
    const { container } = render(<Next12HoursView {...populatedProps} />);
    expect(container.querySelectorAll("[data-bar]").length).toBe(12);
  });

  it("renders the feels-like polyline", () => {
    const { container } = render(<Next12HoursView {...populatedProps} />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("feels-like polyline has opacity < 1 (subtlety)", () => {
    const { container } = render(<Next12HoursView {...populatedProps} />);
    const polyline = container.querySelector("polyline");
    const opacity = polyline?.getAttribute("opacity") ?? polyline?.style.opacity ?? "";
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  it("feels-like polyline uses rgba stroke, not a hex colour", () => {
    const { container } = render(<Next12HoursView {...populatedProps} />);
    const polyline = container.querySelector("polyline");
    const stroke = polyline?.getAttribute("stroke") ?? "";
    expect(stroke).not.toBe("#6E747D");
    expect(stroke).toMatch(/^rgba\(/);
  });

  // Regression: feels-like hotter than the hottest temp must stay inside the band,
  // not paint up over the header/title. gMax has to bound feels as well as gMin.
  it("keeps the feels-like line inside the band when feels exceeds the max temp", () => {
    const hotFeels: HourlyEntry[] = SAMPLE_HOURS.map((hr, i) => ({
      ...hr,
      feels: i === 0 ? hr.temp + 15 : hr.feels,
    }));
    const { container } = render(<Next12HoursView status="populated" hours={hotFeels} />);
    const points = container.querySelector("polyline")?.getAttribute("points") ?? "";
    const ys = points
      .trim()
      .split(/\s+/)
      .map((pt) => Number.parseFloat(pt.split(",")[1]));
    expect(ys.length).toBe(hotFeels.length);
    // y=0 is the band top; any negative y is drawn above it, over the header.
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
});
