/**
 * BoothCamera stories , the production photo-booth camera on the fixed 1366×1024
 * wall panel. There is no camera in CI, so CameraStage paints its fallback and
 * every story renders cleanly (same as the throwaway design prototypes). The
 * Countdown and Filter stories drive the component's own state via play
 * interactions rather than test-only props.
 */

import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { BoothCamera } from "./BoothCamera";

const meta = {
  title: "Tiles/PhotoBooth/BoothCamera",
  component: BoothCamera,
  tags: ["autodocs"],
  parameters: {
    layout: "fullscreen",
    // Fill the panel ourselves , opt out of the board-sizing decorator.
    boardWrapper: false,
  },
  args: {
    onOpenGallery: fn(),
  },
  decorators: [
    (Story) => (
      <div style={{ width: 1366, height: 1024, position: "relative", overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BoothCamera>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Resting state , live preview (fallback in CI), controls idle. */
export const Idle: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Shutter" })).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /self-timer off/i })).toBeInTheDocument();
  },
};

/** Self-timer armed, shutter pressed , the big countdown overlay is showing. */
export const Countdown: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const timer = canvas.getByRole("button", { name: /self-timer/i });
    // Off → 1s → 3s → 5s: three cycles to a comfortable window.
    await userEvent.click(timer);
    await userEvent.click(timer);
    await userEvent.click(timer);
    await userEvent.click(canvas.getByRole("button", { name: "Shutter" }));
    await expect(await canvas.findByText("5")).toBeInTheDocument();
  },
};

/**
 * Capture feedback , pressing the shutter fires the always-on capture cue (a
 * brief border pulse) regardless of the flash toggle, so a capture is
 * unmistakable on the wall panel. There is no camera in CI, so the frame bake
 * fails after the cue and the shot thumbnail can't render here; the pulse (which
 * fires before the bake) is the piece this exercises.
 */
export const CaptureFeedback: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Shutter" }));
    await expect(await canvas.findByTestId("capture-pulse")).toBeInTheDocument();
  },
};

/** Filter picker open , the house Modal swatch grid of the 7 CSS filters. */
export const FilterModal: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /filters/i }));
    // Modal portals to document.body, outside the story canvas.
    const dialog = await within(document.body).findByRole("dialog");
    await expect(dialog).toBeInTheDocument();
  },
};
