import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { LevelOverlayView } from "./LevelOverlayView";

// The view is position:fixed, so stories frame it inside the wall-panel
// viewport via Storybook's fullscreen layout rather than a stage div.
const meta = {
  title: "Components/Overlays/Level",
  component: LevelOverlayView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { onClose: () => {}, axis: "roll", onSwapAxis: () => {} },
} satisfies Meta<typeof LevelOverlayView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Right side of the mount sits high: the white plane's right edge lifts.
export const TiltedRightHigh: Story = {
  args: { reading: { state: "ready", angle: 6, pitch: 0 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("+6°")).toBeInTheDocument();
  },
};

export const TiltedRightLow: Story = {
  args: { reading: { state: "ready", angle: -2.4, pitch: 0 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("-2.4°")).toBeInTheDocument();
  },
};

// Inside the flat zone the screen floods the accent blue and snaps to 0°.
export const Level: Story = {
  args: { reading: { state: "ready", angle: 0.05, pitch: 0 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0°")).toBeInTheDocument();
  },
};

// No sensor / permission denied (plain browsers, dev).
export const Unavailable: Story = {
  args: { reading: { state: "unavailable" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/Tilt unavailable/)).toBeInTheDocument();
  },
};

// Forward/back tilt, reachable only from the button in this view: the horizon
// stays flat and rides up as the panel leans away from the viewer.
export const PitchLeaningBack: Story = {
  args: { axis: "pitch", reading: { state: "ready", angle: 0, pitch: 4.2 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("+4.2°")).toBeInTheDocument();
    // The swap button offers the way back to the default left/right axis.
    await expect(canvas.getByTestId("level-axis-swap")).toHaveTextContent("Left / right");
  },
};

// The overlay always opens on left/right, so the button offers forward/back.
export const AxisSwapAffordance: Story = {
  args: { reading: { state: "ready", angle: 1.2, pitch: 9 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Roll is what shows, not pitch, regardless of how far the panel leans.
    await expect(canvas.getByText("+1.2°")).toBeInTheDocument();
    await expect(canvas.getByTestId("level-axis-swap")).toHaveTextContent("Forward / back");
  },
};
