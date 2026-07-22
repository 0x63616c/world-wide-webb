/**
 * Vitest component tests for ExpandedControlsView stories.
 * composeStories executes each story (incl. play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ExpandedControlsView.stories";

const { Open, LampsOff, SceneInteraction, BlueActive, PartyActive, BrightnessInteraction } =
  composeStories(stories);

afterEach(cleanup);

describe("ExpandedControlsView stories", () => {
  it("Open: grid reused (no More), all scenes + enabled slider", async () => {
    const { container } = render(<Open />);
    if (Open.play) await Open.play({ canvasElement: container });
    expect(screen.getByLabelText("Lamps")).toBeInTheDocument();
    expect(screen.queryByLabelText("More")).toBeNull();
    expect(screen.getByRole("button", { name: "Mood" })).toBeInTheDocument();
    expect(screen.getByLabelText("Brightness")).not.toBeDisabled();
  });

  it("LampsOff: brightness slider disabled", async () => {
    const { container } = render(<LampsOff />);
    if (LampsOff.play) await LampsOff.play({ canvasElement: container });
    expect(screen.getByLabelText("Brightness")).toBeDisabled();
  });

  it("SceneInteraction: each scene button fires onScene with its id", async () => {
    const { container } = render(<SceneInteraction />);
    if (SceneInteraction.play) await SceneInteraction.play({ canvasElement: container });
  });

  it("BlueActive: Blue scene tile highlighted, others not", async () => {
    const { container } = render(<BlueActive />);
    if (BlueActive.play) await BlueActive.play({ canvasElement: container });
  });

  it("PartyActive: Party tile highlighted + tappable", async () => {
    const { container } = render(<PartyActive />);
    if (PartyActive.play) await PartyActive.play({ canvasElement: container });
  });

  it("BrightnessInteraction: slider fires onBrightness", async () => {
    const { container } = render(<BrightnessInteraction />);
    if (BrightnessInteraction.play) await BrightnessInteraction.play({ canvasElement: container });
  });
});
