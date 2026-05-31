/**
 * Stories for ClimateTileView — covers all visual states so addon-vitest
 * runs them as component tests in the vitest suite.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ClimateTileViewProps } from "./ClimateTileView";
import { ClimateTileView } from "./ClimateTileView";

// Base populated args without spy callbacks — each story that uses callbacks
// defines its own fn() so spy call history never leaks between tests.
const populatedBase = {
  status: "populated" as const,
  target: 68,
  ambient: 74,
  mode: "cool" as const,
  action: "Cooling",
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
  args: {
    ...populatedBase,
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
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
  args: {
    ...populatedBase,
    target: 76,
    ambient: 70,
    mode: "heat",
    action: "Heating",
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
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
  args: {
    ...populatedBase,
    target: 72,
    ambient: 71,
    mode: "auto",
    action: "Idle",
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
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
// Design intent: this story verifies that clicking a chip fires the correct
// callback with the right args. Visual state transitions (chip gaining/losing
// 'on' class after a mode change) are validated in the CoolingMode, HeatingMode,
// and AutoIdle stories which render with committed mode props. Because
// ClimateTileView is purely presentational, the 'on' class only reflects the
// mode prop passed in — re-rendering with a new mode is the container's job
// and is covered by integration tests, not this story.

export const ChipInteraction: Story = {
  args: {
    ...populatedBase,
    target: 72,
    ambient: 72,
    mode: "auto",
    action: "Idle",
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const { onSetMode } = args as Extract<ClimateTileViewProps, { status: "populated" }>;

    // Initial state: auto chip should be active.
    expect(canvas.getByTestId("chip-auto")).toHaveClass("on");

    // Click cool — verify callback fires with correct preset target.
    await userEvent.click(canvas.getByTestId("chip-cool"));
    expect(onSetMode).toHaveBeenCalledWith("cool", 68);

    // Click heat — verify callback fires with correct preset target.
    await userEvent.click(canvas.getByTestId("chip-heat"));
    expect(onSetMode).toHaveBeenCalledWith("heat", 76);
  },
};

// ─── Slider attributes ────────────────────────────────────────────────────────
// Verifies the slider renders with the correct min/max bounds and initial value.
// Actual drag interactions are integration-level; the presentational contract
// here is that the slider attributes are correct on initial render.

export const SliderAttributes: Story = {
  args: {
    ...populatedBase,
    target: 70,
    ambient: 72,
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
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
  args: {
    ...populatedBase,
    target: 65,
    ambient: 66,
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("65");
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("65");
  },
};

export const MaxSetpoint: Story = {
  args: {
    ...populatedBase,
    target: 80,
    ambient: 78,
    mode: "heat",
    action: "Heating",
    onSetTarget: fn(),
    onSetMode: fn(),
  } as ClimateTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    expect(canvas.getByTestId("setpoint")).toHaveTextContent("80");
    const slider = canvas.getByTestId("slider") as HTMLInputElement;
    expect(slider.value).toBe("80");
  },
};
