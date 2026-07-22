import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { MetaphorFrontPage, MetaphorSpringboard } from "./MediaMetaphorConcepts";

/**
 * Round 3 concepts , borrowed media metaphors. Two throwaway prototypes for
 * the 1366x1024 wall panel: a game-console "channel" springboard and a modern
 * newspaper front page. Local state only.
 */
const meta = {
  title: "Experiments/Round 3/Metaphor",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Wii-channel / visionOS energy: focusable channel tiles, ticker below. */
export const ASpringboard: Story = {
  name: "A , Console springboard",
  render: () => <MetaphorSpringboard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

/** Modern editorial front page: masthead, lead story, house markets. */
export const BFrontPage: Story = {
  name: "B , The Daily Webb (front page)",
  render: () => <MetaphorFrontPage />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByText("THE DAILY WEBB", {}, { timeout: 10000 }),
    ).toBeInTheDocument();
  },
};
