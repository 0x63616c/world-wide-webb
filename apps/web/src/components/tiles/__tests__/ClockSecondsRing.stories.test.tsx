/**
 * Vitest component tests for ClockSecondsRing stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClockSecondsRing.stories";

const { Default, FrozenHalf } = composeStories(stories);

afterEach(cleanup);

describe("ClockSecondsRing stories — Default", () => {
  it("renders the seconds-ring element", async () => {
    const { container } = render(<Default />);
    if (Default.play) await Default.play({ canvasElement: container });
    const ring = container.querySelector("[data-testid='seconds-ring']");
    expect(ring).toBeInTheDocument();
  });
});

describe("ClockSecondsRing stories — FrozenHalf", () => {
  it("renders an svg element", async () => {
    const { container } = render(<FrozenHalf />);
    if (FrozenHalf.play) await FrozenHalf.play({ canvasElement: container });
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });
});
