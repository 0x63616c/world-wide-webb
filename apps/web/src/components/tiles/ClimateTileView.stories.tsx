/**
 * Stories for ClimateTileView — covers all visual states so addon-vitest
 * runs them as component tests in the vitest suite.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type { ClimateTileViewProps } from "./ClimateTileView";
import { ClimateTileView } from "./ClimateTileView";

// Shared callbacks placeholder — each story defines its own fn() so spy call
// history never leaks between tests.
const callbacks = { onSetTarget: fn(), onSetMode: fn(), onSetRange: fn() };

const meta = {
  ...defineTileMeta("ClimateTileView", ClimateTileView),
} satisfies Meta<typeof ClimateTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Loading (skeleton) ───────────────────────────────────────────────────────

export const Loading: Story = {
  args: { status: "loading" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
    expect(canvas.queryByTestId("setpoint")).not.toBeInTheDocument();
    expect(canvas.queryByTestId("slider")).not.toBeInTheDocument();
  },
};

// ─── Cool (single setpoint) ───────────────────────────────────────────────────

export const CoolingMode: Story = {
  args: {
    status: "populated",
    mode: "cool",
    target: 68,
    ambient: 74,
    action: "Cooling",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByText("Climate · A/C")).toBeInTheDocument();
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("68");
    expect(canvas.getByTestId("mode-pill")).toHaveTextContent("Cooling");

    // Cool active; single slider present, dual sliders absent.
    expect(canvas.getByTestId("chip-cool")).toHaveClass("on");
    expect(canvas.getByTestId("chip-heat")).not.toHaveClass("on");
    expect(canvas.getByTestId("slider")).toBeInTheDocument();
    expect(canvas.queryByTestId("slider-low")).not.toBeInTheDocument();

    expect(canvas.getByTestId("ambient-label")).toHaveTextContent("74°");
    expect(canvas.getByText("65°")).toBeInTheDocument();
    expect(canvas.getByText("80°")).toBeInTheDocument();
  },
};

// ─── Heat (single setpoint) ───────────────────────────────────────────────────

export const HeatingMode: Story = {
  args: {
    status: "populated",
    mode: "heat",
    target: 76,
    ambient: 70,
    action: "Heating",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("76");
    expect(canvas.getByTestId("mode-pill")).toHaveTextContent("Heating");
    expect(canvas.getByTestId("chip-heat")).toHaveClass("on");
    expect(canvas.getByTestId("slider")).toBeInTheDocument();
  },
};

// ─── Heat·Cool (dual setpoint) ────────────────────────────────────────────────

export const HeatCoolMode: Story = {
  args: {
    status: "populated",
    mode: "heat_cool",
    targetLow: 68,
    targetHigh: 76,
    ambient: 72,
    action: "Idle",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("chip-heat_cool")).toHaveClass("on");
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("68");
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("76");

    // Two sliders present, single slider absent.
    const low = canvas.getByTestId("slider-low") as HTMLInputElement;
    const high = canvas.getByTestId("slider-high") as HTMLInputElement;
    expect(low.value).toBe("68");
    expect(high.value).toBe("76");
    expect(canvas.queryByTestId("slider")).not.toBeInTheDocument();
  },
};

// ─── Off (no setpoint) ────────────────────────────────────────────────────────

export const OffMode: Story = {
  args: {
    status: "populated",
    mode: "off",
    ambient: 71,
    action: "Off",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("chip-off")).toHaveClass("on");
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("Off");
    // No sliders in off mode.
    expect(canvas.queryByTestId("slider")).not.toBeInTheDocument();
    expect(canvas.queryByTestId("slider-low")).not.toBeInTheDocument();
  },
};

// ─── Error/empty — component re-uses the Loading skeleton ────────────────────

export const ErrorFallbackSkeleton: Story = {
  name: "Error / Empty (skeleton)",
  args: { status: "loading" },
  parameters: {
    docs: {
      description: {
        story:
          "Container passes status='loading' on error; tile shows skeleton and keeps retrying.",
      },
    },
  },
  play: async ({ canvasElement }) => {
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
    expect(within(canvasElement).queryByTestId("setpoint")).not.toBeInTheDocument();
  },
};

// ─── Interaction: mode button fires onSetMode with the real hvac mode ─────────

export const ChipInteraction: Story = {
  args: {
    status: "populated",
    mode: "cool",
    target: 72,
    ambient: 72,
    action: "Cooling",
    onSetTarget: fn(),
    onSetMode: fn(),
    onSetRange: fn(),
  } as ClimateTileViewProps,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const { onSetMode } = args as Extract<ClimateTileViewProps, { status: "populated" }>;

    await userEvent.click(canvas.getByTestId("chip-heat"));
    expect(onSetMode).toHaveBeenCalledWith("heat");

    await userEvent.click(canvas.getByTestId("chip-heat_cool"));
    expect(onSetMode).toHaveBeenCalledWith("heat_cool");

    await userEvent.click(canvas.getByTestId("chip-off"));
    expect(onSetMode).toHaveBeenCalledWith("off");
  },
};

// ─── Slider attributes ────────────────────────────────────────────────────────

export const SliderAttributes: Story = {
  args: {
    status: "populated",
    mode: "cool",
    target: 70,
    ambient: 72,
    action: "Cooling",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    expect(slider).toHaveAttribute("min", "65");
    expect(slider).toHaveAttribute("max", "80");
    expect(slider.value).toBe("70");
  },
};

// ─── Min/max boundary values ──────────────────────────────────────────────────

export const MinSetpoint: Story = {
  args: {
    status: "populated",
    mode: "cool",
    target: 65,
    ambient: 66,
    action: "Cooling",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("65");
    expect((canvas.getByTestId("slider") as HTMLInputElement).value).toBe("65");
  },
};

export const MaxSetpoint: Story = {
  args: {
    status: "populated",
    mode: "heat",
    target: 80,
    ambient: 78,
    action: "Heating",
    ...callbacks,
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("80");
    expect((canvas.getByTestId("slider") as HTMLInputElement).value).toBe("80");
  },
};
