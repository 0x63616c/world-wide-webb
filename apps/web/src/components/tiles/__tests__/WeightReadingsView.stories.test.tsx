/**
 * Vitest component tests for WeightReadingsView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../WeightReadingsView.stories";

const { Populated, DayExpanded, AutoFlagged, SingleDay, Loading, Empty } = composeStories(stories);

afterEach(cleanup);

describe("WeightReadingsView stories", () => {
  it("Populated: days collapse by default and expand to their readings", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("160.6")).toBeInTheDocument();
  });

  it("DayExpanded: delete is gated behind the confirm dialog", async () => {
    const { container } = render(<DayExpanded />);
    if (DayExpanded.play) await DayExpanded.play({ canvasElement: container });
  });

  it("AutoFlagged: only an auto-flagged reading offers to be counted again", async () => {
    const { container } = render(<AutoFlagged />);
    if (AutoFlagged.play) await AutoFlagged.play({ canvasElement: container });
  });

  it("SingleDay: no earlier day, so no day-over-day figure", async () => {
    const { container } = render(<SingleDay />);
    if (SingleDay.play) await SingleDay.play({ canvasElement: container });
  });

  it("Loading: skeleton only, no medians", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
  });

  it("Empty: prompts for a first weigh-in", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
  });
});
