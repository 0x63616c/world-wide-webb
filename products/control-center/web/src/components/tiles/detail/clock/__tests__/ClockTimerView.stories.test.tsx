/**
 * Vitest smoke tests for ClockTimerView stories , composeStories executes
 * each story's play assertions (empty entry, hero digits, grid trio) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClockTimerView.stories";

const { Empty, OneRunning, GridOfThree } = composeStories(stories);

afterEach(cleanup);

describe("ClockTimerView stories", () => {
  it("Empty centers the presets with Start disabled", async () => {
    const { container } = render(<Empty />);
    await Empty.play?.({ canvasElement: container });
    expect(screen.getByText("No timers running")).toBeInTheDocument();
  });

  it("OneRunning renders the hero card with live digits", async () => {
    const { container } = render(<OneRunning />);
    await OneRunning.play?.({ canvasElement: container });
    expect(screen.getByText("Tea")).toBeInTheDocument();
  });

  it("GridOfThree renders running + paused + ringing side by side", async () => {
    const { container } = render(<GridOfThree />);
    await GridOfThree.play?.({ canvasElement: container });
    expect(screen.getByTestId("timer-card-grid")).toBeInTheDocument();
  });
});
