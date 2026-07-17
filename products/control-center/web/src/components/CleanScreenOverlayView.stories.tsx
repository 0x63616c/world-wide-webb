import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { CleanScreenOverlayView, formatCountdown } from "./CleanScreenOverlayView";

const meta = {
  title: "Components/CleanScreenOverlayView",
  component: CleanScreenOverlayView,
  tags: ["autodocs"],
  parameters: { layout: "fullscreen" },
  args: { onHoldStart: () => {}, onHoldEnd: () => {} },
} satisfies Meta<typeof CleanScreenOverlayView>;

export default meta;
type Story = StoryObj<typeof meta>;

// Freshly opened: full ten minutes, button untouched (no fill at all).
export const JustOpened: Story = {
  args: { remainingMs: 10 * 60 * 1000, holdProgress: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Cleaning mode")).toBeInTheDocument();
    await expect(canvas.getByText("10:00")).toBeInTheDocument();
    await expect(canvas.getByText("Press and hold to exit")).toBeInTheDocument();
  },
};

// Mid-hold: the white fill is sweeping left to right.
export const HoldingToExit: Story = {
  args: { remainingMs: 8 * 60 * 1000 + 41 * 1000, holdProgress: 0.6 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("8:41")).toBeInTheDocument();
  },
};

// Seconds from the 10 minute failsafe kicking in.
export const AlmostExpired: Story = {
  args: { remainingMs: 4000, holdProgress: 0 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0:04")).toBeInTheDocument();
  },
};

export const CountdownFormat: Story = {
  args: { remainingMs: 0, holdProgress: 0 },
  play: async () => {
    expect(formatCountdown(600_000)).toBe("10:00");
    expect(formatCountdown(61_000)).toBe("1:01");
    expect(formatCountdown(999)).toBe("0:01");
    expect(formatCountdown(0)).toBe("0:00");
  },
};
