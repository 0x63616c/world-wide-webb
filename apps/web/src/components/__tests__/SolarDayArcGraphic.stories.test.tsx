/**
 * Vitest component tests for SolarDayArcGraphic stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../SolarDayArcGraphic.stories";

const { Daytime, Sunrise, Sunset, BelowHorizon, ClockModalDims, WeatherModalDims } =
  composeStories(stories);

afterEach(cleanup);

describe("SolarDayArcGraphic stories — Daytime", () => {
  it("renders the SVG and at least 2 circles (sun disc + markers)", async () => {
    const { container } = render(<Daytime />);
    if (Daytime.play) await Daytime.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    const circles = container.querySelectorAll("svg circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SolarDayArcGraphic stories — Sunrise", () => {
  it("renders the SVG and sun disc near the left arc endpoint", async () => {
    const { container } = render(<Sunrise />);
    if (Sunrise.play) await Sunrise.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    const circles = container.querySelectorAll("svg circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SolarDayArcGraphic stories — Sunset", () => {
  it("renders the SVG and sun disc near the right arc endpoint", async () => {
    const { container } = render(<Sunset />);
    if (Sunset.play) await Sunset.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    const circles = container.querySelectorAll("svg circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SolarDayArcGraphic stories — BelowHorizon", () => {
  it("renders the SVG in night state", async () => {
    const { container } = render(<BelowHorizon />);
    if (BelowHorizon.play) await BelowHorizon.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    const circles = container.querySelectorAll("svg circle");
    expect(circles.length).toBeGreaterThanOrEqual(2);
  });
});

describe("SolarDayArcGraphic stories — ClockModalDims", () => {
  it("renders SVG with 680×200 viewport matching CLOCK_ARC_DIMS", async () => {
    const { container } = render(<ClockModalDims />);
    if (ClockModalDims.play) await ClockModalDims.play({ canvasElement: container });
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute("width")).toBe("680");
    expect(svg?.getAttribute("height")).toBe("200");
  });
});

describe("SolarDayArcGraphic stories — WeatherModalDims", () => {
  it("renders SVG with 600×220 viewport matching WEATHER_ARC_DIMS", async () => {
    const { container } = render(<WeatherModalDims />);
    if (WeatherModalDims.play) await WeatherModalDims.play({ canvasElement: container });
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute("width")).toBe("600");
    expect(svg?.getAttribute("height")).toBe("220");
  });
});
