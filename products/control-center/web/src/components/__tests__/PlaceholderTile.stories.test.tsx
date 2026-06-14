/**
 * Vitest component tests for PlaceholderTile stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../PlaceholderTile.stories";

const { Default } = composeStories(stories);

afterEach(cleanup);

describe("PlaceholderTile stories , Default", () => {
  it("renders a .tile element", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeInTheDocument();
  });
});
