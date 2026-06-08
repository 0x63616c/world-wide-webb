/**
 * Vitest component tests for Icon stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GLYPHS } from "../Icon";
import * as stories from "../Icon.stories";

const { Gallery, Sizes, Colours, StrokeWidth, FanSpin } = composeStories(stories);

afterEach(cleanup);

const ICON_NAMES = Object.keys(GLYPHS);

describe("Icon stories — Gallery", () => {
  it("renders one labelled cell per IconName", async () => {
    const { container } = render(<Gallery />);
    if (Gallery.play) await Gallery.play({ canvasElement: container });
    const cells = container.querySelectorAll("[data-cell]");
    expect(cells).toHaveLength(ICON_NAMES.length);
    const svgs = container.querySelectorAll("svg");
    expect(svgs).toHaveLength(ICON_NAMES.length);
  });
});

describe("Icon stories — Sizes", () => {
  it("renders multiple svgs at different sizes", async () => {
    const { container } = render(<Sizes />);
    if (Sizes.play) await Sizes.play({ canvasElement: container });
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Icon stories — Colours", () => {
  it("renders multiple svgs at different colours", async () => {
    const { container } = render(<Colours />);
    if (Colours.play) await Colours.play({ canvasElement: container });
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Icon stories — StrokeWidth", () => {
  it("renders multiple svgs at different stroke widths", async () => {
    const { container } = render(<StrokeWidth />);
    if (StrokeWidth.play) await StrokeWidth.play({ canvasElement: container });
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(3);
  });
});

describe("Icon stories — FanSpin", () => {
  it("renders the fan svg glyph", async () => {
    const { container } = render(<FanSpin />);
    if (FanSpin.play) await FanSpin.play({ canvasElement: container });
    const svg = container.querySelector("svg");
    expect(svg).toBeInTheDocument();
  });
});
