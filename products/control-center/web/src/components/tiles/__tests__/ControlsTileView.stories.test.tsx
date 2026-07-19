/**
 * Vitest component tests for ControlsTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react-vite";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ControlsTileView.stories";

const {
  Loading,
  ErrorEmpty,
  AllOn,
  AllOff,
  LightsKitchenOnly,
  LightsOverheadOnly,
  Mixed,
  Pending,
  ToggleInteraction,
  LightsCycleInteraction,
} = composeStories(stories);

afterEach(cleanup);

describe("ControlsTileView stories", () => {
  it("Loading: shows header, no tap buttons while skeletons show", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(screen.getByText("Controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lamps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fan" })).toBeNull();
  });

  it("ErrorEmpty: shows header, no tap buttons (skeleton shimmer)", async () => {
    const { container } = render(<ErrorEmpty />);
    if (ErrorEmpty.play) await ErrorEmpty.play({ canvasElement: container });
    expect(screen.getByText("Controls")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Lamps" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Fan" })).toBeNull();
  });

  it("AllOn: all controls aria-pressed=true, fan spin running", async () => {
    const { container } = render(<AllOn />);
    if (AllOn.play) await AllOn.play({ canvasElement: container });
    expect(screen.getByRole("button", { name: "Lamps" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lights" })).toHaveAttribute("aria-pressed", "true");
    const fan = screen.getByRole("button", { name: "Fan" });
    expect(fan).toHaveAttribute("aria-pressed", "true");
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
  });

  it("AllOff: all controls aria-pressed=false, fan spin paused", async () => {
    const { container } = render(<AllOff />);
    if (AllOff.play) await AllOff.play({ canvasElement: container });
    expect(screen.getByRole("button", { name: "Lamps" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Fan" })).toHaveAttribute("aria-pressed", "false");
    const fan = screen.getByRole("button", { name: "Fan" });
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  });

  it("Mixed: lamps on, lights off", async () => {
    const { container } = render(<Mixed />);
    if (Mixed.play) await Mixed.play({ canvasElement: container });
    expect(screen.getByRole("button", { name: "Lamps" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Lights" })).toHaveAttribute("aria-pressed", "false");
  });

  it("Pending: lamps has data-pending, lights does not", async () => {
    const { container } = render(<Pending />);
    if (Pending.play) await Pending.play({ canvasElement: container });
    expect(screen.getByRole("button", { name: "Lamps" })).toHaveAttribute("data-pending", "true");
    expect(screen.getByRole("button", { name: "Lights" })).not.toHaveAttribute("data-pending");
  });

  it("ToggleInteraction: clicking lamps and fan fires onToggle with correct args", async () => {
    const { container } = render(<ToggleInteraction />);
    if (ToggleInteraction.play) await ToggleInteraction.play({ canvasElement: container });
  });

  it("LightsKitchenOnly: Lights shows K ON, pressed", async () => {
    const { container } = render(<LightsKitchenOnly />);
    if (LightsKitchenOnly.play) await LightsKitchenOnly.play({ canvasElement: container });
    const lights = screen.getByRole("button", { name: "Lights" });
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveTextContent("K ON");
  });

  it("LightsOverheadOnly: Lights shows O ON, pressed", async () => {
    const { container } = render(<LightsOverheadOnly />);
    if (LightsOverheadOnly.play) await LightsOverheadOnly.play({ canvasElement: container });
    const lights = screen.getByRole("button", { name: "Lights" });
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveTextContent("O ON");
  });

  it("LightsCycleInteraction: tapping Lights fires onLightsCycle (advances the mode)", async () => {
    const { container } = render(<LightsCycleInteraction />);
    if (LightsCycleInteraction.play)
      await LightsCycleInteraction.play({ canvasElement: container });
  });
});
