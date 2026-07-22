/**
 * Vitest smoke tests for WheelPicker stories , composeStories executes each
 * story (including its play assertions) in jsdom, so a story that breaks
 * breaks CI, not just Storybook.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../WheelPicker.stories";

const { Hours, Minutes, TapSelects } = composeStories(stories);

afterEach(cleanup);

describe("WheelPicker stories", () => {
  it("Hours renders with the selected row centered", async () => {
    const { container } = render(<Hours />);
    await Hours.play?.({ canvasElement: container });
    expect(container.querySelector('[role="listbox"]')).toBeInTheDocument();
  });

  it("Minutes marks the passed value selected", async () => {
    const { container } = render(<Minutes />);
    await Minutes.play?.({ canvasElement: container });
  });

  it("TapSelects commits the tapped row", async () => {
    const { container } = render(<TapSelects />);
    await TapSelects.play?.({ canvasElement: container });
  });
});
