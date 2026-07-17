import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { LevelOverlayView } from "./LevelOverlayView";

// The view is position:fixed, so stories frame it inside the wall-panel
// viewport via Storybook's fullscreen layout rather than a stage div.
const meta = {
  title: "Components/LevelOverlayView",
  component: LevelOverlayView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { onClose: () => {} },
} satisfies Meta<typeof LevelOverlayView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Right side of the mount sits high: the white plane's right edge lifts.
export const TiltedRightHigh: Story = {
  args: { reading: { state: "ready", angle: 6 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("+6°")).toBeInTheDocument();
  },
};

export const TiltedRightLow: Story = {
  args: { reading: { state: "ready", angle: -2.4 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("-2.4°")).toBeInTheDocument();
  },
};

// Inside the flat zone the screen floods the accent blue and snaps to 0°.
export const Level: Story = {
  args: { reading: { state: "ready", angle: 0.05 } },
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
