/**
 * Vitest component tests for Skeleton stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../Skeleton.stories";

const { Default, Line, Block, PercentageWidth } = composeStories(stories);

afterEach(cleanup);

describe("Skeleton stories — Default", () => {
  it("renders a skeleton element", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(container.querySelector("[data-skeleton]")).toBeInTheDocument();
  });
});

describe("Skeleton stories — Line", () => {
  it("renders a skeleton element for a line replacement", async () => {
    const { container } = render(<Line />);
    if (Line.play) await Line.play({ canvasElement: container });
    expect(container.querySelector("[data-skeleton]")).toBeInTheDocument();
  });
});

describe("Skeleton stories — Block", () => {
  it("renders a skeleton element for a block placeholder", async () => {
    const { container } = render(<Block />);
    if (Block.play) await Block.play({ canvasElement: container });
    expect(container.querySelector("[data-skeleton]")).toBeInTheDocument();
  });
});

describe("Skeleton stories — PercentageWidth", () => {
  it("renders a skeleton element when w is a CSS string", async () => {
    const { container } = render(<PercentageWidth />);
    if (PercentageWidth.play) await PercentageWidth.play({ canvasElement: container });
    expect(container.querySelector("[data-skeleton]")).toBeInTheDocument();
  });
});
