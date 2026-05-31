/**
 * Stories for ControlsTileView — covers loading, populated, and pending states.
 * Play functions double as component-test assertions via addon-vitest.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { ControlsTileViewProps, ControlsViewData } from "./ControlsTileView";
import { ControlsTileView } from "./ControlsTileView";

// ─── shared fixture data ──────────────────────────────────────────────────────

const allOn: ControlsViewData = {
  lamps: { on: true, sub: "On", pending: false },
  lights: { on: true, pending: false },
  fan: { on: true, sub: "Medium", pending: false },
};

const allOff: ControlsViewData = {
  lamps: { on: false, pending: false },
  lights: { on: false, pending: false },
  fan: { on: false, pending: false },
};

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  title: "Tiles/ControlsTileView",
  component: ControlsTileView,
  tags: ["autodocs"],
  // Discriminated union — meta-level args can't satisfy the union directly;
  // each story supplies its own complete args.
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
  } as ControlsTileViewProps,
} satisfies Meta<typeof ControlsTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// ─── Loading ──────────────────────────────────────────────────────────────────

export const Loading: Story = {
  args: { status: "loading" } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header is still visible while loading
    await expect(canvas.getByText("Controls")).toBeInTheDocument();
    // No interactive tap buttons while skeletons show
    expect(canvas.queryByRole("button", { name: "Lamps" })).toBeNull();
    expect(canvas.queryByRole("button", { name: "Lights" })).toBeNull();
    expect(canvas.queryByRole("button", { name: "Fan" })).toBeNull();
  },
};

// ─── Error / empty ───────────────────────────────────────────────────────────

export const ErrorEmpty: Story = {
  name: "Error / empty",
  args: { status: "error", error: "Service unavailable" } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Header still shows; controls replaced by skeleton shimmer
    await expect(canvas.getByText("Controls")).toBeInTheDocument();
    expect(canvas.queryByRole("button", { name: "Lamps" })).toBeNull();
    expect(canvas.queryByRole("button", { name: "Lights" })).toBeNull();
    expect(canvas.queryByRole("button", { name: "Fan" })).toBeNull();
  },
};

// ─── Populated — all on ───────────────────────────────────────────────────────

export const AllOn: Story = {
  name: "Populated — all on",
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // All four grid cells present
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    const lights = canvas.getByRole("button", { name: "Lights" });
    const fan = canvas.getByRole("button", { name: "Fan" });
    const scene = canvas.getByRole("button", { name: "Scene" });
    expect(lamps).toBeInTheDocument();
    expect(lights).toBeInTheDocument();
    expect(fan).toBeInTheDocument();
    expect(scene).toBeInTheDocument();
    // Pressed states reflect on=true
    expect(lamps).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(fan).toHaveAttribute("aria-pressed", "true");
    // Fan spin is running when on
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
    // Sub-label visible
    expect(canvas.getByText("Medium")).toBeInTheDocument();
  },
};

// ─── Populated — all off ──────────────────────────────────────────────────────

export const AllOff: Story = {
  name: "Populated — all off",
  args: {
    status: "populated",
    data: allOff,
    onToggle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    const lights = canvas.getByRole("button", { name: "Lights" });
    const fan = canvas.getByRole("button", { name: "Fan" });
    // All off
    expect(lamps).toHaveAttribute("aria-pressed", "false");
    expect(lights).toHaveAttribute("aria-pressed", "false");
    expect(fan).toHaveAttribute("aria-pressed", "false");
    // Fan spin is paused when off
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  },
};

// ─── Populated — mixed (lamps on, others off) ─────────────────────────────────

export const Mixed: Story = {
  name: "Populated — mixed states",
  args: {
    status: "populated",
    data: {
      lamps: { on: true, sub: "Warm", pending: false },
      lights: { on: false, pending: false },
      fan: { on: false, pending: false },
    },
    onToggle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.findByRole("button", { name: "Lamps" })).resolves.toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(canvas.getByRole("button", { name: "Lights" })).toHaveAttribute("aria-pressed", "false");
  },
};

// ─── Pending state ────────────────────────────────────────────────────────────

export const Pending: Story = {
  name: "Populated — pending control",
  args: {
    status: "populated",
    data: {
      lamps: { on: true, sub: "On", pending: true },
      lights: { on: false, pending: false },
      fan: { on: false, pending: false },
    },
    onToggle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    // Pending attribute is set for the in-flight control
    expect(lamps).toHaveAttribute("data-pending", "true");
    // Other controls are not pending
    expect(canvas.getByRole("button", { name: "Lights" })).not.toHaveAttribute("data-pending");
  },
};

// ─── Toggle interaction ───────────────────────────────────────────────────────

export const ToggleInteraction: Story = {
  name: "Interaction — toggle fires onToggle",
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    await userEvent.click(lamps);
    // onToggle called with the correct key and current on value
    expect(
      (args as Extract<ControlsTileViewProps, { status: "populated" }>).onToggle,
    ).toHaveBeenCalledWith("lamps", true);

    const fan = canvas.getByRole("button", { name: "Fan" });
    await userEvent.click(fan);
    expect(
      (args as Extract<ControlsTileViewProps, { status: "populated" }>).onToggle,
    ).toHaveBeenCalledWith("fan", true);
  },
};
