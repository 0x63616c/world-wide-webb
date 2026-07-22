/**
 * Vitest component tests for TilePlaceholder stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../TilePlaceholder.stories";

const { Climate, Network } = composeStories(stories);

afterEach(cleanup);

describe("TilePlaceholder stories , Climate", () => {
  it("renders the header label and an svg icon", async () => {
    const { container } = render(<Climate />);
    if (Climate.play) await Climate.play({ canvasElement: container });
    expect(screen.getByText("Climate")).toBeInTheDocument();
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});

describe("TilePlaceholder stories , Network", () => {
  it("renders the header label and an svg icon", async () => {
    const { container } = render(<Network />);
    if (Network.play) await Network.play({ canvasElement: container });
    expect(screen.getByText("Network")).toBeInTheDocument();
    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThanOrEqual(1);
  });
});
