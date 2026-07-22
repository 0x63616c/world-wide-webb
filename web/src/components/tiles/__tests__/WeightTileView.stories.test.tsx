/**
 * Vitest component tests for WeightTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../WeightTileView.stories";

const { Loading, ErrorState, Populated, DeltaUp, Empty, FirstReading, RecencyFormat } =
  composeStories(stories);

afterEach(cleanup);

describe("WeightTileView stories", () => {
  it("Loading: skeleton only, no weight number", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.queryByTestId("weight-spark-dot")).toBeNull();
  });

  it("ErrorState: falls back to the skeleton face", async () => {
    const { container } = render(<ErrorState />);
    if (ErrorState.play) await ErrorState.play({ canvasElement: container });
    expect(screen.getByText("Weight")).toBeInTheDocument();
  });

  it("Populated: hero number, delta badge, sparkline with latest-point dot", async () => {
    const { container } = render(<Populated />);
    if (Populated.play) await Populated.play({ canvasElement: container });
    expect(screen.getByText("180.1")).toBeInTheDocument();
    expect(screen.getByTestId("weight-spark-dot")).toBeInTheDocument();
    expect(container.querySelector("svg path")).toBeTruthy();
  });

  it("DeltaUp: upward delta renders muted, not accent", async () => {
    const { container } = render(<DeltaUp />);
    if (DeltaUp.play) await DeltaUp.play({ canvasElement: container });
    expect(screen.getByText(/2\.3 lb \/ 30d/)).toBeInTheDocument();
  });

  it("Empty: populated with no readings still shows the skeleton, never a fake number", async () => {
    const { container } = render(<Empty />);
    if (Empty.play) await Empty.play({ canvasElement: container });
    expect(screen.getByText("Weight")).toBeInTheDocument();
    expect(screen.queryByText(/lb/)).toBeNull();
  });

  it("FirstReading: a single point draws no sparkline and no lone dot", async () => {
    const { container } = render(<FirstReading />);
    if (FirstReading.play) await FirstReading.play({ canvasElement: container });
    expect(screen.getByText("180.1")).toBeInTheDocument();
    // The regression this guards: one measurement used to render the
    // latest-point dot floating over an empty chart box.
    expect(screen.queryByTestId("weight-spark-dot")).toBeNull();
    // The box is still reserved so the hero number stays bottom-aligned — but
    // it is empty (scoped to the box: the tile header icon is an svg too).
    const box = screen.getByTestId("weight-spark");
    expect(box).toBeInTheDocument();
    expect(box.querySelector("svg")).toBeNull();
  });

  it("RecencyFormat: Today / Yesterday / absolute date", async () => {
    const { container } = render(<RecencyFormat />);
    if (RecencyFormat.play) await RecencyFormat.play({ canvasElement: container });
  });
});
