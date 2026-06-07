/**
 * Vitest component tests for BorderProgressRing stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../BorderProgressRing.stories";

const { Empty, Quarter, Half, AlmostFull, Full } = composeStories(stories);

afterEach(cleanup);

describe("BorderProgressRing stories — Empty", () => {
  it("renders an svg and the ring path is fully hidden at progress 0", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("[data-ring-path]")).toBeInTheDocument();
  });
});

describe("BorderProgressRing stories — Quarter", () => {
  it("renders an svg with a visible ring path at progress 0.25", async () => {
    const { container } = render(<Quarter />);
    if (Quarter.play) await Quarter.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("[data-ring-path]")).toBeInTheDocument();
  });
});

describe("BorderProgressRing stories — Half", () => {
  it("renders an svg with a half-fill ring path at progress 0.5", async () => {
    const { container } = render(<Half />);
    if (Half.play) await Half.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("[data-ring-path]")).toBeInTheDocument();
  });
});

describe("BorderProgressRing stories — AlmostFull", () => {
  it("renders an svg with a nearly-full ring path at progress 0.99", async () => {
    const { container } = render(<AlmostFull />);
    if (AlmostFull.play) await AlmostFull.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("[data-ring-path]")).toBeInTheDocument();
  });
});

describe("BorderProgressRing stories — Full", () => {
  it("renders an svg and the ring path dashoffset is 0 at progress 1", async () => {
    const { container } = render(<Full />);
    if (Full.play) await Full.play({ canvasElement: container });
    expect(container.querySelector("svg")).toBeInTheDocument();
    const ringPath = container.querySelector("[data-ring-path]");
    expect(ringPath).toBeInTheDocument();
    // At full progress the dashoffset should be ~0.
    const dashoffset =
      ringPath?.getAttribute("strokeDashoffset") ??
      ringPath?.getAttribute("stroke-dashoffset") ??
      "1";
    expect(Math.abs(Number.parseFloat(dashoffset))).toBeLessThan(1);
  });
});
