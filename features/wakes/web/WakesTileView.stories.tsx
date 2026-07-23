import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";
import { defineTileMeta } from "@/components/tiles/__stories__/factory";
import { WakesTileView } from "./WakesTileView";

const meta = {
  ...defineTileMeta("WakesTileView", WakesTileView),
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof WakesTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

// The tap surface belongs to the board now , tapping the face opens the
// PIN-gated full-page viewer via the tile-detail registry, so the view itself
// carries no handler to exercise here.
export const Populated: Story = {
  args: {
    status: "populated",
    todayCount: 12,
    lastWakeLabel: "14:32",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("12")).toBeInTheDocument();
    await expect(canvas.getByText(/last 14:32/)).toBeInTheDocument();
  },
};

export const NoneYet: Story = {
  args: {
    status: "populated",
    todayCount: 0,
    lastWakeLabel: null,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("0")).toBeInTheDocument();
    await expect(canvas.getByText(/none yet/)).toBeInTheDocument();
  },
};

export const Loading: Story = {
  args: {
    status: "loading",
  },
};
