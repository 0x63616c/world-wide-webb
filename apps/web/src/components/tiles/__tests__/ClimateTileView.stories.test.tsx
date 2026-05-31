/**
 * Vitest component tests for ClimateTileView stories.
 * Uses composeStories to execute each story (including play functions) in jsdom.
 */

import "@testing-library/jest-dom";
import { composeStories } from "@storybook/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as stories from "../ClimateTileView.stories";

const {
  Loading,
  CoolingMode,
  HeatingMode,
  HeatCoolMode,
  OffMode,
  ErrorFallbackSkeleton,
  ChipInteraction,
  SliderAttributes,
  MinSetpoint,
  MaxSetpoint,
} = composeStories(stories);

afterEach(cleanup);

describe("ClimateTileView stories", () => {
  it("Loading: shows skeleton, no setpoint or slider", async () => {
    const { container } = render(<Loading />);
    if (Loading.play) await Loading.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeTruthy();
    expect(screen.queryByTestId("setpoint")).toBeNull();
    expect(screen.queryByTestId("slider")).toBeNull();
  });

  it("CoolingMode: shows header, setpoint, mode pill, active cool chip, ambient label", async () => {
    const { container } = render(<CoolingMode />);
    if (CoolingMode.play) await CoolingMode.play({ canvasElement: container });
    expect(screen.getByText("Climate · A/C")).toBeDefined();
    expect(screen.getByTestId("setpoint").textContent).toContain("68");
    expect(screen.getByTestId("mode-pill").textContent).toBe("Cooling");
    expect(screen.getByTestId("chip-cool")).toHaveClass("on");
    expect(screen.getByTestId("chip-heat")).not.toHaveClass("on");
    expect(screen.getByTestId("ambient-label").textContent).toBe("74°");
  });

  it("HeatingMode: shows heat chip active and Heating pill", async () => {
    const { container } = render(<HeatingMode />);
    if (HeatingMode.play) await HeatingMode.play({ canvasElement: container });
    expect(screen.getByTestId("chip-heat")).toHaveClass("on");
    expect(screen.getByTestId("chip-cool")).not.toHaveClass("on");
    expect(screen.getByTestId("mode-pill").textContent).toBe("Heating");
  });

  it("HeatCoolMode: shows dual sliders, both setpoints, no single slider", async () => {
    const { container } = render(<HeatCoolMode />);
    if (HeatCoolMode.play) await HeatCoolMode.play({ canvasElement: container });
    expect(screen.getByTestId("chip-heat_cool")).toHaveClass("on");
    expect((screen.getByTestId("slider-low") as HTMLInputElement).value).toBe("68");
    expect((screen.getByTestId("slider-high") as HTMLInputElement).value).toBe("76");
    expect(screen.queryByTestId("slider")).toBeNull();
  });

  it("OffMode: shows Off and no sliders", async () => {
    const { container } = render(<OffMode />);
    if (OffMode.play) await OffMode.play({ canvasElement: container });
    expect(screen.getByTestId("chip-off")).toHaveClass("on");
    expect(screen.getByTestId("setpoint").textContent).toContain("Off");
    expect(screen.queryByTestId("slider")).toBeNull();
    expect(screen.queryByTestId("slider-low")).toBeNull();
  });

  it("ErrorFallbackSkeleton: shows skeleton, no setpoint", async () => {
    const { container } = render(<ErrorFallbackSkeleton />);
    if (ErrorFallbackSkeleton.play) await ErrorFallbackSkeleton.play({ canvasElement: container });
    expect(container.querySelector(".tile")).toBeTruthy();
    expect(screen.queryByTestId("setpoint")).toBeNull();
  });

  it("ChipInteraction: clicking cool and heat chips fires onSetMode callback", async () => {
    const { container } = render(<ChipInteraction />);
    if (ChipInteraction.play) await ChipInteraction.play({ canvasElement: container });
  });

  it("SliderAttributes: slider has correct min, max and initial value", async () => {
    const { container } = render(<SliderAttributes />);
    if (SliderAttributes.play) await SliderAttributes.play({ canvasElement: container });
    const slider = screen.getByTestId("slider") as HTMLInputElement;
    expect(slider.getAttribute("min")).toBe("65");
    expect(slider.getAttribute("max")).toBe("80");
    expect(slider.value).toBe("70");
  });

  it("MinSetpoint: shows setpoint 65 and slider at min", async () => {
    const { container } = render(<MinSetpoint />);
    if (MinSetpoint.play) await MinSetpoint.play({ canvasElement: container });
    expect(screen.getByTestId("setpoint").textContent).toContain("65");
    expect((screen.getByTestId("slider") as HTMLInputElement).value).toBe("65");
  });

  it("MaxSetpoint: shows setpoint 80 and slider at max", async () => {
    const { container } = render(<MaxSetpoint />);
    if (MaxSetpoint.play) await MaxSetpoint.play({ canvasElement: container });
    expect(screen.getByTestId("setpoint").textContent).toContain("80");
    expect((screen.getByTestId("slider") as HTMLInputElement).value).toBe("80");
  });
});
