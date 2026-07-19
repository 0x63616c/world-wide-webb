import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { defineTileMeta } from "./__stories__/factory";
import { WakesTileView } from "./WakesTileView";

const meta = {
  ...defineTileMeta("WakesTileView", WakesTileView),
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof WakesTileView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  args: {
    status: "populated",
    todayCount: 12,
    lastWakeLabel: "14:32",
    onOpen: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("12")).toBeInTheDocument();
    await expect(canvas.getByText(/last 14:32/)).toBeInTheDocument();
    await userEvent.click(canvas.getByText("Activity"));
    await expect(args.onOpen).toHaveBeenCalled();
  },
};

export const NoneYet: Story = {
  args: {
    status: "populated",
    todayCount: 0,
    lastWakeLabel: null,
    onOpen: fn(),
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
    onOpen: fn(),
  },
};
