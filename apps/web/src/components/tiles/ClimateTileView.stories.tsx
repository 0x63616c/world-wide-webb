/**
 * Stories for ClimateTileView — covers all visual states so addon-vitest
 * runs them as component tests in the vitest suite.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ClimateTileViewProps } from "./ClimateTileView";
import { ClimateTileView } from "./ClimateTileView";

// Shared spy stubs — re-used across populated stories.
const onSetTarget = fn();
const onSetMode = fn();

// Base populated args — all required populated-state props in one place.
const populatedBase: ClimateTileViewProps = {
  status: "populated",
  target: 68,
  ambient: 74,
  mode: "cool",
  action: "Cooling",
  onSetTarget,
  onSetMode,
};

const meta = {
  title: "Tiles/ClimateTileView",
  component: ClimateTileView,
  tags: ["autodocs"],
  // BoardDecorator is global in preview.tsx — no local decorator needed.
} satisfies Meta<typeof ClimateTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Loading (skeleton) ───────────────────────────────────────────────────────

export const Loading: Story = {
  args: {
    status: "loading",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Skeleton renders a .tile container but no setpoint or slider.
    const tile = canvasElement.querySelector(".tile");
    expect(tile).toBeInTheDocument();
    expect(canvas.queryByTestId("setpoint")).not.toBeInTheDocument();
    expect(canvas.queryByTestId("slider")).not.toBeInTheDocument();
  },
};

// ─── Populated — Cool mode ────────────────────────────────────────────────────

export const CoolingMode: Story = {
  args: { ...populatedBase },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Tile header and setpoint render.
    expect(canvas.getByText("Climate · A/C")).toBeInTheDocument();
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("68");
    expect(canvas.getByTestId("mode-pill")).toHaveTextContent("Cooling");

    // Cool chip is active; others are not.
    expect(canvas.getByTestId("chip-cool")).toHaveClass("on");
    expect(canvas.getByTestId("chip-heat")).not.toHaveClass("on");
    expect(canvas.getByTestId("chip-auto")).not.toHaveClass("on");

    // Ambient marker is shown.
    expect(canvas.getByTestId("ambient-label")).toHaveTextContent("74°");

    // Range end labels.
    expect(canvas.getByText("65°")).toBeInTheDocument();
    expect(canvas.getByText("80°")).toBeInTheDocument();
  },
};

// ─── Populated — Heat mode ────────────────────────────────────────────────────

export const HeatingMode: Story = {
  args: { ...populatedBase, target: 76, ambient: 70, mode: "heat", action: "Heating" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("76");
    expect(canvas.getByTestId("mode-pill")).toHaveTextContent("Heating");
    expect(canvas.getByTestId("chip-heat")).toHaveClass("on");
    expect(canvas.getByTestId("chip-cool")).not.toHaveClass("on");
  },
};

// ─── Populated — Auto/Idle ────────────────────────────────────────────────────

export const AutoIdle: Story = {
  args: { ...populatedBase, target: 72, ambient: 71, mode: "auto", action: "Idle" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("chip-auto")).toHaveClass("on");
    expect(canvas.getByTestId("mode-pill")).toHaveTextContent("Idle");
  },
};

// ─── Error/empty — component re-uses the Loading skeleton ────────────────────
// The container shows the skeleton whenever data is unavailable; no separate
// error branch exists in ClimateTileView, so this story documents that contract.

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
    // No real data is displayed during error/loading.
    expect(within(canvasElement).queryByTestId("setpoint")).not.toBeInTheDocument();
  },
};

// ─── Interaction: mode chip fires onSetMode callback ─────────────────────────

export const ChipInteraction: Story = {
  args: { ...populatedBase, target: 72, ambient: 72, mode: "auto", action: "Idle" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByTestId("chip-cool"));
    expect(onSetMode).toHaveBeenCalledWith("cool", 68);

    await userEvent.click(canvas.getByTestId("chip-heat"));
    expect(onSetMode).toHaveBeenCalledWith("heat", 76);
  },
};

// ─── Interaction: slider attributes are correct ───────────────────────────────

export const SliderInteraction: Story = {
  args: { ...populatedBase, target: 70, ambient: 72 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    // Slider renders with the correct initial value and range bounds.
    expect(slider).toHaveAttribute("min", "65");
    expect(slider).toHaveAttribute("max", "80");
    expect(slider.value).toBe("70");
  },
};

// ─── Min/max boundary values ──────────────────────────────────────────────────

export const MinSetpoint: Story = {
  args: { ...populatedBase, target: 65, ambient: 66 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("65");
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("65");
  },
};

export const MaxSetpoint: Story = {
  args: { ...populatedBase, target: 80, ambient: 78, mode: "heat", action: "Heating" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("80");
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("80");
  },
};
