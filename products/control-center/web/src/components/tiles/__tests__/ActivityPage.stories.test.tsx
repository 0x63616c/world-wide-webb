/**
 * Vitest component tests for ActivityPage stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ActivityPage.stories";

const { Grid, Timelapse, Empty } = composeStories(stories);

afterEach(cleanup);

describe("ActivityPage stories", () => {
  it("Grid: shows totals and day groups", async () => {
    const { container } = render(<Grid />);
    if (Grid.play) await Grid.play({ canvasElement: container });
    expect(screen.getByText(/39 photos/)).toBeDefined();
  });

  it("Timelapse: mode toggle reveals player controls", async () => {
    const { container } = render(<Timelapse />);
    if (Timelapse.play) await Timelapse.play({ canvasElement: container });
    expect(screen.getByLabelText("Scrub timelapse")).toBeDefined();
  });

  it("Empty: explains where photos come from", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
    expect(screen.getByText(/No activity photos yet/)).toBeDefined();
  });
});
