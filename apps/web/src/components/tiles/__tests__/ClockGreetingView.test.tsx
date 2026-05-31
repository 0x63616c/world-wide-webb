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

  it("www-882: tile wrapper has padding 28", () => {
    const { container } = render(<ClockGreetingView {...baseProps} />);
    const tile = container.firstChild as HTMLElement;
    expect(tile.style.padding).toBe("28px");
  });

  it("www-882: date element has font-size 18", () => {
    render(<ClockGreetingView {...baseProps} />);
    const dateEl = screen.getByTestId("clock-date");
    expect(dateEl.style.fontSize).toBe("18px");
  });

  it("www-oi9: AM/PM span has letter-spacing 0.02em (not inherited -.05em)", () => {
    render(<ClockGreetingView {...baseProps} />);
    const ampm = screen.getByTestId("clock-ampm");
    expect(ampm.style.letterSpacing).toBe("0.02em");
  });

  describe("www-902: seconds ring", () => {
    // Geometry (perimeter length, dashoffset mapping) is covered by
    // BorderProgressRing's own tests. jsdom has no layout engine, so here we only
    // assert the ring is wired in and positioned as an overlay.
    it("renders the seconds-ring overlay when the seconds prop is provided", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={0} />);
      expect(container.querySelector("[data-testid='seconds-ring']")).not.toBeNull();
    });

    it("does not render the ring when seconds is omitted", () => {
      const { container } = render(<ClockGreetingView {...baseProps} />);
      expect(container.querySelector("[data-testid='seconds-ring']")).toBeNull();
    });

    it("renders the ring as an absolutely-positioned overlay", () => {
      const { container } = render(<ClockGreetingView {...baseProps} seconds={15} />);
      const svg = container.querySelector("[data-testid='seconds-ring']") as SVGElement | null;
      expect(svg).not.toBeNull();
      expect(svg?.getAttribute("style")).toContain("position: absolute");
    });
  });
});
