/**
 * Vitest component tests for TileHeader stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../TileHeader.stories";

const { Default, WithRightSlot, CustomSizes, LongTitle } = composeStories(stories);

afterEach(cleanup);

describe("TileHeader stories , Default", () => {
  it("renders the title text and an svg icon", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(screen.getByText("Weather")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("TileHeader stories , WithRightSlot", () => {
  it("renders the title, icon, and the right slot content", async () => {
    const { container } = render(<WithRightSlot />);
    if (WithRightSlot.play) await WithRightSlot.play({ canvasElement: container });
    expect(screen.getByText("Climate")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.getByTestId("right-slot")).toBeInTheDocument();
  });
});

describe("TileHeader stories , CustomSizes", () => {
  it("renders the title and icon with custom size props", async () => {
    const { container } = render(<CustomSizes />);
    if (CustomSizes.play) await CustomSizes.play({ canvasElement: container });
    expect(screen.getByText("Power")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});

describe("TileHeader stories , LongTitle", () => {
  it("renders a long title string without breaking", async () => {
    const { container } = render(<LongTitle />);
    if (LongTitle.play) await LongTitle.play({ canvasElement: container });
    expect(screen.getByText("Upcoming Events This Week")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });
});
