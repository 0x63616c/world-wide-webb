import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import {
  BoardConceptChromeRefresh,
  BoardConceptDomainClusters,
  BoardConceptHubDock,
} from "./BoardRedesignConcepts";

/**
 * Three 1366x1024 board redesign concepts on placeholder state , mock tiles
 * only, no pan engine. Flip lamp taps and dock buttons to feel each direction.
 * Pick one (or mix); the losers get deleted.
 */
const meta = {
  title: "Experiments/Board Redesign",
  tags: ["autodocs"],
  parameters: { boardWrapper: false, layout: "fullscreen" },
} satisfies Meta;

export default meta;
type Story = StoryObj;

/** Same board feel, every tile in the settings chrome (chip + mono header). */
export const AChromeRefresh: Story = {
  name: "A , Chrome refresh",
  render: () => <BoardConceptChromeRefresh />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("14:32", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};

/** Refreshed tiles + persistent bottom dock of hub launchers. */
export const BHubDock: Story = {
  name: "B , Hub dock",
  render: () => <BoardConceptHubDock />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole("button", { name: "Open Climate hub" }, { timeout: 10000 }),
    ).toBeInTheDocument();
  },
};

/** Board reorganized into labeled domain cluster regions. */
export const CDomainClusters: Story = {
  name: "C , Domain clusters",
  render: () => <BoardConceptDomainClusters />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Media", {}, { timeout: 10000 })).toBeInTheDocument();
  },
};
