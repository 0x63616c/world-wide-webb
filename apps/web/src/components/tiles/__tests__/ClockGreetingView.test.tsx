/**
 * Unit tests for ClockGreetingView — pure presentational component.
 * No trpc, no hooks: all inputs are props.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClockGreetingView } from "../ClockGreetingView";

afterEach(cleanup);

const baseProps = {
  greeting: "Good morning",
  hour12: 9,
  minutes: "30",
  ampm: "AM" as const,
  fullDate: "Friday, May 29, 2026",
  location: "Home",
};

describe("ClockGreetingView", () => {
  it("renders greeting text", () => {
    render(<ClockGreetingView {...baseProps} />);
    expect(screen.getByText(/good morning/i)).toBeDefined();
  });

  it("renders the time with hours and padded minutes", () => {
    render(<ClockGreetingView {...baseProps} />);
    expect(screen.getByText(/9:30/)).toBeDefined();
  });

  it("renders AM/PM indicator", () => {
    render(<ClockGreetingView {...baseProps} />);
    const ampm = screen.getByTestId("clock-ampm");
    expect(ampm.textContent).toBe("AM");
  });

  it("renders PM when given ampm=PM", () => {
    render(
      <ClockGreetingView
        {...baseProps}
        ampm="PM"
        hour12={2}
        minutes="00"
        greeting="Good afternoon"
      />,
    );
    const ampm = screen.getByTestId("clock-ampm");
    expect(ampm.textContent).toBe("PM");
  });

  it("renders full date string", () => {
    render(<ClockGreetingView {...baseProps} />);
    const dateEl = screen.getByTestId("clock-date");
    expect(dateEl.textContent).toBe("Friday, May 29, 2026");
  });

  it("renders the location string", () => {
    render(<ClockGreetingView {...baseProps} />);
    expect(screen.getByText(/home/i)).toBeDefined();
  });

  it("renders the correct greeting for afternoon", () => {
    render(<ClockGreetingView {...baseProps} greeting="Good afternoon" />);
    expect(screen.getByText(/good afternoon/i)).toBeDefined();
  });

  it("renders the correct greeting for evening", () => {
    render(<ClockGreetingView {...baseProps} greeting="Good evening" />);
    expect(screen.getByText(/good evening/i)).toBeDefined();
  });

  it("renders the correct greeting for night", () => {
    render(<ClockGreetingView {...baseProps} greeting="Good night" />);
    expect(screen.getByText(/good night/i)).toBeDefined();
  });

  it("CC-882: tile wrapper has padding 28", () => {
    const { container } = render(<ClockGreetingView {...baseProps} />);
    const tile = container.firstChild as HTMLElement;
    expect(tile.style.padding).toBe("28px");
  });

  it("CC-882: date element has font-size 18", () => {
    render(<ClockGreetingView {...baseProps} />);
    const dateEl = screen.getByTestId("clock-date");
    expect(dateEl.style.fontSize).toBe("18px");
  });

  it("CC-oi9: AM/PM span has letter-spacing 0.02em (not inherited -.05em)", () => {
    render(<ClockGreetingView {...baseProps} />);
    const ampm = screen.getByTestId("clock-ampm");
    expect(ampm.style.letterSpacing).toBe("0.02em");
  });

  describe("CC-902: seconds ring", () => {
    it("renders a seconds-ring SVG overlay when seconds prop provided", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={0} />);
      const svg = container.querySelector("[data-testid='seconds-ring']");
      expect(svg).not.toBeNull();
    });

    it("does not render seconds-ring when seconds prop is omitted", () => {
      const { container } = render(<ClockGreetingView {...baseProps} />);
      const svg = container.querySelector("[data-testid='seconds-ring']");
      expect(svg).toBeNull();
    });

    it("seconds=0 has dashoffset equal to full perimeter (ring is empty at :00)", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={0} />);
      const path = container.querySelector(
        "[data-testid='seconds-ring-path']",
      ) as SVGPathElement | null;
      expect(path).not.toBeNull();
      const dasharray = path?.getAttribute("stroke-dasharray");
      const dashoffset = path?.getAttribute("stroke-dashoffset");
      // At :00 the offset equals the full perimeter so nothing is drawn yet
      expect(dasharray).toBe(dashoffset);
    });

    it("seconds=30 has dashoffset equal to half perimeter (ring half-full at :30)", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={30} />);
      const path = container.querySelector(
        "[data-testid='seconds-ring-path']",
      ) as SVGPathElement | null;
      expect(path).not.toBeNull();
      const perimeter = Number(path?.getAttribute("stroke-dasharray"));
      const offset = Number(path?.getAttribute("stroke-dashoffset"));
      // At :30 the remaining offset should be half the perimeter
      expect(offset).toBeCloseTo(perimeter / 2, 0);
    });

    it("seconds=60 has dashoffset=0 (ring fully drawn at :60)", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={60} />);
      const path = container.querySelector(
        "[data-testid='seconds-ring-path']",
      ) as SVGPathElement | null;
      expect(path).not.toBeNull();
      const offset = Number(path?.getAttribute("stroke-dashoffset"));
      expect(offset).toBeCloseTo(0, 0);
    });

    it("SVG overlay is absolutely positioned to fill the tile", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={15} />);
      const svg = container.querySelector("[data-testid='seconds-ring']") as SVGElement | null;
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("style")).toContain("position: absolute");
    });

    it("CC-902 review: SVG has negative margin to escape tile padding so stroke aligns with border", () => {
      // The tile has padding:28. Without margin:-28 the SVG fills only the inner
      // content box (481x256), causing non-uniform scaling against the 537x312 viewBox.
      const { container } = render(<ClockGreetingView {...baseProps} seconds={0} />);
      const svg = container.querySelector("[data-testid='seconds-ring']") as SVGElement | null;
      expect(svg).not.toBeNull();
      const style = svg?.getAttribute("style") ?? "";
      expect(style).toContain("margin: -28px");
    });

    it("CC-902 review: SVG viewBox matches CLOCK_TILE_W x CLOCK_TILE_H from board-layout constants", () => {
      // Constants must live in board-layout.ts so they track grid changes.
      const { container } = render(<ClockGreetingView {...baseProps} seconds={0} />);
      const svg = container.querySelector("[data-testid='seconds-ring']") as SVGElement | null;
      expect(svg).not.toBeNull();
      // 537x312 are derived from the 1366x1024 board at 5-col/2-row grid
      expect(svg?.getAttribute("viewBox")).toBe("0 0 537 312");
    });
  });
});
