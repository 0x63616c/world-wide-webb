/**
 * Stories for ControlsTileView , covers loading, populated, and pending states.
 * Play functions double as component-test assertions via addon-vitest.
 *
 * The Lights control is a 4-state mode cycle (OFF → K ON → O ON → ON), driven by
 * the two fixtures {kitchen, overhead}; stories cover each state's label + that a
 * tap advances the cycle (fires onLightsCycle).
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import type { ControlsTileViewProps, ControlsViewData } from "./ControlsTileView";
import { ControlsTileView } from "./ControlsTileView";

// ─── shared fixture data ──────────────────────────────────────────────────────

const allOn: ControlsViewData = {
  lamps: { on: true, sub: "On", pending: false },
  lights: { kitchen: true, overhead: true, pending: false },
  fan: { on: true, sub: "Medium", pending: false },
};

const allOff: ControlsViewData = {
  lamps: { on: false, pending: false },
  lights: { kitchen: false, overhead: false, pending: false },
  fan: { on: false, pending: false },
};

// ─── meta ─────────────────────────────────────────────────────────────────────

const meta = {
  ...defineTileMeta("ControlsTileView", ControlsTileView),
  // Discriminated union , meta-level args can't satisfy the union directly;
  // each story supplies its own complete args.
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
    onLightsCycle: fn(),
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

// ─── Populated , all on (Lights mode = ON) ────────────────────────────────────

export const AllOn: Story = {
  name: "Populated , all on",
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
    onLightsCycle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // All four grid cells present
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    const lights = canvas.getByRole("button", { name: "Lights" });
    const fan = canvas.getByRole("button", { name: "Fan" });
    const scene = canvas.getByRole("button", { name: "More" });
    expect(lamps).toBeInTheDocument();
    expect(lights).toBeInTheDocument();
    expect(fan).toBeInTheDocument();
    expect(scene).toBeInTheDocument();
    // Pressed states reflect on=true; Lights is lit (both fixtures on) and shows ON.
    expect(lamps).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveTextContent("ON");
    expect(fan).toHaveAttribute("aria-pressed", "true");
    // Fan spin is running when on
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "running" });
    // Sub-label visible
    expect(canvas.getByText("Medium")).toBeInTheDocument();
  },
};

// ─── Populated , all off (Lights mode = OFF) ──────────────────────────────────

export const AllOff: Story = {
  name: "Populated , all off",
  args: {
    status: "populated",
    data: allOff,
    onToggle: fn(),
    onLightsCycle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lamps = await canvas.findByRole("button", { name: "Lamps" });
    const lights = canvas.getByRole("button", { name: "Lights" });
    const fan = canvas.getByRole("button", { name: "Fan" });
    // All off; Lights reads OFF (both fixtures off) and is not pressed.
    expect(lamps).toHaveAttribute("aria-pressed", "false");
    expect(lights).toHaveAttribute("aria-pressed", "false");
    expect(lights).toHaveTextContent("OFF");
    expect(fan).toHaveAttribute("aria-pressed", "false");
    // Fan spin is paused when off
    const spinEl = fan.querySelector("[data-fan-spin]");
    expect(spinEl).not.toBeNull();
    expect(spinEl).toHaveStyle({ animationPlayState: "paused" });
  },
};

// ─── Lights , kitchen only (K ON) ─────────────────────────────────────────────

export const LightsKitchenOnly: Story = {
  name: "Populated , Lights kitchen only (K ON)",
  args: {
    status: "populated",
    data: { ...allOff, lights: { kitchen: true, overhead: false, pending: false } },
    onToggle: fn(),
    onLightsCycle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lights = await canvas.findByRole("button", { name: "Lights" });
    // Kitchen-only lights the bulb (a fixture is on) and shows K ON.
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveTextContent("K ON");
  },
};

// ─── Lights , overhead only (O ON) ────────────────────────────────────────────

export const LightsOverheadOnly: Story = {
  name: "Populated , Lights overhead only (O ON)",
  args: {
    status: "populated",
    data: { ...allOff, lights: { kitchen: false, overhead: true, pending: false } },
    onToggle: fn(),
    onLightsCycle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const lights = await canvas.findByRole("button", { name: "Lights" });
    expect(lights).toHaveAttribute("aria-pressed", "true");
    expect(lights).toHaveTextContent("O ON");
  },
};

// ─── Populated , mixed (lamps on, lights off, fan off) ────────────────────────

export const Mixed: Story = {
  name: "Populated , mixed states",
  args: {
    status: "populated",
    data: {
      lamps: { on: true, sub: "Warm", pending: false },
      lights: { kitchen: false, overhead: false, pending: false },
      fan: { on: false, pending: false },
    },
    onToggle: fn(),
    onLightsCycle: fn(),
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

// ─── Pending state (lamps in-flight) ──────────────────────────────────────────

export const Pending: Story = {
  name: "Populated , pending control",
  args: {
    status: "populated",
    data: {
      lamps: { on: true, sub: "On", pending: true },
      lights: { kitchen: false, overhead: false, pending: false },
      fan: { on: false, pending: false },
    },
    onToggle: fn(),
    onLightsCycle: fn(),
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
  name: "Interaction , toggle fires onToggle",
  args: {
    status: "populated",
    data: allOn,
    onToggle: fn(),
    onLightsCycle: fn(),
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

// ─── Lights cycle interaction ─────────────────────────────────────────────────

export const LightsCycleInteraction: Story = {
  name: "Interaction , tapping Lights advances the mode cycle",
  args: {
    status: "populated",
    data: allOff,
    onToggle: fn(),
    onLightsCycle: fn(),
  } as ControlsTileViewProps,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const lights = await canvas.findByRole("button", { name: "Lights" });
    // Lights is a mode cycle: tapping fires onLightsCycle (NOT onToggle).
    await userEvent.click(lights);
    const populated = args as Extract<ControlsTileViewProps, { status: "populated" }>;
    expect(populated.onLightsCycle).toHaveBeenCalledTimes(1);
    expect(populated.onToggle).not.toHaveBeenCalledWith("lights", expect.anything());
  },
};
