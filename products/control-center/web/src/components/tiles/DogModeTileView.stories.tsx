import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { boolArgType, defineTileMeta } from "./__stories__/factory";
import { DogModeTileView } from "./DogModeTileView";

const meta = {
  ...defineTileMeta("DogModeTileView", DogModeTileView),
  args: {
    armed: false,
    // fn() makes onToggle a storybook/vitest spy so play-function assertions work.
    onToggle: fn(),
  },
  argTypes: {
    armed: boolArgType(
      "Whether the local arm preview is active (placeholder , not wired to the house)",
    ),
  },
} satisfies Meta<typeof DogModeTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Default disarmed state , routine preview dimmed, "Coming soon" badge shown. */
export const Disarmed: Story = {
  args: { armed: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Dog Mode")).toBeInTheDocument();
    await expect(canvas.getByText("Coming soon")).toBeInTheDocument();
    await expect(canvas.getByText(/keep the pups comfy/i)).toBeInTheDocument();
    await expect(canvas.getByText(/not yet connected to the house/i)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /arm dog mode/i })).toBeInTheDocument();
  },
};

/** Armed preview , routine list highlights and the button flips to disarm. */
export const Armed: Story = {
  args: { armed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/dog mode armed/i)).toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /disarm/i })).toBeInTheDocument();
  },
};

/** Interaction test , tapping the arm button fires onToggle. */
export const ToggleInteraction: Story = {
  args: {
    armed: false,
    // Per-story fn() ensures a fresh spy with no prior call history.
    onToggle: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const btn = canvas.getByRole("button", { name: /arm dog mode/i });
    await userEvent.click(btn);
    await expect(args.onToggle).toHaveBeenCalledTimes(1);
  },
};
